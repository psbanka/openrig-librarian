import { describe, expect, test } from "bun:test";
import { BOOK_REF, CORPUS, FIXTURE_UPDATE, librarian } from "./setup";

describe("the librarian command", () => {
  test("the fixture's update succeeds and reports what it indexed", () => {
    expect(FIXTURE_UPDATE.code).toBe(0);
    expect(FIXTURE_UPDATE.stdout).toContain("doc:corpus:");
    expect(FIXTURE_UPDATE.stdout).toContain("commit:corpus:");
    expect(FIXTURE_UPDATE.stdout).toContain("doc:notes:");
  });

  test("refuses to run without --book", () => {
    const run = librarian("search", "zephyrine");
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("usage");
  });

  test("names the missing settings file when the book has none", () => {
    const run = librarian("search", "--book", `${CORPUS}:nope`, "zephyrine");
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("nope/librarian.yaml");
  });

  test("prints the three lists as text by default", () => {
    const run = librarian("search", "--book", BOOK_REF, "zephyrine");
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("exact (");
    expect(run.stdout).toContain("doc:corpus/README.md");
    expect(run.stdout).toContain("phrasebook (0)");
  });
});
