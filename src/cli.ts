#!/usr/bin/env bun
// The librarian command: update the rig's index from its book, and search it.
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { expandHome, parseBookRef, readBook } from "./book";
import { fetchOrigin } from "./git";
import { ingest, removeItems } from "./ingest";
import { formatResult, search } from "./search";
import { claudeSessions } from "./sources/claude";
import { codexSessions } from "./sources/codex";
import { folderDocs } from "./sources/folder";
import { forgeItems } from "./sources/forge";
import { gitCommits, gitDocs } from "./sources/git";
import { missionItems } from "./sources/missions";
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
      const { settings } = book;
      const report: Record<string, number> = {};
      for (const repo of settings.repos) fetchOrigin(expandHome(repo.path));
      // The forge before the commits: its merged pull requests decide which merge commits fold.
      const forge = settings.forge;
      if (forge)
        for (const forgeRepo of forge.repos) {
          const gitRepo = settings.repos.find((repo) => repo.forge === forgeRepo)?.name;
          try {
            report[`forge:${forgeRepo}`] = (await ingest(store, forgeItems(forge, forgeRepo, gitRepo))).added;
          } catch (error) {
            console.error(
              `librarian: forge ${forgeRepo}: ${error instanceof Error ? error.message : String(error)}; the rest of the update goes on`,
            );
          }
        }
      // A merged pull request's merge commit lives on the pull request's card.
      const folded = new Set(
        (store.db.query("select merged_as from merges").all() as Array<{ merged_as: string }>).map((row) => row.merged_as),
      );
      for (const repo of settings.repos) {
        report[`doc:${repo.name}`] = (await ingest(store, gitDocs(repo))).added;
        const skipped = { folded: [] as string[], synced: [] as string[] };
        report[`commit:${repo.name}`] = (await ingest(store, gitCommits(repo, folded, skipped))).added;
        // A skipped merge may be in the index from an earlier update, e.g. one run during a forge outage.
        removeItems(store, [...skipped.folded, ...skipped.synced]);
        report[`fold:${repo.name}`] = skipped.folded.length;
        report[`sync:${repo.name}`] = skipped.synced.length;
      }
      for (const folder of settings.folders ?? [])
        report[`doc:${folder.name}`] = (await ingest(store, folderDocs(folder))).added;
      if (settings.missions) {
        fetchOrigin(expandHome(settings.missions.repo));
        report.mission = (await ingest(store, missionItems(settings.missions))).added;
      }
      // Reading transcripts is most of an update's time; skip it when no session directory is wanted.
      if (settings.sessions.cwd.length) {
        // After the repos are fetched, so session commits are checked against a current origin/main.
        const context = { home: homedir(), dataDir: store.dir, sessions: settings.sessions, repos: settings.repos };
        report["session:claude"] = (await ingest(store, claudeSessions(context))).added;
        report["session:codex"] = (await ingest(store, codexSessions(context))).added;
      }
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
