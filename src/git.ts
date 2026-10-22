// git, run synchronously in a repo. Paths come back unquoted.

export function git(cwd: string, ...args: string[]): string {
  const run = Bun.spawnSync(["git", "-C", cwd, "-c", "core.quotePath=false", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!run.success) throw new Error(`git ${args.join(" ")} (in ${cwd}): ${run.stderr.toString().trim()}`);
  return run.stdout.toString();
}

/** Fetches origin. Offline, it warns, and the caller keeps the last fetched origin/main. */
export function fetchOrigin(cwd: string): void {
  try {
    git(cwd, "fetch", "-q", "origin");
  } catch (error) {
    console.error(
      `librarian: ${error instanceof Error ? error.message : String(error)}; using the last fetched origin/main`,
    );
  }
}
