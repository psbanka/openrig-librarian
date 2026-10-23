// The book: the operator's versioned folder of settings, phrasebook and questions,
// always read from origin/main of the repo that holds it.
import { homedir } from "node:os";
import { join } from "node:path";
import { git } from "./git";
import type { Authority } from "./types";

export interface BookRef {
  repo: string;
  path: string;
}

export interface Settings {
  rig: string;
  /** `forge` links a repo to its forge repo ("owner/name"), so pull request merges can fold. */
  repos: Array<{ name: string; path: string; docs: string[]; authority?: Authority; forge?: string }>;
  folders?: Array<{ name: string; path: string; globs: string[]; authority?: Authority }>;
  forge?: { url: string; repos: string[] };
  /** `exclude` names whole missions; `skip` globs files inside each mission folder. */
  missions?: { repo: string; path: string; exclude?: string[]; skip?: string[] };
  /** Regex sources matched against a session's working directory, and where seats live. */
  sessions: { cwd: string[]; exclude: string[]; seats?: { root: string; renames?: Record<string, string> } };
  judge: { url: string; model: string };
  embed: { url: string; model: string };
  connect: { codexSandbox: string; codexProfile: string };
}

export interface PhraseEntry {
  phrase: string;
  sources: string[];
  by: string;
  date: string;
}

export interface Question {
  q: string;
  expect: Array<{ ref?: string; text?: string }>;
}

export interface Book {
  settings: Settings;
  phrasebook: PhraseEntry[];
  questions: Question[];
}

const REQUIRED = ["rig", "repos", "sessions", "judge", "embed", "connect"] as const;

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

/** `--book <repo>:<path>`, split at the last colon. */
export function parseBookRef(value: string): BookRef {
  const at = value.lastIndexOf(":");
  if (at <= 0 || at === value.length - 1)
    throw new Error(`--book must be <repo>:<path>, got ${JSON.stringify(value)}`);
  return { repo: expandHome(value.slice(0, at)), path: value.slice(at + 1).replace(/\/+$/, "") };
}

/** Reads the book from origin/main. Only `update` fetches; other commands read what it fetched. */
export function readBook(ref: BookRef, options: { fetch: boolean }): Book {
  if (options.fetch) git(ref.repo, "fetch", "-q", "origin");
  const show = (name: string): string | null => {
    try {
      return git(ref.repo, "show", `origin/main:${ref.path}/${name}`);
    } catch {
      return null;
    }
  };
  const raw = show("librarian.yaml");
  if (raw === null) throw new Error(`no ${ref.path}/librarian.yaml on origin/main of ${ref.repo}`);
  const settings = Bun.YAML.parse(raw) as Settings | null;
  for (const key of REQUIRED)
    if (settings?.[key] === undefined) throw new Error(`${ref.path}/librarian.yaml has no ${key}`);
  return {
    settings: settings as Settings,
    phrasebook: (Bun.YAML.parse(show("phrasebook.yaml") ?? "[]") as PhraseEntry[] | null) ?? [],
    questions: (Bun.YAML.parse(show("questions.yaml") ?? "[]") as Question[] | null) ?? [],
  };
}
