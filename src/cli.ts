#!/usr/bin/env bun
// The librarian command: update the rig's index from its book, search it, and keep the desk's
// phrasebook.
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { expandHome, parseBookRef, readBook } from "./book";
import { embedMissing } from "./embed";
import { fetchOrigin } from "./git";
import { ingest, removeItems } from "./ingest";
import { addPhrase } from "./phrasebook";
import { formatResult, search } from "./search";
import { claudeSessions } from "./sources/claude";
import { codexSessions } from "./sources/codex";
import { folderDocs } from "./sources/folder";
import { forgeItems } from "./sources/forge";
import { gitCommits, gitDocs } from "./sources/git";
import { missionItems } from "./sources/missions";
import { closeStore, openStore } from "./store";

const USAGE =
  "usage: librarian <update | search <query> | phrasebook add --phrase <text> --source <ref>... [--by <name>]>" +
  " --book <repo>:<path> [--json]";

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      book: { type: "string" },
      json: { type: "boolean", default: false },
      phrase: { type: "string" },
      source: { type: "string", multiple: true },
      by: { type: "string", default: "operator" },
    },
    allowPositionals: true,
  });
  const [command, ...words] = positionals;
  const valid =
    command === "update" ||
    (command === "search" && words.length > 0) ||
    (command === "phrasebook" && words[0] === "add" && !!values.phrase && !!values.source?.length);
  if (!values.book || !valid) {
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
        const skipped: string[] = [];
        report.mission = (await ingest(store, missionItems(settings.missions, skipped))).added;
        // A file now excluded or skipped may be in the index from an earlier update.
        removeItems(store, skipped);
      }
      // Reading transcripts is most of an update's time; skip it when no session directory is wanted.
      if (settings.sessions.cwd.length) {
        // After the repos are fetched, so session commits are checked against a current origin/main.
        const context = { home: homedir(), dataDir: store.dir, sessions: settings.sessions, repos: settings.repos };
        report["session:claude"] = (await ingest(store, claudeSessions(context))).added;
        report["session:codex"] = (await ingest(store, codexSessions(context))).added;
      }
      // Last, so every source's chunks are in. Only chunks without a vector are embedded.
      try {
        report.embed = await embedMissing(store, settings.embed);
      } catch (error) {
        console.error(
          `librarian: embedding stopped: ${error instanceof Error ? error.message : String(error)}; the next update resumes`,
        );
      }
      console.log(
        values.json
          ? JSON.stringify(report)
          : Object.entries(report)
              .map(([source, count]) => `${source}: ${count}`)
              .join("\n"),
      );
    } else if (command === "search") {
      const result = await search(store, book, words.join(" "));
      for (const warning of result.warnings ?? []) console.error(`librarian: ${warning}`);
      console.log(values.json ? JSON.stringify(result) : formatResult(result));
    } else {
      const entry = addPhrase(store, {
        phrase: values.phrase ?? "",
        sources: values.source ?? [],
        by: values.by ?? "operator",
        date: new Date().toISOString().slice(0, 10),
      });
      console.log(values.json ? JSON.stringify(entry) : `added to ${join(store.dir, "phrasebook.yaml")}: ${entry.phrase}`);
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
