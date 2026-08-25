import { CheckCircle2Icon, CircleDashedIcon, EyeIcon, RotateCcwIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../ui/button";
import { cn } from "~/lib/utils";
import type {
  PullRequestReviewCoverage,
  PullRequestReviewHunk,
} from "./pullRequestReviewProgress.logic";

export function PullRequestReviewCoveragePanel({
  navigation,
  coverage,
  onClose,
  onOpenHunk,
  onSetHunkVisited,
  onClear,
}: {
  readonly navigation?: ReactNode;
  readonly coverage: PullRequestReviewCoverage;
  readonly onClose: () => void;
  readonly onOpenHunk: (hunk: PullRequestReviewHunk) => void;
  readonly onSetHunkVisited: (hunk: PullRequestReviewHunk, visited: boolean) => void;
  readonly onClear: () => void;
}) {
  const percentage =
    coverage.totalHunks === 0 ? 0 : Math.round((coverage.visitedHunks / coverage.totalHunks) * 100);
  return (
    <aside className="flex min-h-0 w-80 shrink-0 flex-col border-l border-border/60 bg-background">
      {navigation}
      <header className="shrink-0 border-b border-border/60 p-3">
        <div className="flex items-start gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-violet-500/25 bg-violet-500/10">
            <EyeIcon className="size-4 text-violet-500" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold">Review coverage</h2>
              <span className="rounded border border-border/60 px-1.5 py-0.5 text-[9px] tabular-nums text-muted-foreground">
                {coverage.visitedHunks}/{coverage.totalHunks} hunks
              </span>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              A hunk is visited when you open it here or select one of its lines.
            </p>
          </div>
          <Button size="icon-sm" variant="ghost" aria-label="Close coverage" onClick={onClose}>
            <XIcon className="size-3.5" />
          </Button>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-violet-500" style={{ width: `${percentage}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            {coverage.reviewedFiles}/{coverage.totalFiles} files reviewed
          </span>
          <Button
            size="xs"
            variant="ghost"
            onClick={onClear}
            disabled={coverage.visitedHunks === 0 && coverage.reviewedFiles === 0}
          >
            <RotateCcwIcon className="size-3" />
            Reset
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {coverage.hunks.map((hunk) => (
          <div
            key={hunk.id}
            className={cn(
              "mb-1.5 rounded-lg border border-border/60",
              hunk.visited && "bg-emerald-500/5",
            )}
          >
            <button
              type="button"
              className="flex w-full items-start gap-2 rounded-lg p-2 text-left hover:bg-accent/50"
              onClick={() => onOpenHunk(hunk)}
            >
              {hunk.visited ? (
                <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
              ) : (
                <CircleDashedIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">
                  {hunk.path.split("/").at(-1)}
                </span>
                <span className="block truncate font-mono text-[9px] text-muted-foreground">
                  {hunk.path} · L{hunk.startLine}
                  {hunk.endLine === hunk.startLine ? "" : `–${hunk.endLine}`}
                </span>
                <span className="mt-1 block truncate text-[10px] text-foreground/80">
                  {hunk.label}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[9px]">
                <span className="text-emerald-500">+{hunk.additions}</span>{" "}
                <span className="text-rose-500">-{hunk.deletions}</span>
              </span>
            </button>
            <button
              type="button"
              className="w-full border-t border-border/50 px-2 py-1 text-left text-[9px] text-muted-foreground hover:bg-accent/40"
              onClick={() => onSetHunkVisited(hunk, !hunk.visited)}
            >
              {hunk.visited ? "Mark unvisited" : "Mark visited"}
            </button>
          </div>
        ))}
        {coverage.hunks.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">No rendered hunks.</p>
        ) : null}
      </div>
    </aside>
  );
}
