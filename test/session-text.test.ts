import { describe, expect, test } from "bun:test";
import {
  confirmCommits,
  cutInput,
  dominant,
  firstLine,
  hexTokens,
  isCommitCall,
  isLibrarianCall,
  keepSession,
  seatOf,
  shellCommands,
  textOf,
  trimToolOutput,
  type SessionContext,
} from "../src/sources/sessions";
import { CORPUS, FIRST_SHA, UNPUSHED_SHA } from "./setup";

const context = (cwd: string[], exclude: string[], dataDir: string): SessionContext => ({
  home: "/home/fixture",
  dataDir,
  sessions: { cwd, exclude },
  repos: [],
});
const BEGIN = ["-----BEGIN ", "OPENSSH PRIVATE KEY-----"].join("");
const END = ["-----END ", "OPENSSH PRIVATE KEY-----"].join("");

describe("trimToolOutput", () => {
  test("keeps output under 600 characters whole", () => {
    expect(trimToolOutput("short output")).toBe("short output");
  });

  test("keeps the first and last 150 characters and the error lines, and drops the rest", () => {
    const long = `START${"h".repeat(200)}\n${"m".repeat(300)}\nfatal: boom\n${"n".repeat(300)}\n${"t".repeat(200)}END`;
    const out = trimToolOutput(long);
    expect(out).toContain("START");
    expect(out).toContain("END");
    expect(out).toContain("fatal: boom");
    expect(out).not.toContain("mmm");
    expect(out).not.toContain("nnn");
  });

  test("spends at most 300 characters on error lines", () => {
    const many = `HEAD${"x".repeat(200)}\n${Array.from({ length: 100 }, (_, i) => `error line ${i}`).join("\n")}\n${"y".repeat(200)}TAIL`;
    const out = trimToolOutput(many);
    expect(out).toContain("error line 0");
    expect(out.length).toBeLessThanOrEqual(606);
  });

  test("redacts before trimming: an assignment whose key falls outside the tail", () => {
    const value = ["tail", "secret-", "value-9999"].join("");
    const out = trimToolOutput(`${"a".repeat(1000)} password=${value} ${"z".repeat(148 - value.length - 1)}`);
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("tailsecret");
  });

  test("redacts before trimming: a key whose prefix falls outside the tail", () => {
    const key = ["sk-ant-", "api03-", "Kt5".repeat(10)].join("");
    const out = trimToolOutput(`${"c".repeat(800)} ${key} ${"y".repeat(115)}`);
    expect(out).toContain("[REDACTED:anthropic]");
    expect(out).not.toContain("Kt5Kt5");
  });

  test("redacts before trimming: a private key whose BEGIN line falls in the dropped middle", () => {
    const body = `${"A".repeat(90)}rZXktdjFib3VuZGFyeQ${"B".repeat(11)}`;
    const out = trimToolOutput(`${"d".repeat(800)}\n${BEGIN}\n${body}\n${END}\n`);
    expect(out).toContain("[REDACTED:private_key_block]");
    expect(out).not.toContain("rZXktdjFib3VuZGFyeQ");
  });
});

describe("cutInput and firstLine", () => {
  test("cutInput redacts the whole input before cutting it to 1,500 characters", () => {
    const value = ["cutpass", "word-", "value-12345"].join("");
    const input = JSON.stringify({ file_path: "notes.md", content: `${"e".repeat(1445)} password=${value}` });
    const out = cutInput(input);
    expect(out).toContain("password=[REDACTED]");
    expect(out).not.toContain("cutpasswor");
    expect(out.length).toBeLessThanOrEqual(1500);
  });

  test("firstLine redacts before taking the first line", () => {
    const key = ["sk-ant-", "api03-", "Tl8".repeat(10)].join("");
    expect(firstLine(`${"t".repeat(100)} ${key}\nmore`)).toContain("[REDACTED:anthropic]");
    expect(firstLine("\n  Title line\nmore")).toBe("Title line");
  });

  test("textOf reads a string or a list of text parts", () => {
    expect(textOf("plain")).toBe("plain");
    expect(textOf([{ type: "text", text: "a" }, { type: "text", text: "b" }])).toBe("a\nb");
    expect(textOf(undefined)).toBe("");
  });
});

describe("calls", () => {
  test("isLibrarianCall spots Librarian tools, the executable and the script, at relative or installed paths", () => {
    expect(isLibrarianCall("mcp__librarian__search", "{}")).toBe(true);
    expect(isLibrarianCall("Bash", JSON.stringify({ command: "librarian search --book x dns" }))).toBe(true);
    expect(isLibrarianCall("Bash", JSON.stringify({ command: "bun src/cli.ts search --book x dns" }))).toBe(true);
    expect(
      isLibrarianCall("Bash", JSON.stringify({ command: 'bun /home/op/.local/share/openrig-librarian/app/src/cli.ts ask "why"' })),
    ).toBe(true);
    expect(isLibrarianCall("exec", 'await tools.exec_command({cmd:"bun src/cli.ts search --book x dns"})')).toBe(true);
    expect(isLibrarianCall("exec", 'await tools.librarian__search({query:"dns"})')).toBe(true);
    expect(isLibrarianCall("Bash", JSON.stringify({ command: "echo the librarian command" }))).toBe(false);
    expect(isLibrarianCall("Bash", JSON.stringify({ command: "bun src/cli.ts build" }))).toBe(false);
  });

  test("shellCommands reads Bash, exec_command, shell, and the cmd strings inside an exec program", () => {
    expect(shellCommands("Bash", JSON.stringify({ command: "ls" }))).toEqual(["ls"]);
    expect(shellCommands("exec_command", JSON.stringify({ cmd: "pwd" }))).toEqual(["pwd"]);
    expect(shellCommands("shell", JSON.stringify({ command: ["bash", "-lc", "make test"] }))).toEqual(["make test"]);
    expect(shellCommands("exec", 'const a = await tools.exec_command({cmd:"git status"}); text(a)')).toEqual(["git status"]);
    expect(shellCommands("Read", JSON.stringify({ file_path: "x" }))).toEqual([]);
  });

  test("isCommitCall is true only for a shell tool running git commit", () => {
    expect(isCommitCall("Bash", JSON.stringify({ command: "cd repo && git commit -m 'x'" }))).toBe(true);
    expect(isCommitCall("Bash", JSON.stringify({ command: "git -C repo -c user.name=x commit -q" }))).toBe(true);
    expect(isCommitCall("exec", 'const r = await tools.exec_command({cmd:"git commit -m \\"x\\""}); text(r)')).toBe(true);
    expect(isCommitCall("exec_command", JSON.stringify({ cmd: "git commit -m y" }))).toBe(true);
    expect(isCommitCall("shell", JSON.stringify({ command: ["bash", "-lc", "git commit -m z"] }))).toBe(true);
    expect(isCommitCall("Bash", JSON.stringify({ command: 'git log -1 --format="commit %H"' }))).toBe(false);
    expect(isCommitCall("Bash", JSON.stringify({ command: 'echo "git commit"' }))).toBe(false);
    expect(isCommitCall("Read", JSON.stringify({ file_path: "docs/git-commit-guide.md" }))).toBe(false);
    expect(isCommitCall("exec", 'await tools.exec_command({cmd:"git log --format=commit"})')).toBe(false);
  });

  test("hexTokens finds each 7-40 character lowercase hex word once", () => {
    expect(hexTokens("[main abc1234] fix deadbee 655dd9f ABCDEF0 abc1234")).toEqual(["abc1234", "deadbee", "655dd9f"]);
  });
});

describe("which sessions", () => {
  test("dominant picks the most frequent directory", () => {
    expect(dominant(new Map([["/start", 1], ["/work", 3]]))).toBe("/work");
    expect(dominant(new Map())).toBe("");
  });

  test("keepSession needs an included directory, outside the excludes and the data directory", () => {
    const c = context(["/work/"], ["desk"], "/work/data/rig");
    expect(keepSession(c, "/work/project")).toBe(true);
    expect(keepSession(c, "/work/desk-1")).toBe(false);
    expect(keepSession(c, "/work/data/rig/interviews")).toBe(false);
    expect(keepSession(c, "/elsewhere")).toBe(false);
    expect(keepSession(c, "")).toBe(false);
  });

  test("seatOf names the seat directory under the root, through renames", () => {
    const seats = { root: "/seats", renames: { "old-desk": "new-desk" } };
    expect(seatOf(seats, "/seats/old-desk/sub")).toBe("new-desk");
    expect(seatOf(seats, "/seats/dev-one")).toBe("dev-one");
    expect(seatOf(seats, "/other/dev-one")).toBeUndefined();
    expect(seatOf(undefined, "/seats/dev-one")).toBeUndefined();
  });

  test("confirmCommits keeps only tokens that are commits on origin/main", () => {
    const repos = [{ name: "corpus", path: CORPUS, docs: [] }];
    expect(confirmCommits([FIRST_SHA.slice(0, 7), "deadbee", UNPUSHED_SHA.slice(0, 7)], repos)).toEqual([
      `commit:corpus/${FIRST_SHA.slice(0, 9)}`,
    ]);
  });
});
