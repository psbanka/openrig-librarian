import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { dataDir, openStore } from "../src/store";

const XDG = resolve(import.meta.dir, "..", ".test-work", "xdg-unit");

describe("the data directory", () => {
  test("refuses a rig name that is not kebab-case", () => {
    expect(() => dataDir("Bad Rig")).toThrow("kebab-case");
  });

  test("openStore makes an owner-only index with its tables", () => {
    const saved = process.env.XDG_DATA_HOME;
    rmSync(XDG, { recursive: true, force: true });
    mkdirSync(XDG, { recursive: true });
    process.env.XDG_DATA_HOME = XDG;
    try {
      const store = openStore("unit-rig");
      const names = (store.db.query("select name from sqlite_master").all() as Array<{ name: string }>).map(
        (row) => row.name,
      );
      store.db.close();
      expect(store.dir).toBe(join(XDG, "openrig-librarian", "unit-rig"));
      expect(names).toEqual(expect.arrayContaining(["items", "chunks", "chunks_by_ref", "fts"]));
      expect(statSync(store.dir).mode & 0o777).toBe(0o700);
      expect(statSync(join(store.dir, "index.db")).mode & 0o777).toBe(0o600);
    } finally {
      if (saved === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = saved;
    }
  });
});
