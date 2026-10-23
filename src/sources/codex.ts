// Codex sessions: ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl, plus archived ones.
import { existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { SourceItem } from "../types";
import {
  confirmCommits,
  cutInput,
  dominant,
  firstLine,
  hexTokens,
  isCommitCall,
  isLibrarianCall,
  keepSession,
  LIBRARIAN_OMITTED,
  lines,
  MAX_LINE,
  parse,
  seatOf,
  type SessionContext,
  textOf,
  trimToolOutput,
} from "./sessions";

/** Harness preambles Codex sends as user messages: instructions, not the operator's words. */
const PREAMBLE = /^\s*(?:<environment_context|# AGENTS\.md|<user_instructions)/;
/** The record types read; the rest, mostly event_msg and compacted, are skipped unparsed. */
const WANTED = /"type":"(?:response_item|session_meta|turn_context)"/;

export async function* codexSessions(context: SessionContext): AsyncGenerator<SourceItem> {
  for (const dir of ["sessions", "archived_sessions"]) {
    const root = join(context.home, ".codex", dir);
    if (!existsSync(root)) continue;
    for (const path of new Bun.Glob("**/*.jsonl").scanSync({ cwd: root })) yield* readSession(context, join(root, path));
  }
}

async function* readSession(context: SessionContext, path: string): AsyncGenerator<SourceItem> {
  const id = basename(path).match(/([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/)?.[1];
  if (!id) return;
  let last = "";
  let model: string | undefined;
  let firstPrompt = "";
  // session_meta gives the start directory and every turn_context the turn's: the dominant one wins.
  const cwds = new Map<string, number>();
  const turns: string[] = [];
  const calls = new Map<string, { name: string; librarian: boolean; commit: boolean }>();
  const tokens: string[] = [];
  for await (const line of lines(path)) {
    if (line.length > MAX_LINE || !WANTED.test(line)) continue;
    const record = parse(line);
    if (!record) continue;
    const payload = record.payload ?? {};
    if (record.timestamp) last = record.timestamp;
    if (record.type === "session_meta" || record.type === "turn_context") {
      if (payload.cwd) cwds.set(payload.cwd, (cwds.get(payload.cwd) ?? 0) + 1);
      if (record.type === "turn_context") model = payload.model ?? model;
      continue;
    }
    if (record.type !== "response_item") continue;
    if (payload.type === "message") {
      if (payload.role !== "user" && payload.role !== "assistant") continue;
      const text = textOf(payload.content);
      if (!text.trim() || PREAMBLE.test(text)) continue;
      turns.push(`${payload.role === "user" ? "USER" : "ASSISTANT"}: ${text}`);
      if (payload.role === "user") firstPrompt ||= text;
    } else if (payload.type === "function_call" || payload.type === "custom_tool_call") {
      const name = String(payload.name ?? "");
      const input = String(payload.arguments ?? payload.input ?? "");
      calls.set(payload.call_id, { name, librarian: isLibrarianCall(name, input), commit: isCommitCall(name, input) });
      turns.push(`TOOL ${name}: ${cutInput(input)}`);
    } else if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
      const call = calls.get(payload.call_id);
      const output = textOf(payload.output);
      if (call?.commit) tokens.push(...hexTokens(output));
      turns.push(`OUTPUT ${call?.name ?? "tool"}: ${call?.librarian ? LIBRARIAN_OMITTED : trimToolOutput(output)}`);
    }
  }
  const cwd = dominant(cwds);
  if (!turns.length || !keepSession(context, cwd)) return;
  const stat = statSync(path);
  yield {
    kind: "session",
    ref: `codex:${id}`,
    title: firstLine(firstPrompt) || cwd,
    date: last,
    text: turns.join("\n\n"),
    version: `${stat.size}:${stat.mtimeMs}`,
    session: {
      harness: "codex",
      id,
      cwd,
      seat: seatOf(context.sessions.seats, cwd),
      model,
      commits: confirmCommits(tokens, context.repos),
    },
  };
}
