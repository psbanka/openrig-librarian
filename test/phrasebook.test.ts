import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { formatResult } from "../src/search";
import { BOOK, BOOK_REF, CORPUS, DATA, SECRETS, librarian, searchJson } from "./setup";

const status = (dir: string) => Bun.spawnSync(["git", "-C", dir, "status", "--porcelain"]).stdout.toString();

describe("Feature: Search the record (phrasebooks)", () => {
  test("A phrasebook entry finds an answer whose words don't match", () => {
    const result = searchJson("my test can't fail");
    expect(result.exact.map((card) => card.ref)).not.toContain("doc:corpus/docs/reach.md");
    expect(result.phrasebook.find((card) => card.ref === "doc:corpus/docs/reach.md")?.phrase).toBe("my test can't fail");
  });

  test("The book is read from main: a phrasebook entry that never reached it is ignored", () => {
    expect(searchJson("my test can't fail").phrasebook.length).toBeGreaterThan(0);
    expect(searchJson("an unpushedphrase question").phrasebook).toEqual([]);
  });

  test("phrasebook add keeps an owner-only entry in the data directory, changes no repo, and search uses it", () => {
    const before = [status(CORPUS), status(BOOK)];
    const run = librarian(
      "phrasebook",
      "add",
      "--book",
      BOOK_REF,
      "--phrase",
      "where do widgets live",
      "--source",
      "doc:corpus/docs/widget.md",
      "--by",
      "test",
    );
    expect(run.code).toBe(0);
    const file = join(DATA, "phrasebook.yaml");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).toContain("where do widgets live");
    expect([status(CORPUS), status(BOOK)]).toEqual(before);
    expect(searchJson("where do widgets live").phrasebook.map((card) => card.ref)).toContain("doc:corpus/docs/widget.md");
  });

  test("phrasebook add refuses a source the index doesn't hold", () => {
    const run = librarian("phrasebook", "add", "--book", BOOK_REF, "--phrase", "anything", "--source", "doc:corpus/nowhere.md");
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("no indexed source");
  });

  test("phrasebook add stores the phrase redacted", () => {
    const run = librarian(
      "phrasebook",
      "add",
      "--book",
      BOOK_REF,
      "--phrase",
      `why did ${SECRETS[0].text} leak`,
      "--source",
      "doc:corpus/README.md",
    );
    expect(run.code).toBe(0);
    expect(run.stdout).not.toContain(SECRETS[0].probe);
    expect(readFileSync(join(DATA, "phrasebook.yaml"), "utf8")).not.toContain(SECRETS[0].probe);
  });

  test("formatResult shows which phrasing matched a phrasebook card", () => {
    const text = formatResult({
      exact: [],
      meaning: [],
      phrasebook: [
        {
          kind: "doc",
          ref: "doc:corpus/docs/reach.md",
          date: "2026-10-01T12:00:00+00:00",
          title: "docs/reach.md",
          snippet: "Every check",
          authority: 1,
          phrase: "my test can't fail",
        },
      ],
    });
    expect(text).toContain(`phrase: "my test can't fail"`);
  });
});
