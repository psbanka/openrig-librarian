import { describe, expect, test } from "bun:test";
import { chunks } from "../src/ingest";
import { formatResult, terms } from "../src/search";

describe("chunks", () => {
  test("packs short paragraphs into one chunk", () => {
    expect(chunks("one\n\ntwo")).toEqual(["one\n\ntwo"]);
  });

  test("cuts a long paragraph without losing text", () => {
    const long = "x".repeat(5000);
    const pieces = chunks(long);
    expect(pieces.join("")).toBe(long);
    expect(Math.max(...pieces.map((piece) => piece.length))).toBeLessThanOrEqual(3000);
  });

  test("returns nothing for blank text", () => {
    expect(chunks("  \n\n ")).toEqual([]);
  });
});

describe("terms", () => {
  test("drops stopwords and edge punctuation, keeping an issue's #", () => {
    expect(terms("how do I fix #173?")).toEqual(["fix", "#173"]);
  });

  test("is empty for a query of stopwords", () => {
    expect(terms("the of")).toEqual([]);
  });

  test("keeps accented and non-Latin words whole", () => {
    expect(terms("café 日本語 (issue_runner_token)")).toEqual(["café", "日本語", "issue_runner_token"]);
  });
});

describe("formatResult", () => {
  test("labels each list and shows a card's context", () => {
    const text = formatResult({
      exact: [
        {
          kind: "doc",
          ref: "doc:corpus/README.md",
          date: "2026-09-01T12:00:00+00:00",
          title: "README.md",
          snippet: "the  guide",
          authority: 1,
        },
      ],
      meaning: [],
      phrasebook: [],
    });
    expect(text).toContain("exact (1)");
    expect(text).toContain("doc:corpus/README.md  doc  2026-09-01  authority 1");
    expect(text).toContain("the guide");
    expect(text).toContain("meaning (0)");
    expect(text).toContain("phrasebook (0)");
  });
});
