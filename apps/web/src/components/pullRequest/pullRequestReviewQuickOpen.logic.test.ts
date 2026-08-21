import { describe, expect, it } from "vite-plus/test";

import {
  parsePullRequestReviewQuickOpenQuery,
  selectPullRequestReviewDeclarations,
  selectPullRequestReviewFiles,
} from "./pullRequestReviewQuickOpen.logic";

describe("pull request review quick open", () => {
  it("recognizes IDE-style search modes and positions", () => {
    expect(parsePullRequestReviewQuickOpenQuery("@ render")).toEqual({
      mode: "currentSymbols",
      search: "render",
    });
    expect(parsePullRequestReviewQuickOpenQuery("# Session")).toEqual({
      mode: "workspaceSymbols",
      search: "Session",
    });
    expect(parsePullRequestReviewQuickOpenQuery(":442:8")).toEqual({
      mode: "line",
      search: "",
      line: 442,
      column: 8,
    });
    expect(parsePullRequestReviewQuickOpenQuery("src/app.ts:17")).toEqual({
      mode: "files",
      search: "src/app.ts",
      line: 17,
    });
  });

  it("keeps changed files first and fuzzily matches paths", () => {
    expect(
      selectPullRequestReviewFiles({
        projectPaths: ["docs/review.md", "apps/web/src/ReviewPanel.tsx"],
        changedPaths: ["apps/web/src/ReviewPanel.tsx"],
        query: "rpt",
      }),
    ).toEqual([{ path: "apps/web/src/ReviewPanel.tsx", changed: true }]);
  });

  it("finds types, functions, and methods", () => {
    const matches = [
      "export interface ReviewState {",
      "export function buildReview() {",
      "  public submitReview(): void {",
    ].map((lineContent, index) => ({
      path: "src/review.ts",
      lineNumber: index + 1,
      lineContent,
      matchRanges: [],
    }));
    expect(
      selectPullRequestReviewDeclarations({ matches, query: "review" }).map((item) => item.kind),
    ).toEqual(["type", "function", "method"]);
  });
});
