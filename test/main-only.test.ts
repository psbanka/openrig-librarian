import { describe, expect, test } from "bun:test";
import { searchJson } from "./setup";

describe("Feature: The book and the corpus are read from origin/main", () => {
  test("An unpushed commit, an uncommitted edit and an unpushed setting are all ignored", () => {
    expect(searchJson("unpushedterm").exact).toEqual([]);
    expect(searchJson("workingcopyonly").exact).toEqual([]);
    // origin/main's settings rank the notes folder 3; the unpushed commit says 2.
    expect(searchJson("zephyrine").exact.find((card) => card.ref === "doc:notes/memory.md")?.authority).toBe(3);
  });
});
