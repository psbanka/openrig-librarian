// What the Claude and Codex readers share: streaming lines, reading records loosely,
// shortening text (always after redacting it), spotting Librarian and commit calls,
// choosing sessions, and confirming the commits a session made.
import { expandHome, type Settings } from "../book";
import { git } from "../git";
import { redact } from "../redact";

export interface SessionContext {
  home: string;
  /** The rig's data directory. Sessions run inside it, such as interviews, are never indexed. */
  dataDir: string;
  sessions: Settings["sessions"];
  repos: Settings["repos"];
}

/** Replaces a Librarian call's output, so the index never cites itself. */
export const LIBRARIAN_OMITTED = "[librarian output omitted]";
/** Tool call inputs are cut here: a Write call can carry a whole file, and graft maps code. */
export const TOOL_CALL_LIMIT = 1500;
/** Lines longer than this are skipped unparsed. */
export const MAX_LINE = 2_000_000;

const ERROR_WORDS = /\b(?:errors?|fail(?:ed|ure|s)?|fatal|exception|denied|refused|panic|traceback|cannot|not found)\b/i;
const LIBRARIAN_SUBCOMMAND =
  "(?:update|search|ask|cite-check|dossier|phrasebook|connect|consult|coverage|mine|scorecard|interview|mcp)\\b";
/** The executable, or the script entry point at a relative or installed path, then a subcommand. */
const LIBRARIAN_COMMAND = new RegExp(`(?:^|[\\s"'\`;&|(])(?:\\S*/)?(?:librarian|src/cli\\.ts)\\s+${LIBRARIAN_SUBCOMMAND}`);
/** An MCP tool name, as Claude spells it or as Codex code mode calls it. */
const LIBRARIAN_TOOL = /\b(?:mcp__)?librarian__\w+/;
const SHELL_TOOLS = new Set(["Bash", "exec_command", "shell", "local_shell"]);

/** Streams a file's lines without loading it whole; one Codex transcript runs to 799 MB. */
export async function* lines(path: string): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let tail = "";
  for await (const chunk of Bun.file(path).stream()) {
    const parts = (tail + decoder.decode(chunk, { stream: true })).split("\n");
    tail = parts.pop() ?? "";
    yield* parts;
  }
  tail += decoder.decode();
  if (tail) yield tail;
}

/** One transcript record, or null. The formats aren't ours, so they're read loosely. */
export function parse(line: string): any {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** The text a block carries: a string, or a list of `{ text }` parts. */
export function textOf(content: any): string {
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.map((part: any) => part?.text ?? "").join("\n") : "";
}

// Every function below that shortens text redacts the whole text first: shortening can
// separate a secret from the prefix that identifies it (password=, sk-ant-, BEGIN … KEY).

const MARKER = /\[REDACTED[^\]]*\]/g;

/** `end`, moved past any redaction marker it would split. */
function safeEnd(text: string, end: number): number {
  for (const marker of text.matchAll(MARKER))
    if (marker.index < end && marker.index + marker[0].length > end) return marker.index + marker[0].length;
  return end;
}

/** `start`, moved back to the beginning of any redaction marker it would split. */
function safeStart(text: string, start: number): number {
  for (const marker of text.matchAll(MARKER))
    if (marker.index < start && marker.index + marker[0].length > start) return marker.index;
  return start;
}

export function firstLine(text: string): string {
  const line = redact(text).trim().split("\n")[0] ?? "";
  return line.slice(0, safeEnd(line, 120));
}

/** Whole under 600 characters; otherwise the first 150, the last 150 and up to 300 of error lines. */
export function trimToolOutput(text: string): string {
  const clean = redact(text);
  if (clean.length < 600) return clean;
  const headEnd = safeEnd(clean, 150);
  const tailStart = Math.max(headEnd, safeStart(clean, clean.length - 150));
  const errorLines = clean
    .slice(headEnd, tailStart)
    .split("\n")
    .filter((line) => ERROR_WORDS.test(line))
    .join("\n");
  const errors = errorLines.slice(0, safeEnd(errorLines, 300));
  return [clean.slice(0, headEnd), errors, clean.slice(tailStart)].filter(Boolean).join("\n…\n");
}

/** A tool call's input, redacted whole and then cut to TOOL_CALL_LIMIT, never inside a marker. */
export function cutInput(text: string): string {
  const clean = redact(text);
  return clean.slice(0, safeEnd(clean, TOOL_CALL_LIMIT));
}

export function isLibrarianCall(name: string, input: string): boolean {
  return /librarian/i.test(name) || LIBRARIAN_COMMAND.test(input) || LIBRARIAN_TOOL.test(input);
}

/**
 * The shell commands a tool call runs: Claude's Bash, Codex's exec_command, shell and
 * local_shell, and the tools.exec_command({ cmd: "…" }) calls inside a Codex exec program.
 */
export function shellCommands(name: string, input: string): string[] {
  if (name === "exec")
    return [...input.matchAll(/\bcmd\s*:\s*("(?:[^"\\]|\\.)*")/g)].map((match) => {
      try {
        return String(JSON.parse(match[1]));
      } catch {
        return "";
      }
    });
  if (!SHELL_TOOLS.has(name)) return [];
  const args = parse(input);
  const command = args?.command ?? args?.cmd;
  if (typeof command === "string") return [command];
  if (Array.isArray(command))
    return [/^-l?c$/.test(String(command[1] ?? "")) ? String(command[2] ?? "") : command.join(" ")];
  return [];
}

/** True when some segment of the command is `git [global options] commit …`. */
function isGitCommit(command: string): boolean {
  return command.split(/&&|\|\||[;|\n]/).some((segment) => {
    const words = segment.trim().split(/\s+/);
    let i = 0;
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
    if (words[i] !== "git") return false;
    i++;
    while (i < words.length && words[i].startsWith("-")) i += words[i] === "-C" || words[i] === "-c" ? 2 : 1;
    return words[i] === "commit";
  });
}

/** A shell tool call that runs git commit. Mentions of commits in other calls don't count. */
export function isCommitCall(name: string, input: string): boolean {
  return shellCommands(name, input).some(isGitCommit);
}

export function hexTokens(text: string): string[] {
  return [...new Set(text.match(/\b[0-9a-f]{7,40}\b/g) ?? [])];
}

/** The most frequent directory; the first seen wins a tie. */
export function dominant(counts: Map<string, number>): string {
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

export function keepSession(context: SessionContext, cwd: string): boolean {
  if (!cwd || cwd === context.dataDir || cwd.startsWith(`${context.dataDir}/`)) return false;
  const matches = (patterns: string[]) => patterns.some((pattern) => new RegExp(pattern).test(cwd));
  return matches(context.sessions.cwd) && !matches(context.sessions.exclude);
}

export function seatOf(seats: Settings["sessions"]["seats"], cwd: string): string | undefined {
  if (!seats) return undefined;
  const root = `${expandHome(seats.root).replace(/\/+$/, "")}/`;
  if (!cwd.startsWith(root)) return undefined;
  const dir = cwd.slice(root.length).split("/")[0];
  return dir ? (seats.renames?.[dir] ?? dir) : undefined;
}

/** The tokens that name a commit on origin/main of a repo the book names, as commit refs. */
export function confirmCommits(tokens: string[], repos: Settings["repos"]): string[] {
  const found = new Set<string>();
  for (const token of new Set(tokens))
    for (const repo of repos) {
      const cwd = expandHome(repo.path);
      try {
        const sha = git(cwd, "rev-parse", "--verify", "--quiet", `${token}^{commit}`).trim();
        git(cwd, "merge-base", "--is-ancestor", sha, "origin/main");
        found.add(`commit:${repo.name}/${sha.slice(0, 9)}`);
      } catch {
        // Not a commit on this repo's main: a mention, not authorship.
      }
    }
  return [...found].sort();
}
