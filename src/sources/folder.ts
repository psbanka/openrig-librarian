// Plain folders of notes the book names, such as an operator's memory files.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expandHome, type Settings } from "../book";
import type { SourceItem } from "../types";

type Folder = NonNullable<Settings["folders"]>[number];

export function* folderDocs(folder: Folder): Generator<SourceItem> {
  const cwd = expandHome(folder.path);
  if (!existsSync(cwd)) {
    console.error(`librarian: folder ${folder.name} not found at ${cwd}`);
    return;
  }
  const seen = new Set<string>();
  for (const pattern of folder.globs)
    for (const path of new Bun.Glob(pattern).scanSync({ cwd })) {
      if (seen.has(path)) continue;
      seen.add(path);
      const file = join(cwd, path);
      const stat = statSync(file);
      yield {
        kind: "doc",
        ref: `doc:${folder.name}/${path}`,
        title: path,
        date: stat.mtime.toISOString(),
        text: readFileSync(file, "utf8"),
        version: `${stat.size}:${stat.mtimeMs}`,
        authority: folder.authority,
      };
    }
}
