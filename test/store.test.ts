import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { ingest, removeItems } from "../src/ingest";
import { leakCounts } from "../src/leaks";
import { exact } from "../src/search";
import { closeStore, dataDir, openIndex, openStore } from "../src/store";

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
      closeStore(store);
      expect(store.dir).toBe(join(XDG, "openrig-librarian", "unit-rig"));
      expect(names).toEqual(expect.arrayContaining(["items", "chunks", "chunks_by_ref", "fts"]));
      expect(statSync(store.dir).mode & 0o777).toBe(0o700);
      expect(statSync(join(store.dir, "index.db")).mode & 0o777).toBe(0o600);
    } finally {
      if (saved === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = saved;
    }
  });

  test("closeStore leaves no -wal or -shm behind, even with a statement still open", () => {
    const saved = process.env.XDG_DATA_HOME;
    rmSync(XDG, { recursive: true, force: true });
    mkdirSync(XDG, { recursive: true });
    process.env.XDG_DATA_HOME = XDG;
    try {
      const store = openStore("close-rig");
      store.db.prepare("select count(*) as n from items").get();
      closeStore(store);
      expect(readdirSync(store.dir).filter((name) => name.startsWith("index.db"))).toEqual(["index.db"]);
    } finally {
      if (saved === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = saved;
    }
  });

  test("openIndex reopens an existing index in WAL mode, and close(true) leaves one file", () => {
    const saved = process.env.XDG_DATA_HOME;
    rmSync(XDG, { recursive: true, force: true });
    mkdirSync(XDG, { recursive: true });
    process.env.XDG_DATA_HOME = XDG;
    try {
      const store = openStore("reopen-rig");
      closeStore(store);
      const db = openIndex(join(store.dir, "index.db"));
      expect(db.query("pragma journal_mode").get()).toEqual({ journal_mode: "wal" });
      db.query("select count(*) as n from chunks").get();
      db.close(true);
      expect(readdirSync(store.dir).filter((name) => name.startsWith("index.db"))).toEqual(["index.db"]);
    } finally {
      if (saved === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = saved;
    }
  });

  test("a session's seat and commits come back on its card", async () => {
    const saved = process.env.XDG_DATA_HOME;
    rmSync(XDG, { recursive: true, force: true });
    mkdirSync(XDG, { recursive: true });
    process.env.XDG_DATA_HOME = XDG;
    try {
      const store = openStore("session-rig");
      await ingest(store, [
        {
          kind: "session",
          ref: "claude:unit-session",
          title: "Unit session",
          date: "2026-10-03T10:00:00.000Z",
          text: "A quuxunit prompt.",
          version: "1",
          session: {
            harness: "claude",
            id: "unit-session",
            cwd: "/work/project",
            seat: "new-desk",
            model: "claude-opus-5-5",
            commits: ["commit:corpus/abc123456"],
          },
        },
      ]);
      const cards = exact(store, "quuxunit", 5);
      closeStore(store);
      expect(cards[0]).toMatchObject({
        kind: "session",
        ref: "claude:unit-session",
        authority: 5,
        seat: "new-desk",
        commits: ["commit:corpus/abc123456"],
      });
    } finally {
      if (saved === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = saved;
    }
  });

  test("session metadata: a credential in the working directory skips the session; seat and model are redacted", async () => {
    const saved = process.env.XDG_DATA_HOME;
    rmSync(XDG, { recursive: true, force: true });
    mkdirSync(XDG, { recursive: true });
    process.env.XDG_DATA_HOME = XDG;
    try {
      const token = ["gh", "p_", "Mt4".repeat(12)].join("");
      const slack = ["xox", "b-", "9876543210-", "ZyXwVuTsRqPo"].join("");
      const base = {
        kind: "session" as const,
        title: "Meta session",
        date: "2026-10-03T10:00:00.000Z",
        text: "A metaunit prompt.",
        version: "1",
      };
      const store = openStore("meta-rig");
      const result = await ingest(store, [
        { ...base, ref: "claude:cwd-leak", session: { harness: "claude", id: "cwd-leak", cwd: `/work/${token}`, commits: [] } },
        {
          ...base,
          ref: "claude:seat-leak",
          session: { harness: "claude", id: "seat-leak", cwd: "/work/project", seat: slack, model: `model-${token}`, commits: [] },
        },
      ]);
      const rows = store.db.query("select ref, seat, model from sessions order by ref").all();
      closeStore(store);
      expect(result).toEqual({ added: 1, skipped: 1 });
      expect(JSON.stringify(rows)).not.toContain("Mt4Mt4");
      expect(JSON.stringify(rows)).not.toContain("ZyXwVuTsRqPo");
      expect(rows).toEqual([{ ref: "claude:seat-leak", seat: "[REDACTED:slack]", model: "model-[REDACTED:github]" }]);
    } finally {
      if (saved === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = saved;
    }
  });

  test("leakCounts counts, per stored field, the values the redaction policy would still change", () => {
    const saved = process.env.XDG_DATA_HOME;
    rmSync(XDG, { recursive: true, force: true });
    mkdirSync(XDG, { recursive: true });
    process.env.XDG_DATA_HOME = XDG;
    try {
      const store = openStore("leak-rig");
      const add = store.db.prepare(
        "insert into items (ref, kind, title, date, version, state, authority) values (?, 'doc', ?, 'd', 'v', null, 1)",
      );
      add.run("doc:clean", "A clean title");
      add.run("doc:leak", `A title with ${["pass", "word=", "leaky-unit-value-1"].join("")}`);
      const counts = leakCounts(store.db);
      closeStore(store);
      expect(counts["items.title"]).toBe(1);
      expect(counts["items.ref"]).toBe(0);
      expect(Object.keys(counts)).toEqual(
        expect.arrayContaining(["chunks.text", "sessions.cwd", "sessions.seat", "sessions.model"]),
      );
    } finally {
      if (saved === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = saved;
    }
  });

  test("a pull request's merge commit comes back on its card", async () => {
    const saved = process.env.XDG_DATA_HOME;
    rmSync(XDG, { recursive: true, force: true });
    mkdirSync(XDG, { recursive: true });
    process.env.XDG_DATA_HOME = XDG;
    try {
      const store = openStore("merge-rig");
      await ingest(store, [
        {
          kind: "pull-request",
          ref: "pull:fixture/corpus#7",
          title: "#7 Add widget",
          date: "2026-10-01T15:00:00Z",
          text: "A pullunitterm description.",
          version: "1",
          state: "merged",
          mergedAs: "commit:corpus/abc123456",
        },
      ]);
      const cards = exact(store, "pullunitterm", 5);
      const fields = Object.keys(leakCounts(store.db));
      closeStore(store);
      expect(cards[0]).toMatchObject({
        kind: "pull-request",
        state: "merged",
        authority: 3,
        commits: ["commit:corpus/abc123456"],
      });
      expect(fields).toContain("merges.merged_as");
    } finally {
      if (saved === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = saved;
    }
  });

  test("removeItems deletes an item with its chunks, full-text entries and links, and ignores unknown refs", async () => {
    const saved = process.env.XDG_DATA_HOME;
    rmSync(XDG, { recursive: true, force: true });
    mkdirSync(XDG, { recursive: true });
    process.env.XDG_DATA_HOME = XDG;
    try {
      const store = openStore("remove-rig");
      await ingest(store, [
        {
          kind: "pull-request",
          ref: "pull:fixture/corpus#9",
          title: "#9 Remove me",
          date: "2026-10-01T15:00:00Z",
          text: "A removeunitterm description.",
          version: "1",
          state: "merged",
          mergedAs: "commit:corpus/abc123456",
        },
      ]);
      const removed = removeItems(store, ["pull:fixture/corpus#9", "commit:corpus/notthere0"]);
      const count = (sql: string) => (store.db.query(sql).get() as { n: number }).n;
      const left = {
        items: count("select count(*) as n from items"),
        chunks: count("select count(*) as n from chunks"),
        merges: count("select count(*) as n from merges"),
        fullText: count("select count(*) as n from fts where fts match 'removeunitterm'"),
      };
      closeStore(store);
      expect(removed).toBe(1);
      expect(left).toEqual({ items: 0, chunks: 0, merges: 0, fullText: 0 });
    } finally {
      if (saved === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = saved;
    }
  });
});
