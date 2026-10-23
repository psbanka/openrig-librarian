// Forgejo issues, pull requests and every comment, read anonymously from the forge's API,
// 50 to a page; a short page is the last.
import type { Settings } from "../book";
import type { SourceItem } from "../types";

type Forge = NonNullable<Settings["forge"]>;
const PAGE = 50;

/** Every item of a list endpoint, page by page. The formats aren't ours, so they're read loosely. */
async function* pages(url: string): AsyncGenerator<any> {
  for (let page = 1; ; page++) {
    const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}limit=${PAGE}&page=${page}`);
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).pathname}`);
    const items = (await response.json()) as any[];
    yield* items;
    if (items.length < PAGE) return;
  }
}

/**
 * A forge repo's issues, pull requests and comments. `gitRepo` names the git repo the book links
 * to this forge repo, so a merged pull request can carry its merge commit as a commit ref.
 */
export async function* forgeItems(forge: Forge, repo: string, gitRepo?: string): AsyncGenerator<SourceItem> {
  const base = `${forge.url.replace(/\/+$/, "")}/api/v1/repos/${repo}`;
  for await (const issue of pages(`${base}/issues?state=all&type=issues`))
    yield {
      kind: "issue",
      ref: `issue:${repo}#${issue.number}`,
      title: `#${issue.number} ${issue.title}`,
      date: issue.updated_at,
      text: `${issue.title}\n\n${issue.body ?? ""}`,
      version: issue.updated_at,
      state: issue.state,
    };
  for await (const pull of pages(`${base}/pulls?state=all`)) {
    const sha = pull.merged ? String(pull.merge_commit_sha ?? "") : "";
    yield {
      kind: "pull-request",
      ref: `pull:${repo}#${pull.number}`,
      title: `#${pull.number} ${pull.title}`,
      date: pull.updated_at,
      text: `${pull.title}\n\n${pull.body ?? ""}`,
      version: pull.updated_at,
      state: pull.merged ? "merged" : pull.state,
      ...(sha && gitRepo ? { mergedAs: `commit:${gitRepo}/${sha.slice(0, 9)}` } : {}),
    };
  }
  for await (const comment of pages(`${base}/issues/comments`)) {
    const number = String(comment.pull_request_url || comment.issue_url || "").match(/\/(\d+)$/)?.[1];
    if (!number) continue;
    yield {
      kind: "issue-comment",
      ref: `comment:${repo}#${number}/${comment.id}`,
      title: `Comment on #${number}`,
      date: comment.updated_at,
      text: comment.body ?? "",
      version: comment.updated_at,
    };
  }
}
