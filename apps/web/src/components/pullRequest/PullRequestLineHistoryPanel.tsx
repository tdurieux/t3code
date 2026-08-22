import type {
  EnvironmentId,
  ReviewLineHistoryResult,
  ReviewLineRiskStability,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import {
  ActivityIcon,
  Clock3Icon,
  ExternalLinkIcon,
  GitCompareArrowsIcon,
  GitCommitHorizontalIcon,
  HistoryIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  UsersIcon,
  UserRoundCheckIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { HighlightedSearchLine } from "~/components/search/HighlightedSearchLine";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { reviewEnvironment } from "~/state/review";
import { useEnvironmentQuery } from "~/state/query";

import {
  formatOwnershipRanges,
  groupPullRequestOwnership,
  pullRequestOwnershipKey,
} from "./pullRequestLineHistory.logic";

const OWNERSHIP_COLORS = [
  "bg-sky-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
] as const;

const COMMIT_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatCommitDate(value: DateTime.Utc): string {
  return COMMIT_DATE_FORMATTER.format(DateTime.toDateUtc(value));
}

function riskPresentation(stability: ReviewLineRiskStability) {
  switch (stability) {
    case "reverted":
      return {
        label: "Reverted before",
        className: "border-rose-500/35 bg-rose-500/10 text-rose-600 dark:text-rose-300",
        icon: RotateCcwIcon,
      };
    case "active":
      return {
        label: "Frequently changed",
        className: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        icon: ActivityIcon,
      };
    case "long-untouched":
      return {
        label: "Long untouched",
        className: "border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-300",
        icon: Clock3Icon,
      };
    case "recent":
      return {
        label: "Recently introduced",
        className: "border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300",
        icon: GitCommitHorizontalIcon,
      };
    case "stable":
      return {
        label: "Stable",
        className: "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        icon: GitCommitHorizontalIcon,
      };
  }
}

function Initials({ name }: { readonly name: string }) {
  const initials = name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted text-[9px] font-semibold uppercase">
      {initials}
    </span>
  );
}

export function PullRequestLineHistoryContent({
  result,
}: {
  readonly result: ReviewLineHistoryResult;
}) {
  const { resolvedTheme } = useTheme();
  const [selectedVersionSha, setSelectedVersionSha] = useState<string | null>(null);
  useEffect(() => {
    setSelectedVersionSha(result.introducedBy?.sha ?? result.versions[0]?.commit.sha ?? null);
  }, [result.introducedBy?.sha, result.line, result.path, result.versions]);

  const risk = riskPresentation(result.risk.stability);
  const RiskIcon = risk.icon;
  const groups = groupPullRequestOwnership(result.ownership);
  const groupByKey = new Map(groups.map((group) => [group.key, group]));
  const ownershipLineCount = result.ownership.reduce(
    (total, segment) => total + segment.endLine - segment.startLine + 1,
    0,
  );
  const selectedVersion =
    result.versions.find((version) => version.commit.sha === selectedVersionSha) ??
    result.versions[0] ??
    null;

  return (
    <div className="divide-y divide-border/60">
      <section className="p-4">
        <div className="flex items-start gap-3">
          {result.introducedBy ? (
            <Initials name={result.introducedBy.author.name} />
          ) : (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted">
              <HistoryIcon className="size-3.5 text-muted-foreground" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold">
                {result.isUncommitted
                  ? "Uncommitted line"
                  : (result.introducedBy?.author.name ?? "Unknown author")}
              </span>
              <Badge variant="outline" className={cn("gap-1 text-[9px]", risk.className)}>
                <RiskIcon className="size-3" />
                {risk.label}
              </Badge>
            </div>
            {result.introducedBy ? (
              <>
                <p className="mt-1.5 text-[11px] font-medium leading-relaxed">
                  {result.introducedBy.summary}
                </p>
                <div className="mt-1 flex items-center gap-2 text-[9px] text-muted-foreground">
                  <span data-commit-date={DateTime.formatIso(result.introducedBy.authoredAt)}>
                    {formatCommitDate(result.introducedBy.authoredAt)}
                  </span>
                  <span className="font-mono">{result.introducedBy.shortSha}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {result.introducedBy.url ? (
                    <Button
                      size="xs"
                      variant="outline"
                      render={
                        <a
                          href={result.introducedBy.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      }
                    >
                      <GitCommitHorizontalIcon className="size-3" />
                      Introducing change
                      <ExternalLinkIcon className="size-3" />
                    </Button>
                  ) : null}
                  {result.introducedBy.pullRequest ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      render={
                        <a
                          href={result.introducedBy.pullRequest.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      }
                    >
                      PR #{result.introducedBy.pullRequest.number}
                    </Button>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Commit this line to make its introducing change available.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="p-4">
        <div className="flex items-center gap-2">
          <ShieldAlertIcon className="size-3.5 text-amber-500" />
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            History risk
          </h3>
          <span className="ml-auto text-[9px] tabular-nums text-muted-foreground">
            {result.risk.touchCount} touches · {result.risk.ageDays} days old
          </span>
        </div>
        <ul className="mt-2 space-y-1.5">
          {result.risk.signals.map((signal) => (
            <li key={signal} className="flex gap-2 text-[10px] leading-relaxed text-foreground/85">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-amber-500" />
              {signal}
            </li>
          ))}
        </ul>
      </section>

      <section className="p-4">
        <div className="flex items-center gap-2">
          <UsersIcon className="size-3.5 text-violet-500" />
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Ownership nearby
          </h3>
        </div>
        {ownershipLineCount > 0 ? (
          <>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted">
              {result.ownership.map((segment) => {
                const group = groupByKey.get(pullRequestOwnershipKey(segment));
                return (
                  <span
                    key={`${segment.startLine}:${segment.endLine}`}
                    className={OWNERSHIP_COLORS[(group?.colorIndex ?? 0) % OWNERSHIP_COLORS.length]}
                    style={{
                      width: `${((segment.endLine - segment.startLine + 1) / ownershipLineCount) * 100}%`,
                    }}
                  />
                );
              })}
            </div>
            <div className="mt-2 space-y-1.5">
              {groups.map((group) => (
                <div
                  key={group.key}
                  className="flex min-w-0 items-center gap-2 text-[10px]"
                  data-ownership-author={group.authorName}
                >
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      OWNERSHIP_COLORS[group.colorIndex % OWNERSHIP_COLORS.length],
                    )}
                  />
                  <span className="min-w-0 truncate">{group.authorName}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">
                    {formatOwnershipRanges(group.ranges)}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-2 text-[10px] text-muted-foreground">
            Git returned no nearby ownership boundaries.
          </p>
        )}
      </section>

      <section className="p-4">
        <div className="flex items-center gap-2">
          <UserRoundCheckIcon className="size-3.5 text-sky-500" />
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Declared code owners
          </h3>
        </div>
        {result.codeowners ? (
          <>
            <div className="mt-2 flex flex-wrap gap-1">
              {result.codeowners.owners.map((owner) => (
                <Badge key={owner} variant="outline" className="font-mono text-[9px]">
                  {owner}
                </Badge>
              ))}
            </div>
            <p className="mt-2 truncate font-mono text-[9px] text-muted-foreground">
              {result.codeowners.sourcePath}:{result.codeowners.sourceLine} ·{" "}
              {result.codeowners.pattern}
            </p>
          </>
        ) : (
          <p className="mt-2 text-[10px] text-muted-foreground">
            No CODEOWNERS rule matches this file.
          </p>
        )}
        {result.ownershipDrift ? (
          <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/8 p-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
              <GitCompareArrowsIcon className="size-3.5" />
              Ownership changed from the base branch
            </div>
            <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">
              {(result.ownershipDrift.baseOwnership?.owners ?? ["No declared owner"]).join(", ")}
              {" → "}
              {(result.ownershipDrift.worktreeOwnership?.owners ?? ["No declared owner"]).join(
                ", ",
              )}
            </p>
          </div>
        ) : null}
      </section>

      {result.reviewerSuggestions.length > 0 ? (
        <section className="p-4">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Suggested reviewers
          </h3>
          <div className="mt-2 space-y-2">
            {result.reviewerSuggestions.map((suggestion) => (
              <div
                key={`${suggestion.author.name}:${suggestion.author.email ?? ""}`}
                className="flex items-start gap-2"
              >
                <Initials name={suggestion.author.name} />
                <div className="min-w-0">
                  <p className="text-[10px] font-medium">{suggestion.author.name}</p>
                  <p className="text-[9px] leading-relaxed text-muted-foreground">
                    {suggestion.reason}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <div className="flex h-8 items-center gap-2 bg-muted/10 px-4">
          <HistoryIcon className="size-3 text-violet-500" />
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Previous versions
          </h3>
          <span className="ml-auto text-[9px] text-muted-foreground">{result.versions.length}</span>
        </div>
        {result.versions.length > 0 ? (
          <>
            <div className="flex gap-1 overflow-x-auto border-y border-border/50 p-2">
              {result.versions.map((version) => (
                <Button
                  key={version.commit.sha}
                  size="xs"
                  variant={
                    version.commit.sha === selectedVersion?.commit.sha ? "secondary" : "ghost"
                  }
                  onClick={() => setSelectedVersionSha(version.commit.sha)}
                >
                  {formatCommitDate(version.commit.authoredAt)}
                </Button>
              ))}
            </div>
            {selectedVersion ? (
              <div className="overflow-x-auto bg-muted/10 py-2 font-mono text-[10px] leading-5">
                {selectedVersion.excerpt.map((line, index) => {
                  const lineNumber = selectedVersion.excerptStartLine + index;
                  return (
                    <div
                      key={lineNumber}
                      className={cn(
                        "flex min-w-max px-3",
                        lineNumber === selectedVersion.line && "bg-primary/10",
                      )}
                    >
                      <span className="mr-3 w-8 shrink-0 text-right text-muted-foreground/65">
                        {lineNumber}
                      </span>
                      <code className="whitespace-pre">
                        <HighlightedSearchLine
                          path={result.path}
                          theme={resolvedTheme}
                          match={{
                            path: result.path,
                            lineNumber,
                            lineContent: line,
                            matchRanges: [],
                          }}
                        />
                      </code>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </>
        ) : (
          <p className="px-4 py-3 text-[10px] text-muted-foreground">
            No earlier version could be reconstructed.
          </p>
        )}
      </section>
    </div>
  );
}

export function PullRequestLineHistoryPanel({
  environmentId,
  cwd,
  revision,
  baseRef,
  path,
  line,
  placement = "right",
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly revision: string;
  readonly baseRef?: string;
  readonly path: string;
  readonly line: number;
  readonly placement?: "right" | "bottom";
  readonly onClose: () => void;
}) {
  const query = useEnvironmentQuery(
    reviewEnvironment.lineHistory({
      environmentId,
      input: { cwd, path, line, revision, ...(baseRef ? { baseRef } : {}) },
    }),
  );

  return (
    <aside
      className={cn(
        "flex min-h-0 min-w-0 shrink-0 flex-col bg-background",
        placement === "bottom"
          ? "h-[min(22rem,45%)] w-full border-t border-border/60"
          : "h-full max-h-[45%] w-full border-t border-border/60 lg:max-h-none lg:w-[min(26rem,45vw)] lg:min-w-80 lg:border-t-0 lg:border-l",
      )}
    >
      <header className="flex h-10 min-h-10 items-center gap-2 border-b border-border/60 px-3">
        <HistoryIcon className="size-3.5 text-violet-500" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] font-medium">{path}</p>
          <p className="text-[9px] text-muted-foreground">Line {line}</p>
        </div>
        <Button size="icon-xs" variant="ghost" aria-label="Close line history" onClick={onClose}>
          <XIcon className="size-3.5" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.isPending && query.data === null ? (
          <div className="flex h-full items-center justify-center gap-2 text-[10px] text-muted-foreground">
            <Spinner className="size-3.5" />
            Reading Git history…
          </div>
        ) : query.error && query.data === null ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-[10px] text-amber-700 dark:text-amber-300">{query.error}</p>
            <Button size="xs" variant="outline" onClick={query.refresh}>
              Retry
            </Button>
          </div>
        ) : query.data ? (
          <PullRequestLineHistoryContent result={query.data} />
        ) : null}
      </div>
    </aside>
  );
}
