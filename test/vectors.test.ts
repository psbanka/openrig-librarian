import { describe, expect, test } from "bun:test";
import { embed, embedMissing } from "../src/embed";
import { ingest } from "../src/ingest";
import { OLLAMA_URL, RESTART_DATA, RESTART_REF, librarian, readIndex, withUnitStore } from "./setup";

describe("Feature: Vectors for the meaning list", () => {
  test("embed returns one vector per text", async () => {
    const vectors = await embed({ url: OLLAMA_URL, model: "fake" }, ["one two", "three"], "document");
    expect(vectors.length).toBe(2);
    expect(vectors[0].length).toBe(256);
  });

  test("embed fails loudly when the embedder can't be reached", async () => {
    await expect(embed({ url: "http://127.0.0.1:9", model: "fake" }, ["x"], "query")).rejects.toThrow();
  });

  test("An update embeds every chunk", () => {
    const counts = readIndex((db) => ({
      chunks: (db.query("select count(*) as n from chunks").get() as { n: number }).n,
      vectors: (db.query("select count(*) as n from vecs where model = 'nomic-embed-text'").get() as { n: number }).n,
    }));
    expect(counts.chunks).toBeGreaterThan(0);
    expect(counts.vectors).toBe(counts.chunks);
  });

  test("Replacing a source's chunks drops their vectors, and the next pass embeds the new ones", async () => {
    const counts = await withUnitStore("vec-rig", async (store) => {
      const cfg = { url: OLLAMA_URL, model: "fake" };
      const doc = (text: string) => ({
        kind: "doc" as const,
        ref: "doc:unit/a.md",
        title: "a.md",
        date: "2026-10-01T00:00:00Z",
        text,
        version: text,
      });
      const count = () => (store.db.query("select count(*) as n from vecs").get() as { n: number }).n;
      await ingest(store, [doc("First version.")]);
      const first = await embedMissing(store, cfg);
      const afterFirst = count();
      await ingest(store, [doc("Second version.")]);
      const afterReplace = count();
      const second = await embedMissing(store, cfg);
      return { first, afterFirst, afterReplace, second, afterSecond: count() };
    });
    expect(counts).toEqual({ first: 1, afterFirst: 1, afterReplace: 0, second: 1, afterSecond: 1 });
  });

  test("An unchanged source keeps its chunks and vectors while its metadata updates; a new title re-chunks it", async () => {
    const result = await withUnitStore("keep-rig", async (store) => {
      const cfg = { url: OLLAMA_URL, model: "fake" };
      const doc = (title: string, state?: string) => ({
        kind: "doc" as const,
        ref: "doc:unit/a.md",
        title,
        date: "2026-10-01T00:00:00Z",
        text: "Unchanged text.",
        version: "1",
        ...(state ? { state } : {}),
      });
      const vectors = () => (store.db.query("select count(*) as n from vecs").get() as { n: number }).n;
      await ingest(store, [doc("a.md")]);
      await embedMissing(store, cfg);
      await ingest(store, [doc("a.md", "closed")]);
      const afterSame = vectors();
      const state = (store.db.query("select state from items").get() as { state: string | null }).state;
      await ingest(store, [doc("b.md", "closed")]);
      return { afterSame, state, afterRetitle: vectors() };
    });
    expect(result).toEqual({ afterSame: 1, state: "closed", afterRetitle: 0 });
  });

  test("An interrupted update keeps the vectors it finished when the update runs again", () => {
    const vectorIds = () =>
      readIndex((db) => (db.query("select id from vecs order by id").all() as Array<{ id: number }>).map((row) => row.id), RESTART_DATA);
    const first = librarian("update", "--book", RESTART_REF);
    expect(first.code).toBe(0);
    expect(first.stderr).toContain("embedding stopped");
    const kept = vectorIds();
    expect(kept.length).toBe(64);
    // The embedder is still down, so the second update can't add vectors; it must not lose any.
    const second = librarian("update", "--book", RESTART_REF);
    expect(second.code).toBe(0);
    expect(vectorIds()).toEqual(kept);
  });
});
