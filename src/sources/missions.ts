// Missions from the plans repo's origin/main: every Markdown file in each mission folder,
// carrying the mission's status from its SPEC.md frontmatter.
import { expandHome, type Settings } from "../book";
import { git } from "../git";
import type { SourceItem } from "../types";
import { lastChanged } from "./git";

type Missions = NonNullable<Settings["missions"]>;

/** The YAML frontmatter at the top of a Markdown file, or {}. */
export function frontmatter(text: string): Record<string, unknown> {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  try {
    return (Bun.YAML.parse(match[1]) as Record<string, unknown> | null) ?? {};
  } catch {
    return {};
  }
}

/** `skipped` collects the refs of files left out, so the caller can remove any an earlier update indexed. */
export function* missionItems(missions: Missions, skipped: string[] = []): Generator<SourceItem> {
  const cwd = expandHome(missions.repo);
  const root = missions.path.replace(/\/+$/, "");
  const byMission = new Map<string, Array<{ path: string; sha: string }>>();
  for (const entry of git(cwd, "ls-tree", "-r", "-z", "origin/main", "--", root).split("\0")) {
    const match = entry.match(/^\d+ blob ([0-9a-f]+)\t(.+\.md)$/s);
    if (!match) continue;
    const [, sha, path] = match;
    const name = path.slice(root.length + 1).split("/")[0];
    if (!name) continue;
    const inside = path.slice(root.length + name.length + 2);
    // Left out: whole missions in `exclude`, and files matching `skip`, such as copies of repo docs.
    if (missions.exclude?.includes(name) || missions.skip?.some((glob) => new Bun.Glob(glob).match(inside))) {
      skipped.push(`mission:${name}/${inside}`);
      continue;
    }
    byMission.set(name, [...(byMission.get(name) ?? []), { path, sha }]);
  }
  const dates = lastChanged(cwd);
  for (const [name, files] of byMission) {
    const spec = files.find((file) => file.path === `${root}/${name}/SPEC.md`);
    const fields = spec ? frontmatter(git(cwd, "cat-file", "blob", spec.sha)) : {};
    const state = typeof fields.status === "string" ? fields.status : undefined;
    const id = typeof fields.id === "string" ? `${fields.id} ` : "";
    for (const { path, sha } of files) {
      const file = path.slice(root.length + name.length + 2);
      yield {
        kind: "mission",
        ref: `mission:${name}/${file}`,
        title: `${id}${name}: ${file}`,
        date: dates.get(path) ?? "",
        text: git(cwd, "cat-file", "blob", sha),
        version: sha,
        state,
      };
    }
  }
}
