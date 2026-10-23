// Search: the exact list (full text), the meaning list (vectors) and phrasebook matches,
// one card per source in each.
import type { Book, Settings } from "./book";
import { dot, embed, fromBlob, normalize, toBlob } from "./embed";
import { readDeskPhrasebook } from "./phrasebook";
import { redact } from "./redact";
import type { Store } from "./store";
import type { Authority, Card, SearchResult, SourceKind } from "./types";

const STOP = new Set(
  "a an and are at be by can do does for from get how i in is it me my of on or the to what when where who why with".split(
    " ",
  ),
);

/**
 * The query's words, minus stopwords and edge punctuation. Unicode letters and digits stay
 * whole (`café`, `日本語`), and `#173` keeps its `#`.
 */
export function terms(query: string): string[] {
  return query
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}_#]+|[^\p{L}\p{N}_]+$/gu, ""))
    .filter((word) => word && !STOP.has(word.toLowerCase()));
}

interface Row {
  ref: string;
  id: number;
  kind: SourceKind;
  title: string;
  date: string;
  state: string | null;
  authority: Authority;
  seat: string | null;
  commits: string | null;
  merged_as: string | null;
}

/** A chunk with everything a card shows about its source. */
const CARD_SELECT = `select c.id, c.ref, c.text, i.kind, i.title, i.date, i.state, i.authority,
    s.seat, s.commits, m.merged_as
  from chunks c join items i on i.ref = c.ref
    left join sessions s on s.ref = c.ref left join merges m on m.ref = c.ref`;

function card(row: Row, snippet: string, phrase?: string): Card {
  return {
    kind: row.kind,
    ref: row.ref,
    date: row.date,
    title: row.title,
    snippet,
    authority: row.authority,
    ...(row.state ? { state: row.state } : {}),
    ...(row.seat ? { seat: row.seat } : {}),
    ...(row.commits && row.commits !== "[]" ? { commits: JSON.parse(row.commits) as string[] } : {}),
    ...(row.merged_as ? { commits: [row.merged_as] } : {}),
    ...(phrase ? { phrase } : {}),
  };
}

export function exact(store: Store, query: string, k: number): Card[] {
  const words = terms(query);
  if (!words.length) return [];
  const match = words.map((word) => `"${word.replaceAll('"', "")}"`).join(" OR ");
  // Each source's best chunk, ranked: one long source can't crowd out the rest.
  const best = store.db
    .query(
      `with hits as (
         select c.ref, c.id, bm25(fts, 2.0, 1.0) as score
         from fts join chunks c on c.id = fts.rowid where fts match ?1),
       ranked as (
         select ref, id, score, row_number() over (partition by ref order by score, id) as n from hits)
       select r.ref, r.id, i.kind, i.title, i.date, i.state, i.authority, s.seat, s.commits, m.merged_as
       from ranked r join items i on i.ref = r.ref left join sessions s on s.ref = r.ref
         left join merges m on m.ref = r.ref
       where r.n = 1 order by r.score, r.id limit ?2`,
    )
    .all(match, k) as Row[];
  const snippet = store.db.query("select snippet(fts, 1, '', '', '…', 16) as text from fts where fts match ?1 and rowid = ?2");
  return best.map((row) => card(row, (snippet.get(match, row.id) as { text: string }).text));
}

/**
 * The meaning list: the chunks nearest the query vector, one card per source. Brute force, which
 * measured 65 ms over 36,000 chunks in the research; an approximate index can come if that grows.
 */
export function nearest(store: Store, model: string, vector: Float32Array, k: number): Card[] {
  const scored: Array<{ id: number; score: number }> = [];
  const rows = store.db.query("select id, v from vecs where model = ?");
  for (const { id, v } of rows.iterate(model) as Iterable<{ id: number; v: Uint8Array }>) {
    const stored = fromBlob(v);
    if (stored.length === vector.length) scored.push({ id, score: dot(vector, stored) });
  }
  scored.sort((a, b) => b.score - a.score);
  const byId = store.db.prepare(`${CARD_SELECT} where c.id = ?`);
  const cards: Card[] = [];
  const seen = new Set<string>();
  for (const { id } of scored) {
    const row = byId.get(id) as (Row & { text: string }) | null;
    if (!row || seen.has(row.ref)) continue;
    seen.add(row.ref);
    cards.push(card(row, row.text.slice(0, 200)));
    if (cards.length === k) break;
  }
  return cards;
}

/** A phrasebook entry matches when the question shares this share of its words, or is this close. */
const PHRASE_WORDS = 0.6;
const PHRASE_MEANING = 0.7;

/** Vectors for phrases, cached by phrase and model; only new phrases are embedded. */
async function phraseVectors(store: Store, cfg: Settings["embed"], phrases: string[]): Promise<Float32Array[]> {
  const get = store.db.prepare("select v from phrase_vecs where phrase = ? and model = ?");
  const missing = [...new Set(phrases)].filter((phrase) => !get.get(phrase, cfg.model));
  if (missing.length) {
    const vectors = await embed(cfg, missing, "query");
    const put = store.db.prepare("insert or replace into phrase_vecs (phrase, model, v) values (?, ?, ?)");
    store.db.transaction(() => missing.forEach((phrase, i) => put.run(phrase, cfg.model, toBlob(normalize(vectors[i])))))();
  }
  return phrases.map((phrase) => fromBlob((get.get(phrase, cfg.model) as { v: Uint8Array }).v));
}

/**
 * Entries from the book's phrasebook and the desk's that match the question, by shared words or
 * by meaning, as cards for their sources, each carrying the phrase that matched.
 */
export async function phraseMatches(
  store: Store,
  book: Book,
  query: string,
  vector: Float32Array | null,
  k: number,
): Promise<Card[]> {
  const entries = [...book.phrasebook, ...readDeskPhrasebook(store.dir)].map((entry) => ({
    ...entry,
    phrase: redact(entry.phrase),
  }));
  if (!entries.length) return [];
  const asked = new Set(terms(query).map((word) => word.toLowerCase()));
  // Without vectors, matching falls back to shared words.
  const vectors = vector
    ? await phraseVectors(
        store,
        book.settings.embed,
        entries.map((entry) => entry.phrase),
      ).catch(() => null)
    : null;
  const matches = entries
    .map((entry, i) => {
      const words = terms(entry.phrase).map((word) => word.toLowerCase());
      const shared = words.length ? words.filter((word) => asked.has(word)).length / words.length : 0;
      const close = vector && vectors ? dot(vector, vectors[i]) : 0;
      return { entry, shared, close };
    })
    .filter((match) => match.shared >= PHRASE_WORDS || match.close >= PHRASE_MEANING)
    .sort((a, b) => Math.max(b.shared, b.close) - Math.max(a.shared, a.close));
  const first = store.db.prepare(`${CARD_SELECT} where c.ref = ? order by c.seq limit 1`);
  const cards: Card[] = [];
  const seen = new Set<string>();
  for (const { entry } of matches)
    for (const ref of entry.sources ?? []) {
      const row = first.get(ref) as (Row & { text: string }) | null;
      if (!row || seen.has(ref)) continue;
      seen.add(ref);
      cards.push(card(row, row.text.slice(0, 200), entry.phrase));
      if (cards.length === k) return cards;
    }
  return cards;
}

export async function search(store: Store, book: Book, query: string, k = 5): Promise<SearchResult> {
  const warnings: string[] = [];
  let vector: Float32Array | null = null;
  if (query.trim())
    try {
      vector = normalize((await embed(book.settings.embed, [query], "query"))[0]);
    } catch (error) {
      warnings.push(`meaning list unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  return {
    exact: exact(store, query, k),
    meaning: vector ? nearest(store, book.settings.embed.model, vector, k) : [],
    phrasebook: await phraseMatches(store, book, query, vector, k),
    ...(warnings.length ? { warnings } : {}),
  };
}

export function formatResult(result: SearchResult): string {
  const section = (name: string, cards: Card[]) =>
    [
      `${name} (${cards.length})`,
      ...cards.map(
        (card) =>
          `  ${card.ref}  ${card.kind}  ${card.date.slice(0, 10)}  authority ${card.authority}` +
          `${card.state ? `  ${card.state}` : ""}${card.seat ? `  seat ${card.seat}` : ""}` +
          `\n    ${card.title}\n    ${card.snippet.replace(/\s+/g, " ")}` +
          `${card.commits?.length ? `\n    commits: ${card.commits.join(", ")}` : ""}` +
          `${card.phrase ? `\n    phrase: ${JSON.stringify(card.phrase)}` : ""}`,
      ),
    ].join("\n");
  return [
    section("exact", result.exact),
    section("meaning", result.meaning),
    section("phrasebook", result.phrasebook),
  ].join("\n\n");
}
