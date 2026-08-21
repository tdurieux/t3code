import * as DateTime from "effect/DateTime";

import type { ReviewLineOwnershipSegment } from "@t3tools/contracts";

export interface PullRequestOwnershipGroup {
  readonly key: string;
  readonly authorName: string;
  readonly lineCount: number;
  readonly ranges: ReadonlyArray<{ readonly startLine: number; readonly endLine: number }>;
  readonly latestAuthoredAt: DateTime.Utc | null;
  readonly colorIndex: number;
}

export function pullRequestOwnershipKey(
  segment: Pick<ReviewLineOwnershipSegment, "author">,
): string {
  return (
    segment.author.email?.trim().toLocaleLowerCase() ??
    segment.author.name.trim().toLocaleLowerCase()
  );
}

/** One row per person, even when their lines are split by another author's change. */
export function groupPullRequestOwnership(
  segments: ReadonlyArray<ReviewLineOwnershipSegment>,
): ReadonlyArray<PullRequestOwnershipGroup> {
  const groups = new Map<string, PullRequestOwnershipGroup>();
  for (const segment of segments) {
    const key = pullRequestOwnershipKey(segment);
    const lineCount = segment.endLine - segment.startLine + 1;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        authorName: segment.author.name,
        lineCount,
        ranges: [{ startLine: segment.startLine, endLine: segment.endLine }],
        latestAuthoredAt: segment.authoredAt,
        colorIndex: groups.size,
      });
      continue;
    }
    const latestAuthoredAt =
      segment.authoredAt !== null &&
      (existing.latestAuthoredAt === null ||
        DateTime.toEpochMillis(segment.authoredAt) >
          DateTime.toEpochMillis(existing.latestAuthoredAt))
        ? segment.authoredAt
        : existing.latestAuthoredAt;
    groups.set(key, {
      ...existing,
      lineCount: existing.lineCount + lineCount,
      ranges: [...existing.ranges, { startLine: segment.startLine, endLine: segment.endLine }],
      latestAuthoredAt,
    });
  }
  return [...groups.values()].toSorted(
    (left, right) =>
      right.lineCount - left.lineCount || left.authorName.localeCompare(right.authorName),
  );
}

export function formatOwnershipRanges(ranges: PullRequestOwnershipGroup["ranges"]): string {
  return ranges
    .map(({ startLine, endLine }) =>
      startLine === endLine ? `L${startLine}` : `L${startLine}–${endLine}`,
    )
    .join(", ");
}
