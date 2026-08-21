import { describe, expect, it } from "vite-plus/test";

import { buildPullRequestReviewHandoffComment } from "./pullRequestReviewHandoff.logic";

describe("buildPullRequestReviewHandoffComment", () => {
  it("builds a bounded structured packet without raw context tags", () => {
    const comment = buildPullRequestReviewHandoffComment({
      number: 42,
      title: "Review the cache",
      url: "https://example.test/pull/42",
      headBranch: "feature",
      baseBranch: "main",
      revision: "head-42",
      coverage: {
        totalFiles: 2,
        reviewedFiles: 1,
        totalHunks: 2,
        visitedHunks: 1,
        hunks: [
          {
            id: "a",
            path: "src/cache.ts",
            index: 0,
            startLine: 12,
            endLine: 14,
            oldStartLine: 11,
            oldEndLine: 12,
            additions: 2,
            deletions: 1,
            label: "refresh cache",
            visited: false,
          },
        ],
      },
      pinnedSymbols: [{ path: "src/cache.ts", line: 12, column: 4, symbol: "refreshCache" }],
      ciEvidence: [
        {
          id: "ci",
          checkName: "unit tests",
          checkUrl: "https://example.test/check/1",
          line: 80,
          text: "expected cache hit",
        },
      ],
    });

    expect(comment.text).toContain("1/2 hunks visited (50%)");
    expect(comment.text).toContain("refreshCache — src/cache.ts:12:4");
    expect(comment.text).toContain("unit tests L80: expected cache hit");
    expect(comment.text).not.toContain("<bounded-review-context");
    expect(comment.text).not.toContain("<review-context-section-json");
    expect(comment.text.length).toBeLessThanOrEqual(12_000);
    expect(comment.rangeLabel).toContain("1 symbols");
  });
});
