// Builds .test-work/ once per `bun test` run. It holds a corpus repo and a book repo,
// each with a bare origin, plus a fake HOME, and indexes them once.
import { expect } from "bun:test";
import type { Database } from "bun:sqlite";
import { openIndex } from "../src/store";
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

/** A seat name that is a credential, mapped in through the settings' renames. */
export const SEAT_TOKEN = ["xox", "p-", "5555555555-", "TokenSeatAbCdEf"].join("");
/** A working directory that holds a credential. */
export const CWD_TOKEN = ["gh", "p_", "Cw9".repeat(12)].join("");

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

/** Reads the fixture index, closing it the way the command does so no -wal or -shm is left. */
export function readIndex<T>(read: (db: Database) => T): T {
  const db = openIndex(join(DATA, "index.db"));
  try {
    return read(db);
  } finally {
    db.close(true);
  }
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
  cwd: ['\\.test-work/']
  exclude: ['library-desk']
  seats:
    root: ~/seats
    renames:
      old-desk: new-desk
      token-desk: ${SEAT_TOKEN}
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
export const UNPUSHED_SHA = commitLocal(CORPUS, "Add unpushedterm notes", "2026-10-02T12:00:00Z");
appendFileSync(join(CORPUS, "README.md"), "A workingcopyonly edit.\n");
write(join(BOOK, "librarian", "librarian.yaml"), settings(2));
commitLocal(BOOK, "Rank notes higher, unpushed", "2026-10-02T12:00:00Z");

// Session fixtures. Field names follow the real Claude Code and Codex formats; see
// "Context for the executor" in tasks-slice-2.md.
export const CLAUDE_SESSION = "11111111-1111-4111-8111-111111111111";
export const CODEX_SESSION = "22222222-2222-4222-8222-222222222222";
export const SEAT_SESSION = "33333333-3333-4333-8333-333333333333";
export const TOKEN_SEAT_SESSION = "77777777-7777-4777-8777-777777777777";
export const BOUNDARY_SESSION = "88888888-8888-4888-8888-888888888888";
export const NEG_SESSION = "99999999-9999-4999-8999-999999999999";
export const CODEX_BOUNDARY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const CODEX_MOVED_IN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const CODEX_MOVED_OUT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
/** Over 600 characters: a head, a middle with one error line, and a tail. */
export const LONG_OUTPUT = `BEGINMARK ${"headpad ".repeat(30)}${"deepmiddle ".repeat(60)}\nfatal: zorgonerror happened\n${"deepmiddle ".repeat(60)}${"tailpad ".repeat(30)}ENDMARK`;
/** Secret pieces that trimming or cutting would separate from their prefix, and their probes. */
export const BOUNDARY_PROBES = ["tailsecret", "Kt5Kt5Kt5", "rZXktdjFib3VuZGFyeQ", "cutpasswor", "codextailsecret"];
const TAIL_VALUE = ["tail", "secret-", "value-9999"].join("");
const TAIL_KEY = ["sk-ant-", "api03-", "Kt5".repeat(10)].join("");
const KEY_LINES = [["-----BEGIN ", "OPENSSH PRIVATE KEY-----"].join(""), ["-----END ", "OPENSSH PRIVATE KEY-----"].join("")];
const CUT_VALUE = ["cutpass", "word-", "value-12345"].join("");
const CODEX_TAIL_VALUE = ["codex", "tailsecret-", "77777"].join("");

const jsonl = (records: object[]) => `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
const turnsAt = (sessionId: string, cwd: string, day: string, records: object[]) =>
  records.map((record, i) => ({ sessionId, cwd, timestamp: `${day}T10:${String(i).padStart(2, "0")}:00.000Z`, ...record }));
const userSays = (content: unknown, more: object = {}) => ({ type: "user", message: { role: "user", content }, ...more });
const assistantSays = (content: object[]) => ({
  type: "assistant",
  message: { role: "assistant", model: "claude-opus-5-5", content },
});
const toolUse = (id: string, name: string, input: object) => ({ type: "tool_use", id, name, input });
const toolResult = (id: string, content: unknown) => ({ type: "tool_result", tool_use_id: id, content });
/** One tool call and its result, as an assistant record and a user record. */
const toolTurn = (id: string, name: string, input: object, output: unknown) => [
  assistantSays([toolUse(id, name, input)]),
  userSays([toolResult(id, output)]),
];
const PROJECTS = join(HOME, ".claude", "projects");
const claudeFile = (dir: string, id: string, cwd: string, records: object[]) =>
  write(join(PROJECTS, dir, `${id}.jsonl`), jsonl(turnsAt(id, cwd, "2026-10-03", records)));
const quickSession = (id: string, cwd: string, prompt: string) => claudeFile("-fixture-other", id, cwd, [userSays(prompt)]);
const INSTALLED_CLI = "/home/op/.local/share/openrig-librarian/app/src/cli.ts";

write(
  join(PROJECTS, "-fixture-corpus", `${CLAUDE_SESSION}.jsonl`),
  jsonl([
    { type: "ai-title", aiTitle: "Fixture session title", sessionId: CLAUDE_SESSION },
    ...turnsAt(CLAUDE_SESSION, CORPUS, "2026-10-03", [
      userSays("How do I configure the quuxwidget?"),
      userSays([{ type: "text", text: "A metaonlyterm reminder." }], { isMeta: true }),
      assistantSays([
        { type: "thinking", thinking: "thinkingonlyterm", signature: "sig" },
        { type: "text", text: "Use the quuxwidget flag." },
      ]),
      ...toolTurn(
        "t1",
        "Bash",
        { command: "git commit -m 'Fix the quuxwidget'" },
        `[main ${FIRST_SHA.slice(0, 7)}] Fix the quuxwidget\n deadbee ${UNPUSHED_SHA.slice(0, 7)}`,
      ),
      ...toolTurn("t2", "Read", { file_path: "notes.md" }, [{ type: "text", text: "shortresult zephyrsession" }]),
      ...toolTurn("t3", "Bash", { command: "cat build.log" }, LONG_OUTPUT),
      ...toolTurn("t4", "mcp__librarian__search", { query: "dns" }, "librarianoutputterm cards"),
      ...toolTurn("t5", "Bash", { command: "librarian search --book plans:librarian dns" }, "librarianshellterm cards"),
      ...toolTurn("t6", "Bash", { command: "bun src/cli.ts search --book plans:librarian dns" }, "librarianrelterm cards"),
      ...toolTurn("t7", "Bash", { command: `bun ${INSTALLED_CLI} ask "why"` }, "librarianabsterm cards"),
      userSays(SECRETS.map((secret, i) => `sessionmarker${i} ${secret.text} after.`).join("\n\n")),
    ]),
  ]),
);
write(
  join(PROJECTS, "-fixture-corpus", CLAUDE_SESSION, "subagents", "agent-a1.jsonl"),
  jsonl(
    turnsAt(CLAUDE_SESSION, CORPUS, "2026-10-03", [
      userSays("A subagentterm question.", { isSidechain: true, agentId: "a1" }),
      { ...assistantSays([{ type: "text", text: "A subagent answer." }]), isSidechain: true, agentId: "a1" },
    ]),
  ),
);
claudeFile("-fixture-seat", SEAT_SESSION, join(HOME, "seats", "old-desk"), [userSays("A seatworkterm task.")]);
claudeFile("-fixture-seat", TOKEN_SEAT_SESSION, join(HOME, "seats", "token-desk"), [userSays("A tokenseatterm task.")]);
claudeFile("-fixture-other", BOUNDARY_SESSION, CORPUS, [
  userSays("A boundaryterm check."),
  ...toolTurn("b1", "Bash", { command: "cat a.log" }, `${"a".repeat(1000)} password=${TAIL_VALUE} ${"z".repeat(148 - TAIL_VALUE.length - 1)}`),
  ...toolTurn("b2", "Bash", { command: "cat b.log" }, `${"c".repeat(800)} ${TAIL_KEY} ${"y".repeat(115)}`),
  ...toolTurn(
    "b3",
    "Bash",
    { command: "cat c.log" },
    `${"d".repeat(800)}\n${KEY_LINES[0]}\n${"A".repeat(90)}rZXktdjFib3VuZGFyeQ${"B".repeat(11)}\n${KEY_LINES[1]}\n`,
  ),
  ...toolTurn("b4", "Write", { file_path: "notes.md", content: `${"e".repeat(1445)} password=${CUT_VALUE}` }, "ok"),
]);
claudeFile("-fixture-other", NEG_SESSION, CORPUS, [
  userSays("A negcommitterm check."),
  ...toolTurn("n1", "Bash", { command: 'git log -1 --format="commit %H"' }, `commit ${FIRST_SHA}`),
  ...toolTurn("n2", "Bash", { command: 'echo "git commit"' }, `git commit ${FIRST_SHA}`),
  ...toolTurn("n3", "Read", { file_path: "docs/git-commit-guide.md" }, `The guide cites ${FIRST_SHA}.`),
]);
quickSession("44444444-4444-4444-8444-444444444444", join(HOME, "seats", "library-desk-claude"), "A deskterm question.");
quickSession("55555555-5555-4555-8555-555555555555", join(DATA, "interviews"), "An interviewterm question.");
quickSession("66666666-6666-4666-8666-666666666666", "/elsewhere/project", "An elsewhereterm question.");
quickSession("dddddddd-dddd-4ddd-8ddd-dddddddddddd", join(WORK, CWD_TOKEN), "A credcwdterm task.");

const codexAt = (records: Array<[string, object]>) =>
  records.map(([type, payload], i) => ({
    timestamp: `2026-10-04T09:${String(i).padStart(2, "0")}:00.000Z`,
    ordinal: i,
    type,
    payload,
  }));
const codexFile = (id: string, records: Array<[string, object]>) =>
  write(join(HOME, ".codex", "sessions", "2026", "10", "04", `rollout-2026-10-04T09-00-00-${id}.jsonl`), jsonl(codexAt(records)));
const said = (role: string, text: string): [string, object] => [
  "response_item",
  { type: "message", role, content: [{ type: role === "assistant" ? "output_text" : "input_text", text }] },
];
const execCall = (callId: string, program: string, output: string): Array<[string, object]> => [
  ["response_item", { type: "custom_tool_call", name: "exec", call_id: callId, input: program }],
  ["response_item", { type: "custom_tool_call_output", call_id: callId, output: [{ type: "input_text", text: output }] }],
];

codexFile(CODEX_SESSION, [
  ["session_meta", { id: CODEX_SESSION, cwd: CORPUS, timestamp: "2026-10-04T09:00:00.000Z" }],
  ["turn_context", { cwd: CORPUS, model: "gpt-6-luna" }],
  said("developer", "developerterm rules"),
  said("user", "<environment_context>envterm</environment_context>"),
  said("user", "A codexquestionterm about the corpus."),
  ...execCall(
    "c1",
    'const out = await tools.exec_command({cmd:"git commit -m \\"Codex change\\""}); text(out)',
    `[main ${FIRST_SHA.slice(0, 7)}] Codex change`,
  ),
  ["response_item", { type: "custom_tool_call", name: "apply_patch", call_id: "c2", input: "*** Begin Patch patchterm" }],
  ["response_item", { type: "custom_tool_call_output", call_id: "c2", output: [{ type: "input_text", text: "Done" }] }],
  ...execCall("c3", 'await tools.exec_command({cmd:"bun src/cli.ts search --book x dns"})', "codexlibrelterm cards"),
  ...execCall("c4", `await tools.exec_command({cmd:"bun ${INSTALLED_CLI} ask \\"why\\""})`, "codexlibabsterm cards"),
  ...execCall("c5", 'await tools.librarian__search({query:"dns"})', "codexlibmcpterm cards"),
  ["response_item", { type: "reasoning", encrypted_content: "reasoningterm" }],
  said("assistant", "The codexanswerterm is ready."),
]);
codexFile(CODEX_BOUNDARY, [
  ["session_meta", { id: CODEX_BOUNDARY, cwd: CORPUS, timestamp: "2026-10-04T09:00:00.000Z" }],
  ["turn_context", { cwd: CORPUS, model: "gpt-6-luna" }],
  said("user", "A codexboundaryterm check."),
  ...execCall(
    "d1",
    'await tools.exec_command({cmd:"cat d.log"})',
    `${"a".repeat(1000)} token=${CODEX_TAIL_VALUE} ${"z".repeat(148 - CODEX_TAIL_VALUE.length - 1)}`,
  ),
  ...execCall("d2", 'const r = await tools.exec_command({cmd:"git log --format=commit"}); text(r)', FIRST_SHA),
]);
codexFile(CODEX_MOVED_IN, [
  ["session_meta", { id: CODEX_MOVED_IN, cwd: "/elsewhere/start", timestamp: "2026-10-04T09:00:00.000Z" }],
  ["turn_context", { cwd: CORPUS, model: "gpt-6-luna" }],
  ["turn_context", { cwd: CORPUS, model: "gpt-6-luna" }],
  ["turn_context", { cwd: CORPUS, model: "gpt-6-luna" }],
  said("user", "A codexmovedinterm task."),
  ["response_item", { type: "function_call", name: "exec_command", call_id: "m1", arguments: JSON.stringify({ cmd: "git commit -m 'Moved change'" }) }],
  ["response_item", { type: "function_call_output", call_id: "m1", output: `[main ${FIRST_SHA.slice(0, 7)}] Moved change` }],
]);
codexFile(CODEX_MOVED_OUT, [
  ["session_meta", { id: CODEX_MOVED_OUT, cwd: CORPUS, timestamp: "2026-10-04T09:00:00.000Z" }],
  ["turn_context", { cwd: join(HOME, "seats", "library-desk-codex"), model: "gpt-6-luna" }],
  ["turn_context", { cwd: join(HOME, "seats", "library-desk-codex"), model: "gpt-6-luna" }],
  ["turn_context", { cwd: join(HOME, "seats", "library-desk-codex"), model: "gpt-6-luna" }],
  said("user", "A codexdeskterm question."),
]);

/** The fixture's one update. A test asserts it succeeded; setup never throws on it. */
export const FIXTURE_UPDATE = librarian("update", "--book", BOOK_REF);
