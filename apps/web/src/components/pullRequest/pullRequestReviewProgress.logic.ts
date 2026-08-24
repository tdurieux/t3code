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

export function adjacentPullRequestReviewHunk(
  hunks: ReadonlyArray<PullRequestReviewHunk>,
  position: {
    readonly path: string;
    readonly line?: number;
    readonly side?: "left" | "right";
  } | null,
  direction: "previous" | "next",
): PullRequestReviewHunk | null {
  if (hunks.length === 0) return null;
  if (!position) return direction === "next" ? hunks[0]! : hunks.at(-1)!;

  const sameFileIndexes = hunks.flatMap((hunk, index) =>
    hunk.path === position.path ? [index] : [],
  );
  if (sameFileIndexes.length === 0) {
    return direction === "next" ? hunks[0]! : hunks.at(-1)!;
  }

  if (position.line === undefined) {
    const index = direction === "next" ? sameFileIndexes[0]! : sameFileIndexes.at(-1)!;
    return hunks[index] ?? null;
  }

  const line = position.line;
  const side = position.side ?? "right";
  const start = (hunk: PullRequestReviewHunk) =>
    side === "left" ? hunk.oldStartLine : hunk.startLine;
  const end = (hunk: PullRequestReviewHunk) => (side === "left" ? hunk.oldEndLine : hunk.endLine);
  const currentIndex = sameFileIndexes.find((index) => {
    const hunk = hunks[index]!;
    return line >= start(hunk) && line <= end(hunk);
  });
  if (currentIndex !== undefined) {
    return hunks[currentIndex + (direction === "next" ? 1 : -1)] ?? null;
  }

  if (direction === "next") {
    const nextInFile = sameFileIndexes.find((index) => start(hunks[index]!) > line);
    return nextInFile === undefined
      ? (hunks[sameFileIndexes.at(-1)! + 1] ?? null)
      : hunks[nextInFile]!;
  }

  const previousInFile = sameFileIndexes.findLast((index) => end(hunks[index]!) < line);
  return previousInFile === undefined
    ? (hunks[sameFileIndexes[0]! - 1] ?? null)
    : hunks[previousInFile]!;
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
