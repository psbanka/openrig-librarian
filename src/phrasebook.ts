// The desk's phrasebook: ways of asking that search missed, mapped to the sources that answer
// them. It lives in the data directory, never in a repo; the operator copies keepers into the book.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PhraseEntry } from "./book";
import { redact } from "./redact";
import type { Store } from "./store";

const FILE = "phrasebook.yaml";

export function readDeskPhrasebook(dir: string): PhraseEntry[] {
  const file = join(dir, FILE);
  if (!existsSync(file)) return [];
  return (Bun.YAML.parse(readFileSync(file, "utf8")) as PhraseEntry[] | null) ?? [];
}

/** Appends an entry with its phrase redacted. Every source must already be in the index. */
export function addPhrase(store: Store, entry: PhraseEntry): PhraseEntry {
  const known = store.db.prepare("select 1 from items where ref = ?");
  const unknown = entry.sources.filter((ref) => !known.get(ref));
  if (unknown.length) throw new Error(`no indexed source: ${unknown.map(redact).join(", ")}`);
  const clean = { ...entry, phrase: redact(entry.phrase), by: redact(entry.by) };
  // JSON strings are valid YAML double-quoted scalars, so the file stays a YAML list.
  appendFileSync(
    join(store.dir, FILE),
    `- phrase: ${JSON.stringify(clean.phrase)}\n  sources: ${JSON.stringify(clean.sources)}\n` +
      `  by: ${JSON.stringify(clean.by)}\n  date: ${JSON.stringify(clean.date)}\n`,
  );
  return clean;
}
