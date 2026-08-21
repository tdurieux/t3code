import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { formatOwnershipRanges, groupPullRequestOwnership } from "./pullRequestLineHistory.logic";

describe("pull request line-history ownership", () => {
  it("groups separated ranges from the same person into one row", () => {
    const grouped = groupPullRequestOwnership([
      {
        startLine: 1,
        endLine: 2,
        author: { name: "Theo Browne", email: "theo@example.com" },
        commitSha: "a".repeat(40),
        authoredAt: DateTime.makeUnsafe("2025-01-01T00:00:00Z"),
      },
      {
        startLine: 3,
        endLine: 3,
        author: { name: "Julius", email: "julius@example.com" },
        commitSha: "b".repeat(40),
        authoredAt: DateTime.makeUnsafe("2025-02-01T00:00:00Z"),
      },
      {
        startLine: 4,
        endLine: 8,
        author: { name: "Theo Browne", email: "theo@example.com" },
        commitSha: "c".repeat(40),
        authoredAt: DateTime.makeUnsafe("2025-03-01T00:00:00Z"),
      },
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({
      authorName: "Theo Browne",
      lineCount: 7,
      ranges: [
        { startLine: 1, endLine: 2 },
        { startLine: 4, endLine: 8 },
      ],
      latestAuthoredAt: DateTime.makeUnsafe("2025-03-01T00:00:00Z"),
    });
    expect(formatOwnershipRanges(grouped[0]!.ranges)).toBe("L1–2, L4–8");
  });

  it("falls back to the normalized name when an email is unavailable", () => {
    const grouped = groupPullRequestOwnership([
      {
        startLine: 10,
        endLine: 10,
        author: { name: "Ada Lovelace", email: null },
        commitSha: null,
        authoredAt: null,
      },
      {
        startLine: 12,
        endLine: 12,
        author: { name: " ada lovelace ", email: null },
        commitSha: null,
        authoredAt: null,
      },
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.lineCount).toBe(2);
  });
});
