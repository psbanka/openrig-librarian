import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SearchResult } from "../src/types";
import { BOOK_REF, DATA, FIRST_SHA, FIXTURE_UPDATE, SECRETS, librarian, searchJson } from "./setup";

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
});
