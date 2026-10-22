// Builds .test-work/ once per `bun test` run. It holds a corpus repo and a book repo,
// each with a bare origin, plus a fake HOME, and indexes them once.
import { expect } from "bun:test";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { SearchResult } from "../src/types";

export const ROOT = resolve(import.meta.dir, "..");
export const WORK = join(ROOT, ".test-work");
export const HOME = join(WORK, "home");
export const TMP = join(WORK, "tmp");
export const CORPUS = join(WORK, "corpus");
export const BOOK = join(WORK, "book");
export const BOOK_REF = `${BOOK}:librarian`;
export const DATA = join(HOME, ".local", "share", "openrig-librarian", "test-rig");

/** Fake credentials, assembled from pieces so no whole token is ever committed. */
export const SECRETS = [
  { kind: "Anthropic key", text: ["sk-ant-", "api03-", "Qz7".repeat(10)].join(""), probe: "Qz7Qz7Qz7" },
  { kind: "OpenAI key", text: ["sk-", "proj-", "Ab1".repeat(10)].join(""), probe: "Ab1Ab1Ab1" },
  { kind: "Slack token", text: ["xox", "b-", "1234567890-", "AbCdEfGhIjKl"].join(""), probe: "AbCdEfGhIjKl" },
  {
    kind: "private key block",
    text: ["-----BEGIN ", "OPENSSH PRIVATE KEY-----\n", "b3BlbnNzaC1rZXktdjE", "\n-----END ", "OPENSSH PRIVATE KEY-----"].join(
      "",
    ),
    probe: "b3BlbnNzaC1rZXktdjE",
  },
  {
    kind: "password assignment",
    text: ["pass", "word=", "hunter2-", "correct-", "horse"].join(""),
    probe: "hunter2-correct-horse",
  },
].map((secret, i) => ({ ...secret, marker: `plantmarker${i}` }));

const GIT_ENV = {
  PATH: process.env.PATH ?? "",
  HOME,
  TMPDIR: TMP,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};

function sh(cwd: string, args: string[], extra: Record<string, string> = {}): string {
  const run = Bun.spawnSync(args, { cwd, env: { ...GIT_ENV, ...extra }, stdout: "pipe", stderr: "pipe" });
  if (!run.success) throw new Error(`${args.join(" ")} (in ${cwd}): ${run.stderr.toString()}`);
  return run.stdout.toString().trim();
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A working repo at `dir` whose origin is a bare repo at `dir.git`. */
function repo(dir: string): void {
  sh(WORK, ["git", "init", "-q", "--bare", "-b", "main", `${dir}.git`]);
  sh(WORK, ["git", "init", "-q", "-b", "main", dir]);
  sh(dir, ["git", "remote", "add", "origin", `${dir}.git`]);
}

/** Commits everything in `dir` at `date` without pushing, and returns the sha. */
function commitLocal(dir: string, message: string, date: string): string {
  sh(dir, ["git", "add", "."]);
  sh(dir, ["git", "commit", "-q", "-m", message], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  return sh(dir, ["git", "rev-parse", "HEAD"]);
}

/** Commits everything in `dir` at `date`, pushes it, and returns the sha. */
function commit(dir: string, message: string, date: string): string {
  const sha = commitLocal(dir, message, date);
  sh(dir, ["git", "push", "-q", "origin", "main"]);
  return sha;
}

/** Runs the librarian command as a seat would: a bare environment and a fake HOME. */
export function librarian(...args: string[]): { code: number; stdout: string; stderr: string } {
  const run = Bun.spawnSync([process.execPath, join(ROOT, "src", "cli.ts"), ...args], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? "", HOME, TMPDIR: TMP, GIT_CONFIG_NOSYSTEM: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: run.exitCode ?? -1, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
}

/** A search's JSON; a failed search fails the calling test on an assertion. */
export function searchJson(query: string): SearchResult {
  const run = librarian("search", "--book", BOOK_REF, "--json", query);
  expect(run.code).toBe(0);
  return JSON.parse(run.stdout) as SearchResult;
}

const settings = (notesAuthority: number) => `rig: test-rig
repos:
  - name: corpus
    path: ${CORPUS}
    docs: ["**/*.md"]
folders:
  - name: notes
    path: ~/notes
    globs: ["*.md"]
    authority: ${notesAuthority}
sessions:
  cwd: ["corpus"]
  exclude: []
judge:
  url: http://127.0.0.1:9/api/v1/systemone
  model: typesafe/jev-1.13
embed:
  url: http://127.0.0.1:11434
  model: nomic-embed-text
connect:
  codexSandbox: workspace-write
  codexProfile: luna
`;

rmSync(WORK, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(HOME, { recursive: true });

repo(CORPUS);
write(join(CORPUS, "README.md"), "# Corpus\n\nThe zephyrine-doc guide lives here. celilo-apt-repo publishes packages.\n");
export const FIRST_SHA = commit(CORPUS, "Start the corpus", "2026-09-01T12:00:00Z");
write(join(CORPUS, "docs", "ids.md"), `Commit ${FIRST_SHA} started the corpus.\n`);
write(join(CORPUS, "docs", "secrets.md"), `${SECRETS.map((s) => `${s.marker} ${s.text} after.`).join("\n\n")}\n`);
// A credential in a file name: SECRETS[2] is the Slack token.
write(join(CORPUS, "docs", `${SECRETS[2].text}.md`), "A zephyrine-secretname note.\n");
// 250 chunks that each outrank other.md on "floodterm".
write(join(CORPUS, "docs", "flood.md"), Array.from({ length: 250 }, () => "floodterm ".repeat(160)).join("\n\n"));
write(join(CORPUS, "docs", "other.md"), `A single floodterm among many other words. ${"filler ".repeat(40)}\n`);
write(join(CORPUS, "docs", "unicode.md"), "Le café est prêt. 日本語 テキスト.\n");
commit(CORPUS, `Add zephyrine-commit notes\n\nA key in a commit message: ${SECRETS[0].text}\n`, "2026-10-01T12:00:00Z");
write(join(HOME, "notes", "memory.md"), "A zephyrine-note to remember.\n");

repo(BOOK);
write(join(BOOK, "librarian", "librarian.yaml"), settings(3));
commit(BOOK, "Add the book", "2026-10-01T12:00:00Z");

// Work that never reached origin/main. The Librarian must see none of it.
write(join(CORPUS, "docs", "unpushed.md"), "An unpushedterm doc.\n");
commitLocal(CORPUS, "Add unpushedterm notes", "2026-10-02T12:00:00Z");
appendFileSync(join(CORPUS, "README.md"), "A workingcopyonly edit.\n");
write(join(BOOK, "librarian", "librarian.yaml"), settings(2));
commitLocal(BOOK, "Rank notes higher, unpushed", "2026-10-02T12:00:00Z");

/** The fixture's one update. A test asserts it succeeded; setup never throws on it. */
export const FIXTURE_UPDATE = librarian("update", "--book", BOOK_REF);
