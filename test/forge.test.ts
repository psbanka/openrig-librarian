import { describe, expect, test } from "bun:test";
import { forgeItems } from "../src/sources/forge";
import type { SearchResult } from "../src/types";
import { BOOK_REF, MERGE_SHA, SECRETS, librarian, searchJson } from "./setup";

const card = (query: string, ref: string) => searchJson(query).exact.find((candidate) => candidate.ref === ref);

describe("Feature: Search the record (the forge)", () => {
  test("Issues, comments on issues and on pull requests, and pull requests are searchable", () => {
    expect(card("issueopenterm", "issue:fixture/corpus#1")?.kind).toBe("issue");
    expect(card("commentissueterm", "comment:fixture/corpus#1/1001")?.kind).toBe("issue-comment");
    expect(card("commentpullterm", "comment:fixture/corpus#7/1002")?.kind).toBe("issue-comment");
    expect(card("pullmergedterm", "pull:fixture/corpus#7")?.kind).toBe("pull-request");
  });

  test("Every page of comments is read", () => {
    expect(card("commentlastpageterm", "comment:fixture/corpus#2/3000")?.kind).toBe("issue-comment");
  });

  test("A source's lifecycle state shows on its card", () => {
    expect(card("issueopenterm", "issue:fixture/corpus#1")?.state).toBe("open");
    expect(card("issueclosedterm", "issue:fixture/corpus#2")?.state).toBe("closed");
    expect(card("pullmergedterm", "pull:fixture/corpus#7")?.state).toBe("merged");
    expect(card("pullclosedterm", "pull:fixture/corpus#8")?.state).toBe("closed");
  });

  test("A merged pull request's card names its merge commit", () => {
    expect(card("pullmergedterm", "pull:fixture/corpus#7")?.commits).toEqual([`commit:corpus/${MERGE_SHA.slice(0, 9)}`]);
    expect(card("pullclosedterm", "pull:fixture/corpus#8")?.commits).toBeUndefined();
  });

  test("A planted credential in an issue is redacted", () => {
    const run = librarian("search", "--book", BOOK_REF, "--json", "forgemarker");
    expect(run.code).toBe(0);
    expect(run.stdout).not.toContain(SECRETS[1].probe);
    const found = (JSON.parse(run.stdout) as SearchResult).exact.find((candidate) => candidate.ref === "issue:fixture/corpus#1");
    expect(found?.snippet).toContain("[REDACTED");
  });

  test("forgeItems fails loudly when the forge can't be reached", async () => {
    const drain = async () => {
      for await (const _ of forgeItems({ url: "http://127.0.0.1:9", repos: [] }, "fixture/corpus")) {
        // Reading is the test.
      }
    };
    await expect(drain()).rejects.toThrow();
  });
});
