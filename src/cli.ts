#!/usr/bin/env bun
// The librarian command: update the rig's index from its book, and search it.
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { expandHome, parseBookRef, readBook } from "./book";
import { fetchOrigin } from "./git";
import { ingest } from "./ingest";
import { formatResult, search } from "./search";
import { claudeSessions } from "./sources/claude";
import { codexSessions } from "./sources/codex";
import { folderDocs } from "./sources/folder";
import { gitCommits, gitDocs } from "./sources/git";
import { closeStore, openStore } from "./store";

const USAGE = "usage: librarian <update | search <query>> --book <repo>:<path> [--json]";

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { book: { type: "string" }, json: { type: "boolean", default: false } },
    allowPositionals: true,
  });
  const [command, ...words] = positionals;
  if (!values.book || (command !== "update" && command !== "search") || (command === "search" && !words.length)) {
    console.error(USAGE);
    return 2;
  }
  const book = readBook(parseBookRef(values.book), { fetch: command === "update" });
  const store = openStore(book.settings.rig);
  try {
    if (command === "update") {
      const report: Record<string, number> = {};
      for (const repo of book.settings.repos) {
        fetchOrigin(expandHome(repo.path));
        report[`doc:${repo.name}`] = (await ingest(store, gitDocs(repo))).added;
        report[`commit:${repo.name}`] = (await ingest(store, gitCommits(repo))).added;
      }
      for (const folder of book.settings.folders ?? [])
        report[`doc:${folder.name}`] = (await ingest(store, folderDocs(folder))).added;
      // After the repos are fetched, so session commits are checked against a current origin/main.
      const context = {
        home: homedir(),
        dataDir: store.dir,
        sessions: book.settings.sessions,
        repos: book.settings.repos,
      };
      report["session:claude"] = (await ingest(store, claudeSessions(context))).added;
      report["session:codex"] = (await ingest(store, codexSessions(context))).added;
      console.log(
        values.json
          ? JSON.stringify(report)
          : Object.entries(report)
              .map(([source, count]) => `${source}: ${count}`)
              .join("\n"),
      );
    } else {
      const result = await search(store, book, words.join(" "));
      console.log(values.json ? JSON.stringify(result) : formatResult(result));
    }
    return 0;
  } finally {
    closeStore(store);
  }
}

process.umask(0o077);
main(Bun.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`librarian: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
