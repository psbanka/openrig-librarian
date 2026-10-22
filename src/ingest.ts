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
  const write = db.transaction((item: SourceItem) => {
    const title = redact(item.title);
    upsert.run(
      item.ref,
      item.kind,
      title,
      item.date,
      item.version,
      item.state ?? null,
      item.authority ?? AUTHORITY[item.kind],
    );
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
    if (redact(item.ref) !== item.ref) {
      skipped++;
      console.error(`librarian: skipped a ${item.kind} whose reference contains a credential`);
      continue;
    }
    write(item);
    added++;
  }
  return { added, skipped };
}
