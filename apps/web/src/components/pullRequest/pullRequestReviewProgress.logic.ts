import type { FileDiffMetadata } from "@pierre/diffs";

import { resolveFileDiffPath } from "~/lib/diffRendering";

export interface PullRequestReviewHunk {
  readonly id: string;
  readonly path: string;
  readonly index: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly oldStartLine: number;
  readonly oldEndLine: number;
  readonly additions: number;
  readonly deletions: number;
  readonly label: string;
}

export interface PullRequestReviewCoverage {
  readonly hunks: ReadonlyArray<PullRequestReviewHunk & { readonly visited: boolean }>;
  readonly visitedHunks: number;
  readonly totalHunks: number;
  readonly reviewedFiles: number;
  readonly totalFiles: number;
}

export function pullRequestReviewProgressKey(input: {
  readonly environmentId: string;
  readonly pullRequestKey: string;
  readonly revision: string;
}): string {
  return JSON.stringify([
    input.environmentId.trim(),
    input.pullRequestKey.trim(),
    input.revision.trim(),
  ]);
}

export function pullRequestReviewHunkId(input: {
  readonly path: string;
  readonly additionStart: number;
  readonly additionCount: number;
  readonly deletionStart: number;
  readonly deletionCount: number;
}): string {
  return JSON.stringify([
    input.path,
    input.deletionStart,
    input.deletionCount,
    input.additionStart,
    input.additionCount,
  ]);
}

export function buildPullRequestReviewHunks(
  files: ReadonlyArray<FileDiffMetadata>,
): ReadonlyArray<PullRequestReviewHunk> {
  return files.flatMap((file) => {
    const path = resolveFileDiffPath(file);
    return file.hunks.map((hunk, index) => {
      const endLine = Math.max(hunk.additionStart, hunk.additionStart + hunk.additionCount - 1);
      const oldEndLine = Math.max(hunk.deletionStart, hunk.deletionStart + hunk.deletionCount - 1);
      return {
        id: pullRequestReviewHunkId({ path, ...hunk }),
        path,
        index,
        startLine: Math.max(1, hunk.additionStart),
        endLine: Math.max(1, endLine),
        oldStartLine: Math.max(1, hunk.deletionStart),
        oldEndLine: Math.max(1, oldEndLine),
        additions: hunk.additionLines,
        deletions: hunk.deletionLines,
        label:
          hunk.hunkContext?.trim() ||
          (endLine === hunk.additionStart
            ? `Line ${Math.max(1, hunk.additionStart)}`
            : `Lines ${Math.max(1, hunk.additionStart)}–${Math.max(1, endLine)}`),
      };
    });
  });
}

export function findPullRequestReviewHunk(
  hunks: ReadonlyArray<PullRequestReviewHunk>,
  input: { readonly path: string; readonly line: number; readonly side: "left" | "right" },
): PullRequestReviewHunk | null {
  return (
    hunks.find((hunk) => {
      if (hunk.path !== input.path) return false;
      const start = input.side === "left" ? hunk.oldStartLine : hunk.startLine;
      const end = input.side === "left" ? hunk.oldEndLine : hunk.endLine;
      return input.line >= start && input.line <= end;
    }) ?? null
  );
}

export function buildPullRequestReviewCoverage(input: {
  readonly hunks: ReadonlyArray<PullRequestReviewHunk>;
  readonly filePaths: ReadonlyArray<string>;
  readonly visitedHunkIds: ReadonlySet<string>;
  readonly reviewedFilePaths: ReadonlySet<string>;
}): PullRequestReviewCoverage {
  const hunks = input.hunks.map((hunk) => ({
    ...hunk,
    visited: input.visitedHunkIds.has(hunk.id),
  }));
  return {
    hunks,
    visitedHunks: hunks.filter((hunk) => hunk.visited).length,
    totalHunks: hunks.length,
    reviewedFiles: input.filePaths.filter((path) => input.reviewedFilePaths.has(path)).length,
    totalFiles: input.filePaths.length,
  };
}
