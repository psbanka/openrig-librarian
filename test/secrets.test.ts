import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SearchResult } from "../src/types";
import {
  BOOK_REF,
  BOUNDARY_PROBES,
  BOUNDARY_SESSION,
  CLAUDE_SESSION,
  CODEX_BOUNDARY,
  CWD_TOKEN,
  DATA,
  FIRST_SHA,
  FIXTURE_UPDATE,
  SEAT_TOKEN,
  SECRETS,
  TOKEN_SEAT_SESSION,
  librarian,
  readIndex,
  searchJson,
} from "./setup";
import { leakCounts } from "../src/leaks";

/** Every byte the index holds, lowercased: FTS stores its tokens lowercased. */
const indexBytes = () =>
  existsSync(DATA)
    ? readdirSync(DATA)
        .filter((name) => name.startsWith("index.db"))
        .map((name) => readFileSync(join(DATA, name)).toString("latin1"))
        .join("")
        .toLowerCase()
    : "";

describe("Feature: Secrets never enter the index", () => {
  for (const secret of SECRETS) {
    test(`A planted ${secret.kind} is redacted`, () => {
      expect(indexBytes()).not.toContain(secret.probe.toLowerCase());
      const run = librarian("search", "--book", BOOK_REF, "--json", secret.marker);
      expect(run.code).toBe(0);
      expect(run.stdout).not.toContain(secret.probe);
      const card = (JSON.parse(run.stdout) as SearchResult).exact.find(
        (candidate) => candidate.ref === "doc:corpus/docs/secrets.md",
      );
      expect(card?.snippet).toContain("[REDACTED");
    });
  }

  test("A key in a commit message is redacted", () => {
    const run = librarian("search", "--book", BOOK_REF, "--json", "zephyrine-commit");
    expect(run.code).toBe(0);
    expect(run.stdout).not.toContain(SECRETS[0].probe);
    expect((JSON.parse(run.stdout) as SearchResult).exact.some((card) => card.kind === "commit")).toBe(true);
  });

  test("Ordinary identifiers survive redaction", () => {
    expect(searchJson("celilo-apt-repo").exact.map((card) => card.ref)).toContain("doc:corpus/README.md");
    expect(searchJson(FIRST_SHA).exact.map((card) => card.ref)).toContain("doc:corpus/docs/ids.md");
  });

  test("A credential in a file name keeps that file out, unnamed", () => {
    expect(FIXTURE_UPDATE.stderr).toContain("skipped a doc whose reference contains a credential");
    expect(FIXTURE_UPDATE.stderr).not.toContain(SECRETS[2].probe);
    expect(searchJson("secretname").exact).toEqual([]);
  });

  test("Planted credentials in a session are redacted", () => {
    SECRETS.forEach((secret, i) => {
      const run = librarian("search", "--book", BOOK_REF, "--json", `sessionmarker${i}`);
      expect(run.code).toBe(0);
      expect(run.stdout).not.toContain(secret.probe);
      const found = (JSON.parse(run.stdout) as SearchResult).exact.find(
        (candidate) => candidate.ref === `claude:${CLAUDE_SESSION}`,
      );
      expect(found?.snippet).toContain("[REDACTED");
    });
  });

  test("A secret that trimming or cutting would split from its prefix never survives, in either harness", () => {
    expect(searchJson("boundaryterm").exact.map((card) => card.ref)).toContain(`claude:${BOUNDARY_SESSION}`);
    expect(searchJson("codexboundaryterm").exact.map((card) => card.ref)).toContain(`codex:${CODEX_BOUNDARY}`);
    const bytes = indexBytes();
    for (const probe of BOUNDARY_PROBES) expect(bytes).not.toContain(probe.toLowerCase());
  });

  test("A working directory holding a credential keeps its session out, unnamed", () => {
    expect(FIXTURE_UPDATE.stderr).toContain("skipped a session whose working directory contains a credential");
    expect(FIXTURE_UPDATE.stderr).not.toContain(CWD_TOKEN.slice(4, 16));
    expect(searchJson("credcwdterm").exact).toEqual([]);
    expect(indexBytes()).not.toContain(CWD_TOKEN.slice(4, 16).toLowerCase());
  });

  test("A seat name holding a credential is redacted", () => {
    const run = librarian("search", "--book", BOOK_REF, "--json", "tokenseatterm");
    expect(run.code).toBe(0);
    expect(run.stdout).not.toContain(SEAT_TOKEN.slice(-12));
    const found = (JSON.parse(run.stdout) as SearchResult).exact.find(
      (candidate) => candidate.ref === `claude:${TOKEN_SEAT_SESSION}`,
    );
    expect(found?.seat).toContain("[REDACTED");
  });

  test("Nothing stored fails the redaction policy", () => {
    const { sessions, counts } = readIndex((db) => ({
      sessions: (db.query("select count(*) as n from sessions").get() as { n: number }).n,
      counts: leakCounts(db),
    }));
    expect(sessions).toBeGreaterThan(0);
    for (const [field, leaks] of Object.entries(counts)) expect(`${field}=${leaks}`).toBe(`${field}=0`);
  });
});
