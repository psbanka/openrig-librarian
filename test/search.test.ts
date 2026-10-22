import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BOOK_REF, DATA, librarian, searchJson } from "./setup";

const chunkCounts = () => {
  const path = join(DATA, "index.db");
  expect(existsSync(path)).toBe(true);
  const db = new Database(path);
  try {
    return db.query("select ref, count(*) as n from chunks group by ref order by ref").all();
  } finally {
    db.close();
  }
};

describe("Feature: Search the record", () => {
  test("Every source kind is searchable: repo docs, folder notes and commits", () => {
    const { exact } = searchJson("zephyrine");
    const refs = exact.map((card) => card.ref);
    expect(refs).toContain("doc:corpus/README.md");
    expect(refs).toContain("doc:notes/memory.md");
    expect(exact.some((card) => card.kind === "commit")).toBe(true);
  });

  test("Cards carry their context", () => {
    const { exact } = searchJson("zephyrine");
    expect(exact.length).toBeGreaterThan(0);
    expect(exact.length).toBeLessThanOrEqual(5);
    for (const card of exact) {
      expect(["doc", "commit"]).toContain(card.kind);
      expect(card.ref.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(card.date))).toBe(false);
      expect(card.authority).toBeGreaterThanOrEqual(1);
      expect(card.authority).toBeLessThanOrEqual(5);
      expect(card.title.length).toBeGreaterThan(0);
      expect(card.snippet.length).toBeGreaterThan(0);
    }
    expect(exact.find((card) => card.ref === "doc:notes/memory.md")?.authority).toBe(3);
    expect(exact.find((card) => card.kind === "commit")?.authority).toBe(4);
  });

  test("A second update replaces each source rather than adding it again", () => {
    const before = chunkCounts();
    expect(librarian("update", "--book", BOOK_REF).code).toBe(0);
    expect(chunkCounts()).toEqual(before);
  });

  test("One long source can't crowd out the others", () => {
    const refs = searchJson("floodterm").exact.map((card) => card.ref);
    expect(refs).toContain("doc:corpus/docs/flood.md");
    expect(refs).toContain("doc:corpus/docs/other.md");
    expect(new Set(refs).size).toBe(refs.length);
  });

  test("Accented and non-Latin words round-trip", () => {
    expect(searchJson("café").exact.map((card) => card.ref)).toContain("doc:corpus/docs/unicode.md");
    expect(searchJson("日本語").exact.map((card) => card.ref)).toContain("doc:corpus/docs/unicode.md");
  });
});
