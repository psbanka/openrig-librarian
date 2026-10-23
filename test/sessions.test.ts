import { describe, expect, test } from "bun:test";
import {
  CLAUDE_SESSION,
  CODEX_BOUNDARY,
  CODEX_MOVED_IN,
  CODEX_SESSION,
  FIRST_SHA,
  NEG_SESSION,
  SEAT_SESSION,
  searchJson,
} from "./setup";

const refs = (query: string) => searchJson(query).exact.map((card) => card.ref);
const card = (query: string, ref: string) => searchJson(query).exact.find((candidate) => candidate.ref === ref);
const CLAUDE = `claude:${CLAUDE_SESSION}`;
const CODEX = `codex:${CODEX_SESSION}`;
const COMMIT = `commit:corpus/${FIRST_SHA.slice(0, 9)}`;

describe("Feature: Search the record (sessions)", () => {
  test("Claude sessions, their subagents and Codex sessions are searchable", () => {
    expect(refs("quuxwidget")).toContain(CLAUDE);
    expect(refs("subagentterm")).toContain(`${CLAUDE}/agent-a1`);
    expect(refs("codexquestionterm")).toContain(CODEX);
    expect(refs("codexanswerterm")).toContain(CODEX);
    expect(refs("patchterm")).toContain(CODEX);
  });

  test("A session card carries its title, date, authority and seat", () => {
    const claude = card("quuxwidget", CLAUDE);
    expect(claude?.kind).toBe("session");
    expect(claude?.title).toBe("Fixture session title");
    expect(claude?.authority).toBe(5);
    expect(claude?.date.startsWith("2026-10-03")).toBe(true);
    expect(card("subagentterm", `${CLAUDE}/agent-a1`)?.title).toBe("A subagentterm question.");
    expect(card("seatworkterm", `claude:${SEAT_SESSION}`)?.seat).toBe("new-desk");
  });

  test("A session card names the commits the session made, and only those", () => {
    expect(card("quuxwidget", CLAUDE)?.commits).toEqual([COMMIT]);
    expect(card("codexanswerterm", CODEX)?.commits).toEqual([COMMIT]);
  });

  test("Commit links come only from real commit calls: log output, echoed text and file contents don't count", () => {
    const negative = card("negcommitterm", `claude:${NEG_SESSION}`);
    expect(negative?.kind).toBe("session");
    expect(negative?.commits).toBeUndefined();
    const codex = card("codexboundaryterm", `codex:${CODEX_BOUNDARY}`);
    expect(codex?.kind).toBe("session");
    expect(codex?.commits).toBeUndefined();
  });

  test("A Codex session's working directory is where most of its turns ran", () => {
    expect(card("codexmovedinterm", `codex:${CODEX_MOVED_IN}`)?.commits).toEqual([COMMIT]);
    expect(searchJson("codexdeskterm").exact).toEqual([]);
  });

  test("Short tool output is indexed whole", () => {
    expect(refs("zephyrsession")).toContain(CLAUDE);
  });

  test("Long tool output keeps its ends and its error lines", () => {
    for (const term of ["BEGINMARK", "ENDMARK", "zorgonerror"]) expect(refs(term)).toContain(CLAUDE);
    expect(searchJson("deepmiddle").exact).toEqual([]);
  });

  test("The Librarian's own output never enters the index, whichever way it was called", () => {
    expect(refs("quuxwidget")).toContain(CLAUDE);
    expect(refs("codexanswerterm")).toContain(CODEX);
    for (const term of [
      "librarianoutputterm",
      "librarianshellterm",
      "librarianrelterm",
      "librarianabsterm",
      "codexlibrelterm",
      "codexlibabsterm",
      "codexlibmcpterm",
      "interviewterm",
      "deskterm",
    ])
      expect(searchJson(term).exact).toEqual([]);
  });

  test("Only sessions in the book's working directories are indexed", () => {
    expect(refs("seatworkterm")).toContain(`claude:${SEAT_SESSION}`);
    expect(searchJson("elsewhereterm").exact).toEqual([]);
  });

  test("Harness scaffolding stays out: meta records, thinking, developer text, preambles, reasoning", () => {
    expect(refs("codexanswerterm")).toContain(CODEX);
    for (const term of ["metaonlyterm", "thinkingonlyterm", "developerterm", "envterm", "reasoningterm"])
      expect(searchJson(term).exact).toEqual([]);
  });
});
