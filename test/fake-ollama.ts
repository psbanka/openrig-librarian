// A stand-in Ollama /api/embed for the tests: a deterministic bag of concepts over 256
// dimensions, so related wordings land near each other. It prints its port and exits when its
// parent closes stdin. With `--fail-after <n>`, every request after the first n fails.
const failFlag = Bun.argv.indexOf("--fail-after");
const failAfter = failFlag >= 0 ? Number(Bun.argv[failFlag + 1]) : Number.POSITIVE_INFINITY;
let served = 0;
const CONCEPTS: Record<string, string> = {
  quick: "agile",
  agile: "agile",
  fast: "agile",
  fox: "canine",
  hound: "canine",
  dog: "canine",
  dogs: "canine",
  leaps: "jump",
  leap: "jump",
  jumping: "jump",
  jumps: "jump",
  jump: "jump",
  sleepy: "tired",
  tired: "tired",
  over: "above",
  above: "above",
};
const DIMS = 256;

function vector(text: string): number[] {
  const values = new Array<number>(DIMS).fill(0);
  for (const word of text.toLowerCase().replace(/^search_(?:document|query):\s*/, "").match(/[\p{L}\p{N}]+/gu) ?? []) {
    const concept = CONCEPTS[word] ?? word;
    let hash = 2166136261;
    for (const char of concept) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    values[(hash >>> 0) % DIMS] += 1;
  }
  return values;
}

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/api/embed")
      return new Response("not found", { status: 404 });
    if (++served > failAfter) return new Response("embedder down", { status: 500 });
    const body = (await request.json()) as { input?: string[] };
    return Response.json({ embeddings: (body.input ?? []).map(vector) });
  },
});
console.log(server.port);
for await (const _ of Bun.stdin.stream()) {
  // Nothing comes in; the loop ends when the parent closes stdin.
}
server.stop(true);
process.exit(0);
