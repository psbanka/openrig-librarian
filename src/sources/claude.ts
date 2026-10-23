// Claude Code sessions: ~/.claude/projects/<dir>/<id>.jsonl, and each one's subagents.
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

export async function* claudeSessions(context: SessionContext): AsyncGenerator<SourceItem> {
  const root = join(context.home, ".claude", "projects");
  if (!existsSync(root)) return;
  for (const path of new Bun.Glob("*/*.jsonl").scanSync({ cwd: root })) yield* readSession(context, join(root, path), null);
  for (const path of new Bun.Glob("*/*/subagents/*.jsonl").scanSync({ cwd: root }))
    yield* readSession(context, join(root, path), basename(path, ".jsonl"));
}

/** One transcript file: a main session (agent null) or a subagent. Yields nothing when filtered out. */
async function* readSession(context: SessionContext, path: string, agent: string | null): AsyncGenerator<SourceItem> {
  let id = "";
  let last = "";
  let model: string | undefined;
  let firstPrompt = "";
  const titles = { custom: "", ai: "", agent: "" };
  const cwds = new Map<string, number>();
  const turns: string[] = [];
  const calls = new Map<string, { name: string; librarian: boolean; commit: boolean }>();
  const tokens: string[] = [];
  for await (const line of lines(path)) {
    if (line.length > MAX_LINE) continue;
    const record = parse(line);
    if (!record) continue;
    if (record.type === "custom-title") titles.custom = record.customTitle ?? titles.custom;
    if (record.type === "ai-title") titles.ai = record.aiTitle ?? titles.ai;
    if (record.type === "agent-name") titles.agent = record.agentName ?? titles.agent;
    if (record.type !== "user" && record.type !== "assistant") continue;
    id ||= record.sessionId ?? "";
    if (record.timestamp) last = record.timestamp;
    if (record.cwd) cwds.set(record.cwd, (cwds.get(record.cwd) ?? 0) + 1);
    if (record.isMeta || record.isCompactSummary) continue;
    const content = record.message?.content;
    if (record.type === "assistant") {
      model = record.message?.model ?? model;
      for (const block of Array.isArray(content) ? content : []) {
        if (block?.type === "text" && block.text?.trim()) turns.push(`ASSISTANT: ${block.text}`);
        if (block?.type === "tool_use") {
          const name = String(block.name ?? "");
          const input = typeof block.input === "string" ? block.input : JSON.stringify(block.input ?? {});
          calls.set(block.id, { name, librarian: isLibrarianCall(name, input), commit: isCommitCall(name, input) });
          turns.push(`TOOL ${name}: ${cutInput(input)}`);
        }
      }
      continue;
    }
    const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
    for (const block of blocks) {
      if (block?.type === "text" && block.text?.trim()) {
        turns.push(`USER: ${block.text}`);
        firstPrompt ||= block.text;
      }
      if (block?.type === "tool_result") {
        const call = calls.get(block.tool_use_id);
        const output = textOf(block.content);
        if (call?.commit) tokens.push(...hexTokens(output));
        turns.push(`OUTPUT ${call?.name ?? "tool"}: ${call?.librarian ? LIBRARIAN_OMITTED : trimToolOutput(output)}`);
      }
    }
  }
  const cwd = dominant(cwds);
  if (!id || !turns.length || !keepSession(context, cwd)) return;
  const stat = statSync(path);
  yield {
    kind: "session",
    ref: agent ? `claude:${id}/${agent}` : `claude:${id}`,
    title: titles.custom || titles.ai || titles.agent || firstLine(firstPrompt) || cwd,
    date: last,
    text: turns.join("\n\n"),
    version: `${stat.size}:${stat.mtimeMs}`,
    session: {
      harness: "claude",
      id: agent ?? id,
      cwd,
      parent: agent ? id : undefined,
      seat: seatOf(context.sessions.seats, cwd),
      model,
      commits: confirmCommits(tokens, context.repos),
    },
  };
}
