// The exact list: full-text matches over chunks, one card per source.
import type { Book } from "./book";
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
       select r.ref, r.id, i.kind, i.title, i.date, i.state, i.authority, s.seat, s.commits
       from ranked r join items i on i.ref = r.ref left join sessions s on s.ref = r.ref
       where r.n = 1 order by r.score, r.id limit ?2`,
    )
    .all(match, k) as Row[];
  const snippet = store.db.query("select snippet(fts, 1, '', '', '…', 16) as text from fts where fts match ?1 and rowid = ?2");
  return best.map((row) => ({
    kind: row.kind,
    ref: row.ref,
    date: row.date,
    title: row.title,
    snippet: (snippet.get(match, row.id) as { text: string }).text,
    authority: row.authority,
    ...(row.state ? { state: row.state } : {}),
    ...(row.seat ? { seat: row.seat } : {}),
    ...(row.commits && row.commits !== "[]" ? { commits: JSON.parse(row.commits) as string[] } : {}),
  }));
}

export async function search(store: Store, _book: Book, query: string, k = 5): Promise<SearchResult> {
  // The meaning and phrasebook lists arrive with Slice 4.
  return { exact: exact(store, query, k), meaning: [], phrasebook: [] };
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
          `${card.commits?.length ? `\n    commits: ${card.commits.join(", ")}` : ""}`,
      ),
    ].join("\n");
  return [
    section("exact", result.exact),
    section("meaning", result.meaning),
    section("phrasebook", result.phrasebook),
  ].join("\n\n");
}
