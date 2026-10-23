// Turns source items into redacted, chunked, full-text-indexed rows.
import { redact } from "./redact";
import type { Store } from "./store";
import { AUTHORITY, type SourceItem } from "./types";

const CHUNK = 1500;

/** Splits on blank lines, packing paragraphs up to CHUNK characters; a longer paragraph is cut. */
export function chunks(text: string): string[] {
  const out: string[] = [];
  let current = "";
  for (const paragraph of text.split(/\n\s*\n/)) {
    if (current && current.length + paragraph.length > CHUNK) {
      out.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
    while (current.length > CHUNK * 2) {
      out.push(current.slice(0, CHUNK));
      current = current.slice(CHUNK);
    }
  }
  if (current.trim()) out.push(current);
  return out;
}

/**
 * Writes each item in its own transaction, replacing whatever the index held for its ref.
 * A ref is stored as given, so an item whose ref holds a credential is skipped, unnamed.
 */
export async function ingest(
  store: Store,
  items: Iterable<SourceItem> | AsyncIterable<SourceItem>,
): Promise<{ added: number; skipped: number }> {
  const { db } = store;
  const upsert = db.prepare(`
    insert into items (ref, kind, title, date, version, state, authority) values (?, ?, ?, ?, ?, ?, ?)
    on conflict (ref) do update set kind = excluded.kind, title = excluded.title, date = excluded.date,
      version = excluded.version, state = excluded.state, authority = excluded.authority`);
  const unindex = db.prepare(
    "insert into fts (fts, rowid, title, text) select 'delete', id, title, text from chunks where ref = ?",
  );
  const drop = db.prepare("delete from chunks where ref = ?");
  const insert = db.prepare("insert into chunks (ref, seq, title, text) values (?, ?, ?, ?) returning id");
  const index = db.prepare("insert into fts (rowid, title, text) values (?, ?, ?)");
  const remember = db.prepare(`
    insert into sessions (ref, harness, id, cwd, parent, seat, model, commits) values (?, ?, ?, ?, ?, ?, ?, ?)
    on conflict (ref) do update set harness = excluded.harness, id = excluded.id, cwd = excluded.cwd,
      parent = excluded.parent, seat = excluded.seat, model = excluded.model, commits = excluded.commits`);
  const merge = db.prepare(
    "insert into merges (ref, merged_as) values (?, ?) on conflict (ref) do update set merged_as = excluded.merged_as",
  );
  const write = db.transaction((item: SourceItem) => {
    const title = redact(item.title);
    upsert.run(
      item.ref,
      item.kind,
      title,
      item.date,
      item.version,
      item.state ? redact(item.state) : null,
      item.authority ?? AUTHORITY[item.kind],
    );
    if (item.session) {
      // The id and parent are inside the ref, which the caller has already checked.
      // Seat and model are for display, so they are stored redacted.
      const s = item.session;
      remember.run(
        item.ref,
        s.harness,
        s.id,
        s.cwd,
        s.parent ?? null,
        s.seat ? redact(s.seat) : null,
        s.model ? redact(s.model) : null,
        JSON.stringify(s.commits),
      );
    }
    if (item.mergedAs) merge.run(item.ref, item.mergedAs);
    unindex.run(item.ref);
    drop.run(item.ref);
    chunks(redact(item.text)).forEach((text, seq) => {
      const { id } = insert.get(item.ref, seq, title, text) as { id: number };
      index.run(id, title, text);
    });
  });
  let added = 0;
  let skipped = 0;
  for await (const item of items) {
    // A ref and a working directory are operational: they can't be redacted and still work.
    const unsafe =
      redact(item.ref) !== item.ref
        ? "reference"
        : item.session && redact(item.session.cwd) !== item.session.cwd
          ? "working directory"
          : null;
    if (unsafe) {
      skipped++;
      console.error(`librarian: skipped a ${item.kind} whose ${unsafe} contains a credential`);
      continue;
    }
    write(item);
    added++;
  }
  return { added, skipped };
}

/** Removes items and everything stored for them, in one transaction. Returns how many existed. */
export function removeItems(store: Store, refs: string[]): number {
  const { db } = store;
  const exists = db.prepare("select 1 from items where ref = ?");
  const unindex = db.prepare(
    "insert into fts (fts, rowid, title, text) select 'delete', id, title, text from chunks where ref = ?",
  );
  // Rows that reference an item go before the item itself.
  const deletes = [
    "delete from chunks where ref = ?",
    "delete from sessions where ref = ?",
    "delete from merges where ref = ?",
    "delete from items where ref = ?",
  ].map((sql) => db.prepare(sql));
  let removed = 0;
  db.transaction(() => {
    for (const ref of refs) {
      if (!exists.get(ref)) continue;
      unindex.run(ref);
      for (const statement of deletes) statement.run(ref);
      removed++;
    }
  })();
  return removed;
}
