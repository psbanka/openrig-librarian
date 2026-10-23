// Docs on origin/main of each repo the book names, and every commit message there.
import { expandHome, type Settings } from "../book";
import { git } from "../git";
import type { SourceItem } from "../types";

type Repo = Settings["repos"][number];

/** The date each path last changed on origin/main. */
export function lastChanged(cwd: string): Map<string, string> {
  const dates = new Map<string, string>();
  for (const record of git(cwd, "log", "origin/main", "--format=%x1e%aI", "--name-only").split("\x1e")) {
    const [date, ...paths] = record.trim().split("\n");
    for (const path of paths) if (path && !dates.has(path)) dates.set(path, date);
  }
  return dates;
}

export function* gitDocs(repo: Repo): Generator<SourceItem> {
  const cwd = expandHome(repo.path);
  const globs = repo.docs.map((pattern) => new Bun.Glob(pattern));
  const dates = lastChanged(cwd);
  for (const entry of git(cwd, "ls-tree", "-r", "-z", "origin/main").split("\0")) {
    const match = entry.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/s);
    if (!match) continue;
    const [, sha, path] = match;
    if (!globs.some((glob) => glob.match(path))) continue;
    yield {
      kind: "doc",
      ref: `doc:${repo.name}/${path}`,
      title: path,
      date: dates.get(path) ?? "",
      text: git(cwd, "cat-file", "blob", sha),
      version: sha,
      authority: repo.authority,
    };
  }
}

/** The one default line of a merge that only brought a branch up to date with main. */
const SYNC_MERGE = /^Merge (?:remote-tracking )?branch '(?:origin\/)?main' into \S+$/;

/**
 * A merge whose whole message is that one line. The index stores messages, so it says nothing.
 * A merge with any other subject, or with notes of its own, is not a sync merge.
 */
export function isSyncMerge(message: string): boolean {
  const text = message.trim();
  return !text.includes("\n") && SYNC_MERGE.test(text);
}

/**
 * Every commit message on origin/main, except two-parent merges with nothing of their own:
 * the pull request merges in `folded`, which live on their pull request's card, and plain sync
 * merges. Each one skipped is recorded in `skipped`, so the caller can remove it from the index.
 */
export function* gitCommits(
  repo: Repo,
  folded: Set<string> = new Set(),
  skipped: { folded: string[]; synced: string[] } = { folded: [], synced: [] },
): Generator<SourceItem> {
  const cwd = expandHome(repo.path);
  for (const record of git(cwd, "log", "origin/main", "--format=%H%x1f%aI%x1f%P%x1f%B%x1e").split("\x1e")) {
    const [sha, date, parents, body] = record.trim().split("\x1f");
    if (!sha || !date || !body?.trim()) continue;
    const ref = `commit:${repo.name}/${sha.slice(0, 9)}`;
    if ((parents ?? "").trim().includes(" ")) {
      if (folded.has(ref)) {
        skipped.folded.push(ref);
        continue;
      }
      if (isSyncMerge(body)) {
        skipped.synced.push(ref);
        continue;
      }
    }
    yield {
      kind: "commit",
      ref,
      title: body.trim().split("\n")[0],
      date,
      text: body.trim(),
      version: sha,
    };
  }
}
