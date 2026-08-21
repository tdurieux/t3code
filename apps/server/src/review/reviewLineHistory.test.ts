import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  assessLineRisk,
  buildOwnershipSegments,
  buildReviewerSuggestions,
  normalizeReviewRemote,
  parseGitBlamePorcelain,
  parseGitLineHistory,
  toReviewLineHistoryCommit,
} from "./reviewLineHistory.ts";

const blameOutput = `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 38 40 2
author Ada Lovelace
author-mail <ada@example.com>
author-time 1704067200
summary Introduce settling gate (#42)
filename src/usage.ts
\tconst pending = isPending;
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 39 41
author Ada Lovelace
author-mail <ada@example.com>
author-time 1704067200
summary Introduce settling gate (#42)
filename src/usage.ts
\treturn pending;
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 42 42 1
author Grace Hopper
author-mail <grace@example.com>
author-time 1711929600
summary Harden refresh behavior
filename src/usage.ts
\trefresh();`;

describe("review line history", () => {
  it("parses blame ownership and combines adjacent boundaries", () => {
    const blame = parseGitBlamePorcelain(blameOutput);

    expect(blame).toHaveLength(3);
    expect(blame[0]).toMatchObject({
      commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      originalLine: 38,
      finalLine: 40,
      author: { name: "Ada Lovelace", email: "ada@example.com" },
    });
    expect(buildOwnershipSegments(blame)).toMatchObject([
      { startLine: 40, endLine: 41, author: { name: "Ada Lovelace" } },
      { startLine: 42, endLine: 42, author: { name: "Grace Hopper" } },
    ]);
  });

  it("keeps one ownership boundary when the same author made adjacent commits", () => {
    const author = { name: "Ada Lovelace", email: "ada@example.com" };

    expect(
      buildOwnershipSegments([
        {
          commitSha: "a".repeat(40),
          originalLine: 1,
          finalLine: 1,
          author,
          authoredAt: DateTime.makeUnsafe("2026-01-01T00:00:00Z"),
          summary: "First change",
          source: "first();",
        },
        {
          commitSha: "b".repeat(40),
          originalLine: 2,
          finalLine: 2,
          author,
          authoredAt: DateTime.makeUnsafe("2026-02-01T00:00:00Z"),
          summary: "Second change",
          source: "second();",
        },
      ]),
    ).toMatchObject([
      {
        startLine: 1,
        endLine: 2,
        author,
        commitSha: "b".repeat(40),
        authoredAt: DateTime.makeUnsafe("2026-02-01T00:00:00Z"),
      },
    ]);
  });

  it("links introducing commits and pull requests for common remote formats", () => {
    const history = parseGitLineHistory(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\u001fAda Lovelace\u001fada@example.com\u001f2024-01-01T00:00:00Z\u001fIntroduce settling gate (#42)\u001fIntroduce settling gate (#42)\u001e",
    );
    const commit = toReviewLineHistoryCommit(
      history[0]!,
      normalizeReviewRemote("git@github.com:t3tools/t3code.git"),
    );

    expect(commit.url).toBe(
      "https://github.com/t3tools/t3code/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(commit.pullRequest).toEqual({
      number: 42,
      url: "https://github.com/t3tools/t3code/pull/42",
    });
  });

  it("ranks nearby owners and repeated authors as reviewer suggestions", () => {
    const blame = parseGitBlamePorcelain(blameOutput);
    const history = parseGitLineHistory(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\u001fAda Lovelace\u001fada@example.com\u001f2024-01-01T00:00:00Z\u001fInitial\u001fInitial\u001e" +
        "cccccccccccccccccccccccccccccccccccccccc\u001fAda Lovelace\u001fada@example.com\u001f2024-02-01T00:00:00Z\u001fFollow-up\u001fFollow-up\u001e",
    );

    expect(buildReviewerSuggestions(blame, history)[0]).toMatchObject({
      author: { name: "Ada Lovelace" },
      nearbyLines: 2,
      historicalTouches: 2,
      score: 10,
    });
  });

  it("flags long-untouched and historically reverted lines", () => {
    const history = parseGitLineHistory(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\u001fAda\u001fada@example.com\u001f2020-01-01T00:00:00Z\u001fRevert unsafe refresh\u001fRevert unsafe refresh\u001e",
    );
    const risk = assessLineRisk({
      introducedAt: DateTime.makeUnsafe("2020-01-01T00:00:00Z"),
      history,
      now: DateTime.makeUnsafe("2026-08-08T00:00:00Z"),
    });

    expect(risk.stability).toBe("reverted");
    expect(risk.revertCount).toBe(1);
    expect(risk.ageDays).toBeGreaterThan(365);
    expect(risk.signals.join(" ")).toContain("revert");
  });
});
