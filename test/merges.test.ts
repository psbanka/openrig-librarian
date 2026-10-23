import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ingest } from "../src/ingest";
import { isSyncMerge } from "../src/sources/git";
import { openIndex } from "../src/store";
import {
  BOOK_REF,
  DATA,
  DETAILED_SYNC_SHA,
  FEATURE_MERGE_SHA,
  FEATURE_SHA,
  FIXTURE_UPDATE,
  MAINLINE_SHA,
  MERGE_SHA,
  SQUASH_SHA,
  SYNC_SHA,
  WIDGET_SHA,
  librarian,
  readIndex,
  searchJson,
} from "./setup";

const commitRefs = () =>
  readIndex((db) => (db.query("select ref from items where kind = 'commit'").all() as Array<{ ref: string }>).map((row) => row.ref));
const ref = (sha: string) => `commit:corpus/${sha.slice(0, 9)}`;
const card = (query: string, cardRef: string) => searchJson(query).exact.find((candidate) => candidate.ref === cardRef);

describe("Feature: Merge commits fold into their pull requests", () => {
  test("isSyncMerge is true only for the one-line default message that merges main into another branch", () => {
    expect(isSyncMerge("Merge branch 'main' into widget")).toBe(true);
    expect(isSyncMerge("Merge remote-tracking branch 'origin/main' into widget\n")).toBe(true);
    expect(isSyncMerge("Merge branch 'main' into feature\n\nKept the syncdetailterm line from main.")).toBe(false);
    expect(isSyncMerge("Merge branch 'feature'")).toBe(false);
    expect(isSyncMerge("Merge branch 'release' into widget")).toBe(false);
  });

  test("A pull request's merge commit lives on the pull request's card, not as a commit", () => {
    expect(commitRefs()).not.toContain(ref(MERGE_SHA));
    expect(card("pullmergedterm", "pull:fixture/corpus#7")?.commits).toEqual([ref(MERGE_SHA)]);
  });

  test("A plain sync merge of main is never indexed", () => {
    expect(commitRefs()).not.toContain(ref(SYNC_SHA));
  });

  test("Merges with something of their own stay: a feature merged locally, and a sync merge with notes", () => {
    expect(commitRefs()).toEqual(expect.arrayContaining([ref(FEATURE_MERGE_SHA), ref(DETAILED_SYNC_SHA)]));
    expect(card("featureconflictterm", ref(FEATURE_MERGE_SHA))?.kind).toBe("commit");
    expect(card("syncdetailterm", ref(DETAILED_SYNC_SHA))?.kind).toBe("commit");
  });

  test("A squash-merged pull request keeps its commit card, and its card names that commit", () => {
    expect(commitRefs()).toContain(ref(SQUASH_SHA));
    expect(card("pullsquashterm", "pull:fixture/corpus#10")?.commits).toEqual([ref(SQUASH_SHA)]);
  });

  test("The update reports what it folded and dropped, counted from the commits it read", () => {
    expect(FIXTURE_UPDATE.stdout).toContain("fold:corpus: 1");
    expect(FIXTURE_UPDATE.stdout).toContain("sync:corpus: 1");
  });

  test("A merge an earlier update indexed is removed by the next one", async () => {
    // As if an earlier update ran before the forge knew pull request #7, or during an outage.
    const db = openIndex(join(DATA, "index.db"));
    try {
      await ingest(
        { db, dir: DATA, rig: "test-rig" },
        [MERGE_SHA, SYNC_SHA].map((sha) => ({
          kind: "commit" as const,
          ref: ref(sha),
          title: `Stale merge ${sha.slice(0, 7)}`,
          date: "2026-10-01T15:00:00Z",
          text: "A stalemergeterm left by an earlier update.",
          version: sha,
        })),
      );
    } finally {
      db.close(true);
    }
    expect(commitRefs()).toEqual(expect.arrayContaining([ref(MERGE_SHA), ref(SYNC_SHA)]));
    expect(librarian("update", "--book", BOOK_REF).code).toBe(0);
    expect(commitRefs()).not.toContain(ref(MERGE_SHA));
    expect(commitRefs()).not.toContain(ref(SYNC_SHA));
    expect(searchJson("stalemergeterm").exact).toEqual([]);
  });

  test("The merged branches' own commits stay indexed", () => {
    expect(commitRefs()).toEqual(expect.arrayContaining([ref(WIDGET_SHA), ref(MAINLINE_SHA), ref(FEATURE_SHA)]));
  });
});
