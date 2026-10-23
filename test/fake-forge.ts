// A stand-in Forgejo API for the tests. It serves <dir>/<owner>/<repo>/{issues,pulls,issues-comments}.json,
// paged as Forgejo pages them, prints its port, and exits when its parent closes stdin.
const dir = Bun.argv[2];
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/v1\/repos\/([^/]+)\/([^/]+)\/(issues\/comments|issues|pulls)$/);
    if (!match) return new Response("not found", { status: 404 });
    const file = Bun.file(`${dir}/${match[1]}/${match[2]}/${match[3].replace("/", "-")}.json`);
    const all = (await file.exists()) ? ((await file.json()) as unknown[]) : [];
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const page = Number(url.searchParams.get("page") ?? 1);
    return Response.json(all.slice((page - 1) * limit, page * limit));
  },
});
console.log(server.port);
for await (const _ of Bun.stdin.stream()) {
  // Nothing comes in; the loop ends when the parent closes stdin.
}
server.stop(true);
process.exit(0);
