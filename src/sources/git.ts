// Docs on origin/main of each repo the book names, and every commit message there.
import { expandHome, type Settings } from "../book";
import { git } from "../git";
import type { SourceItem } from "../types";

type Repo = Settings["repos"][number];

/** The date each path last changed on origin/main. */
function lastChanged(cwd: string): Map<string, string> {
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

export function* gitCommits(repo: Repo): Generator<SourceItem> {
  const cwd = expandHome(repo.path);
  for (const record of git(cwd, "log", "origin/main", "--format=%H%x1f%aI%x1f%B%x1e").split("\x1e")) {
    const [sha, date, body] = record.trim().split("\x1f");
    if (!sha || !date || !body?.trim()) continue;
    yield {
      kind: "commit",
      ref: `commit:${repo.name}/${sha.slice(0, 9)}`,
      title: body.trim().split("\n")[0],
      date,
      text: body.trim(),
      version: sha,
    };
  }
}
