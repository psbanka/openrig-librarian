import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ingest } from "../src/ingest";
import { frontmatter } from "../src/sources/missions";
import { openIndex } from "../src/store";
import { BOOK_REF, DATA, librarian, readIndex, searchJson } from "./setup";

const card = (query: string, ref: string) => searchJson(query).exact.find((candidate) => candidate.ref === ref);

describe("Feature: Search the record (missions)", () => {
  test("frontmatter reads a Markdown file's YAML header, or nothing", () => {
    expect(frontmatter("---\nid: OPR.1\nstatus: complete\n---\n# Body")).toEqual({ id: "OPR.1", status: "complete" });
    expect(frontmatter("# No header")).toEqual({});
  });

  test("A mission's files are searchable, titled with its id, and carry its status", () => {
    const spec = card("alphamissionterm", "mission:alpha/SPEC.md");
    expect(spec?.kind).toBe("mission");
    expect(spec?.title).toBe("OPR.1 alpha: SPEC.md");
    expect(spec?.state).toBe("complete");
    expect(spec?.authority).toBe(1);
    expect(card("alphanotesterm", "mission:alpha/NOTES.md")?.state).toBe("complete");
    expect(card("betamissionterm", "mission:beta/SPEC.md")?.state).toBe("draft");
  });

  test("An excluded mission stays out", () => {
    expect(card("betamissionterm", "mission:beta/SPEC.md")?.kind).toBe("mission");
    expect(searchJson("gammaexcludedterm").exact).toEqual([]);
  });

  test("A mission's source/ folder, a copy of repo docs, is not indexed", () => {
    expect(card("alphamissionterm", "mission:alpha/SPEC.md")?.kind).toBe("mission");
    expect(searchJson("sourcedupterm").exact).toEqual([]);
  });

  test("Turning on skip or exclude removes mission files an earlier update indexed", async () => {
    // As if an earlier update ran before the setting existed.
    const stale = ["mission:alpha/source/openspec/proposal.md", "mission:gamma/SPEC.md"];
    const db = openIndex(join(DATA, "index.db"));
    try {
      await ingest(
        { db, dir: DATA, rig: "test-rig" },
        stale.map((ref) => ({
          kind: "mission" as const,
          ref,
          title: ref,
          date: "2026-10-02T09:00:00Z",
          text: "A staledupterm copy.",
          version: "old",
        })),
      );
    } finally {
      db.close(true);
    }
    expect(searchJson("staledupterm").exact.length).toBe(2);
    expect(librarian("update", "--book", BOOK_REF).code).toBe(0);
    const refs = readIndex((db) =>
      (db.query("select ref from items where kind = 'mission'").all() as Array<{ ref: string }>).map((row) => row.ref),
    );
    for (const ref of stale) expect(refs).not.toContain(ref);
    expect(searchJson("staledupterm").exact).toEqual([]);
  });
});
