import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DATA, ROOT, TMP } from "./setup";

describe("Feature: Keeping the index current and private", () => {
  test("The index is one owner-only file in the rig's data directory", () => {
    expect(existsSync(DATA)).toBe(true);
    expect(statSync(DATA).mode & 0o777).toBe(0o700);
    const names = readdirSync(DATA);
    expect(names.filter((name) => name.startsWith("index.db"))).toEqual(["index.db"]);
    for (const name of names) expect(statSync(join(DATA, name)).mode & 0o077).toBe(0);
  });

  test("Nothing is written under /tmp", () => {
    expect(readdirSync(TMP)).toEqual([]);
    for (const path of new Bun.Glob("src/**/*.ts").scanSync({ cwd: ROOT }))
      expect(readFileSync(join(ROOT, path), "utf8")).not.toMatch(/\/tmp\b|tmpdir\(/);
  });
});
