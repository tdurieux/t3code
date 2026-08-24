import type { FileDiffMetadata } from "@pierre/diffs";
import { describe, expect, it } from "vite-plus/test";

import {
  adjacentPullRequestReviewHunk,
  buildPullRequestReviewCoverage,
  buildPullRequestReviewHunks,
  findPullRequestReviewHunk,
  pullRequestReviewProgressKey,
} from "./pullRequestReviewProgress.logic";

const files = [
  {
    name: "src/app.ts",
    hunks: [
      {
        additionStart: 40,
        additionCount: 4,
        deletionStart: 39,
        deletionCount: 3,
        additionLines: 2,
        deletionLines: 1,
        hunkContext: "function render()",
      },
    ],
  },
] as unknown as ReadonlyArray<FileDiffMetadata>;

describe("pull request review progress", () => {
  it("builds stable revision and hunk identities", () => {
    expect(
      pullRequestReviewProgressKey({
        environmentId: " env ",
        pullRequestKey: "pr",
        revision: "abc",
      }),
    ).toBe('["env","pr","abc"]');
    expect(buildPullRequestReviewHunks(files)).toEqual([
      expect.objectContaining({
        path: "src/app.ts",
        startLine: 40,
        endLine: 43,
        oldStartLine: 39,
        oldEndLine: 41,
        label: "function render()",
      }),
    ]);
  });

  it("finds a hunk on either side and summarizes coverage", () => {
    const hunks = buildPullRequestReviewHunks(files);
    expect(
      findPullRequestReviewHunk(hunks, { path: "src/app.ts", line: 42, side: "right" })?.id,
    ).toBe(hunks[0]?.id);
    expect(
      findPullRequestReviewHunk(hunks, { path: "src/app.ts", line: 39, side: "left" })?.id,
    ).toBe(hunks[0]?.id);
    expect(
      buildPullRequestReviewCoverage({
        hunks,
        filePaths: ["src/app.ts"],
        visitedHunkIds: new Set([hunks[0]!.id]),
        reviewedFilePaths: new Set(["src/app.ts"]),
      }),
    ).toMatchObject({ visitedHunks: 1, totalHunks: 1, reviewedFiles: 1, totalFiles: 1 });
  });

  it("moves between hunks in visible file order without wrapping", () => {
    const hunks = buildPullRequestReviewHunks([
      {
        name: "src/first.ts",
        hunks: [
          {
            additionStart: 10,
            additionCount: 2,
            deletionStart: 10,
            deletionCount: 1,
            additionLines: 2,
            deletionLines: 1,
          },
          {
            additionStart: 30,
            additionCount: 3,
            deletionStart: 29,
            deletionCount: 2,
            additionLines: 2,
            deletionLines: 1,
          },
        ],
      },
      {
        name: "src/second.ts",
        hunks: [
          {
            additionStart: 5,
            additionCount: 1,
            deletionStart: 5,
            deletionCount: 1,
            additionLines: 1,
            deletionLines: 1,
          },
        ],
      },
    ] as unknown as ReadonlyArray<FileDiffMetadata>);

    expect(
      adjacentPullRequestReviewHunk(hunks, { path: "src/first.ts", line: 10 }, "next")?.path,
    ).toBe("src/first.ts");
    expect(
      adjacentPullRequestReviewHunk(hunks, { path: "src/first.ts", line: 30 }, "next")?.path,
    ).toBe("src/second.ts");
    expect(
      adjacentPullRequestReviewHunk(hunks, { path: "src/second.ts", line: 5 }, "previous")
        ?.startLine,
    ).toBe(30);
    expect(
      adjacentPullRequestReviewHunk(hunks, { path: "src/second.ts", line: 5 }, "next"),
    ).toBeNull();
  });
});
