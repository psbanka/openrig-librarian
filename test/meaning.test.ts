import { describe, expect, test } from "bun:test";
import type { Book } from "../src/book";
import { ingest } from "../src/ingest";
import { search } from "../src/search";
import { searchJson, withUnitStore } from "./setup";

describe("Feature: Search the record (the meaning list)", () => {
  test("The meaning list finds a doc that shares no words with the question", () => {
    const result = searchJson("agile animal jumping above a tired dog");
    expect(result.exact.map((card) => card.ref)).not.toContain("doc:corpus/docs/fox.md");
    expect(result.meaning.map((card) => card.ref)).toContain("doc:corpus/docs/fox.md");
  });

  test("Results come as an exact list and a meaning list, each at most five distinct sources", () => {
    const result = searchJson("zephyrine floodterm agile");
    for (const list of [result.exact, result.meaning]) {
      expect(list.length).toBeGreaterThan(0);
      expect(list.length).toBeLessThanOrEqual(5);
      expect(new Set(list.map((card) => card.ref)).size).toBe(list.length);
    }
  });

  test("With the embedder down, search still returns the exact list and says the meaning list is missing", async () => {
    const result = await withUnitStore("down-rig", async (store) => {
      await ingest(store, [
        { kind: "doc", ref: "doc:unit/a.md", title: "a.md", date: "2026-10-01T00:00:00Z", text: "A downunitterm doc.", version: "1" },
      ]);
      const book: Book = {
        settings: {
          rig: "down-rig",
          repos: [],
          sessions: { cwd: [], exclude: [] },
          judge: { url: "http://127.0.0.1:9", model: "none" },
          embed: { url: "http://127.0.0.1:9", model: "nomic-embed-text" },
          connect: { codexSandbox: "workspace-write", codexProfile: "luna" },
        },
        phrasebook: [],
        questions: [],
      };
      return search(store, book, "downunitterm");
    });
    expect(result.exact.map((card) => card.ref)).toEqual(["doc:unit/a.md"]);
    expect(result.meaning).toEqual([]);
    expect(result.warnings?.[0]).toContain("meaning list unavailable");
  });
});
