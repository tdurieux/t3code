export interface GitHubActionsLogTarget {
  readonly repository: string;
  readonly runId: string;
  readonly jobId: string | null;
}

/** Only GitHub Actions detail URLs identify a run that `gh` can fetch without executing a URL. */
export function parseGitHubActionsLogTarget(value: string): GitHubActionsLogTarget | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const actions = segments.indexOf("actions");
  if (
    actions !== 2 ||
    segments[actions + 1] !== "runs" ||
    !/^\d+$/.test(segments[actions + 2] ?? "")
  ) {
    return null;
  }
  const runId = segments[actions + 2]!;
  const jobIndex = segments.indexOf("job", actions + 3);
  const jobId =
    jobIndex >= 0 && /^\d+$/.test(segments[jobIndex + 1] ?? "") ? segments[jobIndex + 1]! : null;
  return {
    repository: `${url.hostname}/${segments[0]}/${segments[1]}`,
    runId,
    jobId,
  };
}

export function githubActionsLogArgs(target: GitHubActionsLogTarget): ReadonlyArray<string> {
  return [
    "run",
    "view",
    target.runId,
    "--repo",
    target.repository,
    ...(target.jobId === null ? [] : ["--job", target.jobId]),
    "--log",
  ];
}
