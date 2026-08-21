import type { ReviewLineHistoryResult } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { PullRequestLineHistoryContent } from "./PullRequestLineHistoryPanel";

const authoredAt = DateTime.makeUnsafe("2026-07-01T00:00:00Z");
const commit = {
  sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  shortSha: "aaaaaaaa",
  author: { name: "Ada Lovelace", email: "ada@example.com" },
  authoredAt,
  summary: "Introduce settling gate (#42)",
  message: "Introduce settling gate (#42)",
  url: "https://github.com/t3tools/t3code/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  pullRequest: { number: 42, url: "https://github.com/t3tools/t3code/pull/42" },
} as const;

const result: ReviewLineHistoryResult = {
  path: "src/usage.ts",
  line: 43,
  headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  generatedAt: authoredAt,
  introducedBy: commit,
  originalLine: 40,
  isUncommitted: false,
  versions: [
    {
      commit,
      line: 40,
      excerptStartLine: 39,
      excerpt: ["const pending = true;", "return pending;"],
    },
  ],
  ownership: [
    {
      startLine: 40,
      endLine: 41,
      author: commit.author,
      commitSha: commit.sha,
      authoredAt,
    },
    {
      startLine: 43,
      endLine: 44,
      author: commit.author,
      commitSha: "cccccccccccccccccccccccccccccccccccccccc",
      authoredAt,
    },
  ],
  reviewerSuggestions: [
    {
      author: commit.author,
      score: 14,
      nearbyLines: 4,
      historicalTouches: 1,
      reason: "Owns 4 nearby lines and touched this line 1 time",
    },
  ],
  risk: {
    stability: "recent",
    ageDays: 12,
    touchCount: 1,
    revertCount: 0,
    signals: ["The current line was introduced 12 days ago."],
  },
  truncated: false,
};

describe("PullRequestLineHistoryContent", () => {
  it("renders dated history, risk, reviewers, highlighted versions, and one ownership row", () => {
    const markup = renderToStaticMarkup(<PullRequestLineHistoryContent result={result} />);

    expect(markup).toContain("Introduce settling gate (#42)");
    expect(markup).toContain("Introducing change");
    expect(markup).toContain("PR #42");
    expect(markup).toContain("Recently introduced");
    expect(markup).toContain("Suggested reviewers");
    expect(markup).toContain("Previous versions");
    expect(markup).toContain("const pending = true;");
    expect(markup).toContain('data-commit-date="2026-07-01T00:00:00.000Z"');
    expect(markup.match(/data-ownership-author="Ada Lovelace"/gu)).toHaveLength(1);
    expect(markup).toContain("L40–41, L43–44");
  });
});
