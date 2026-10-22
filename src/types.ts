// Shared shapes: what a source yields, and what a search returns.

export type SourceKind =
  | "doc"
  | "commit"
  | "issue"
  | "issue-comment"
  | "pull-request"
  | "mission"
  | "session";

export type Authority = 1 | 2 | 3 | 4 | 5;

/** One item a source yields, before redaction and chunking. */
export interface SourceItem {
  kind: SourceKind;
  /** "doc:<repo>/<path>", "commit:<repo>/<sha9>", "issue:<owner>/<repo>#<n>", "claude:<uuid>", "codex:<uuid>" */
  ref: string;
  title: string;
  /** ISO 8601. */
  date: string;
  text: string;
  /** What changes when the item does: a blob sha, a commit sha, updated_at, or size:mtime. */
  version: string;
  /** closed | merged | complete | ... */
  state?: string;
  /** Overrides the kind's authority, e.g. a folder of notes the book ranks lower. */
  authority?: Authority;
}

/** One search result. */
export interface Card {
  kind: SourceKind;
  ref: string;
  date: string;
  title: string;
  snippet: string;
  /** 1 = current docs and specs, down to 5 = sessions. */
  authority: Authority;
  state?: string;
  stale?: { reason: string; by?: string };
  /** Session links: the commits a session made. */
  commits?: string[];
}

export interface SearchResult {
  exact: Card[];
  meaning: Card[];
  phrasebook: Card[];
}

/** The spec's authority order: docs and specs, decisions, issues, commits, sessions. */
export const AUTHORITY: Record<SourceKind, Authority> = {
  doc: 1,
  mission: 1,
  issue: 3,
  "issue-comment": 3,
  "pull-request": 3,
  commit: 4,
  session: 5,
};
