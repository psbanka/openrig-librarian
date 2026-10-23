// Embeddings through Ollama, and the vectors the meaning list searches.
import type { Settings } from "./book";
import type { Store } from "./store";

type Embed = Settings["embed"];
/** Characters sent per text; nomic-embed-text truncates past its window anyway. */
const MAX_TEXT = 6000;

export async function embed(cfg: Embed, texts: string[], role: "document" | "query"): Promise<Float32Array[]> {
  // nomic-embed-text expects these task prefixes (research.md).
  const prefix = role === "document" ? "search_document: " : "search_query: ";
  const response = await fetch(`${cfg.url.replace(/\/+$/, "")}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      input: texts.map((text) => `${prefix}${text}`.slice(0, MAX_TEXT)),
      truncate: true,
    }),
  });
  if (!response.ok) throw new Error(`embedding: HTTP ${response.status}`);
  const { embeddings } = (await response.json()) as { embeddings?: number[][] };
  if (!Array.isArray(embeddings) || embeddings.length !== texts.length) throw new Error("embedding: wrong number of vectors");
  return embeddings.map((values) => new Float32Array(values));
}

/** The unit vector, so a dot product is the cosine. An all-zero vector stays zero. */
export function normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const length = Math.sqrt(sum) || 1;
  return vector.map((value) => value / length);
}

export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export const toBlob = (vector: Float32Array) => new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
/** A copy, so the floats are aligned whatever the blob's offset. */
export const fromBlob = (blob: Uint8Array) => new Float32Array(new Uint8Array(blob).buffer);

/**
 * Embeds every chunk with no vector for this model yet, a batch at a time. Each batch commits on
 * its own, so an interrupted run resumes where it stopped. Returns how many chunks it embedded.
 */
export async function embedMissing(store: Store, cfg: Embed, batch = 64): Promise<number> {
  const next = store.db.prepare(
    `select c.id, c.title, c.text from chunks c left join vecs v on v.id = c.id and v.model = ?1
     where v.id is null order by c.id limit ?2`,
  );
  const put = store.db.prepare("insert or replace into vecs (id, model, v) values (?, ?, ?)");
  let done = 0;
  for (;;) {
    const rows = next.all(cfg.model, batch) as Array<{ id: number; title: string; text: string }>;
    if (!rows.length) return done;
    const vectors = await embed(cfg, rows.map((row) => `${row.title}\n${row.text}`), "document");
    store.db.transaction(() => rows.forEach((row, i) => put.run(row.id, cfg.model, toBlob(normalize(vectors[i])))))();
    done += rows.length;
  }
}
