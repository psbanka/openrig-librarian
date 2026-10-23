import { describe, expect, test } from "bun:test";
import { frontmatter } from "../src/sources/missions";
import { searchJson } from "./setup";

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
});
