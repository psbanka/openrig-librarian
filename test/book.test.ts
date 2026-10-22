import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { expandHome, parseBookRef } from "../src/book";
import { git } from "../src/git";

describe("book references", () => {
  test("expandHome expands a leading ~ and leaves other paths alone", () => {
    expect(expandHome("~")).toBe(homedir());
    expect(expandHome("~/notes")).toBe(join(homedir(), "notes"));
    expect(expandHome("/srv/book")).toBe("/srv/book");
  });

  test("parseBookRef splits at the last colon and trims the folder's slash", () => {
    expect(parseBookRef("~/plans:librarian/")).toEqual({
      repo: join(homedir(), "plans"),
      path: "librarian",
    });
  });

  test("parseBookRef refuses a value with no repo or no folder", () => {
    expect(() => parseBookRef("plans")).toThrow("<repo>:<path>");
    expect(() => parseBookRef("plans:")).toThrow("<repo>:<path>");
  });
});

describe("git", () => {
  test("returns git's output", () => {
    expect(git(import.meta.dir, "rev-parse", "--is-inside-work-tree").trim()).toBe("true");
  });

  test("throws with the command and git's error", () => {
    expect(() => git(import.meta.dir, "show", "no-such-ref:nothing")).toThrow(
      /git show no-such-ref:nothing/,
    );
  });
});
