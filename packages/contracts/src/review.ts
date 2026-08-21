import * as Schema from "effect/Schema";
import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { GitCommandError } from "./git.ts";
import { VcsError } from "./vcs.ts";

export const ReviewDiffPreviewInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  baseRef: Schema.optional(TrimmedNonEmptyString),
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
});
export type ReviewDiffPreviewInput = typeof ReviewDiffPreviewInput.Type;

export const ReviewDiffPreviewSourceKind = Schema.Literals(["working-tree", "branch-range"]);
export type ReviewDiffPreviewSourceKind = typeof ReviewDiffPreviewSourceKind.Type;

export const ReviewDiffPreviewSource = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: ReviewDiffPreviewSourceKind,
  title: TrimmedNonEmptyString,
  baseRef: Schema.NullOr(TrimmedNonEmptyString),
  headRef: Schema.NullOr(TrimmedNonEmptyString),
  diff: Schema.String,
  diffHash: TrimmedNonEmptyString,
  truncated: Schema.Boolean,
});
export type ReviewDiffPreviewSource = typeof ReviewDiffPreviewSource.Type;

export const ReviewDiffFileContentsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  sourceKind: ReviewDiffPreviewSourceKind,
  changeType: Schema.Literals(["change", "rename-pure", "rename-changed", "new", "deleted"]),
  baseRef: Schema.NullOr(TrimmedNonEmptyString),
  headRef: Schema.NullOr(TrimmedNonEmptyString),
  oldPath: TrimmedNonEmptyString,
  newPath: TrimmedNonEmptyString,
});
export type ReviewDiffFileContentsInput = typeof ReviewDiffFileContentsInput.Type;

export const ReviewDiffFileContentsResult = Schema.Struct({
  oldContents: Schema.String,
  newContents: Schema.String,
});
export type ReviewDiffFileContentsResult = typeof ReviewDiffFileContentsResult.Type;

export const ReviewDiffPreviewResult = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  generatedAt: Schema.DateTimeUtc,
  sources: Schema.Array(ReviewDiffPreviewSource),
});
export type ReviewDiffPreviewResult = typeof ReviewDiffPreviewResult.Type;

export const ReviewDiffPreviewError = Schema.Union([VcsError, GitCommandError]);
export type ReviewDiffPreviewError = typeof ReviewDiffPreviewError.Type;

export const ReviewLineHistoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  line: PositiveInt,
  /** Host revision token used to keep immutable line-history cache entries distinct. */
  revision: Schema.optionalKey(TrimmedNonEmptyString),
});
export type ReviewLineHistoryInput = typeof ReviewLineHistoryInput.Type;

export const ReviewLineHistoryAuthor = Schema.Struct({
  name: TrimmedNonEmptyString,
  email: Schema.NullOr(TrimmedNonEmptyString),
});
export type ReviewLineHistoryAuthor = typeof ReviewLineHistoryAuthor.Type;

export const ReviewLineHistoryPullRequest = Schema.Struct({
  number: PositiveInt,
  url: TrimmedNonEmptyString,
});
export type ReviewLineHistoryPullRequest = typeof ReviewLineHistoryPullRequest.Type;

export const ReviewLineHistoryCommit = Schema.Struct({
  sha: TrimmedNonEmptyString,
  shortSha: TrimmedNonEmptyString,
  author: ReviewLineHistoryAuthor,
  authoredAt: Schema.DateTimeUtc,
  summary: TrimmedNonEmptyString,
  message: Schema.String,
  url: Schema.NullOr(TrimmedNonEmptyString),
  pullRequest: Schema.NullOr(ReviewLineHistoryPullRequest),
});
export type ReviewLineHistoryCommit = typeof ReviewLineHistoryCommit.Type;

export const ReviewLineHistoryVersion = Schema.Struct({
  commit: ReviewLineHistoryCommit,
  line: PositiveInt,
  excerptStartLine: PositiveInt,
  excerpt: Schema.Array(Schema.String),
});
export type ReviewLineHistoryVersion = typeof ReviewLineHistoryVersion.Type;

export const ReviewLineOwnershipSegment = Schema.Struct({
  startLine: PositiveInt,
  endLine: PositiveInt,
  author: ReviewLineHistoryAuthor,
  commitSha: Schema.NullOr(TrimmedNonEmptyString),
  authoredAt: Schema.NullOr(Schema.DateTimeUtc),
});
export type ReviewLineOwnershipSegment = typeof ReviewLineOwnershipSegment.Type;

export const ReviewLineReviewerSuggestion = Schema.Struct({
  author: ReviewLineHistoryAuthor,
  score: NonNegativeInt,
  nearbyLines: NonNegativeInt,
  historicalTouches: NonNegativeInt,
  reason: TrimmedNonEmptyString,
});
export type ReviewLineReviewerSuggestion = typeof ReviewLineReviewerSuggestion.Type;

export const ReviewLineRiskStability = Schema.Literals([
  "recent",
  "active",
  "stable",
  "long-untouched",
  "reverted",
]);
export type ReviewLineRiskStability = typeof ReviewLineRiskStability.Type;

export const ReviewLineRisk = Schema.Struct({
  stability: ReviewLineRiskStability,
  ageDays: NonNegativeInt,
  touchCount: NonNegativeInt,
  revertCount: NonNegativeInt,
  signals: Schema.Array(TrimmedNonEmptyString),
});
export type ReviewLineRisk = typeof ReviewLineRisk.Type;

export const ReviewLineHistoryResult = Schema.Struct({
  path: TrimmedNonEmptyString,
  line: PositiveInt,
  headSha: TrimmedNonEmptyString,
  generatedAt: Schema.DateTimeUtc,
  introducedBy: Schema.NullOr(ReviewLineHistoryCommit),
  originalLine: Schema.NullOr(PositiveInt),
  isUncommitted: Schema.Boolean,
  versions: Schema.Array(ReviewLineHistoryVersion),
  ownership: Schema.Array(ReviewLineOwnershipSegment),
  reviewerSuggestions: Schema.Array(ReviewLineReviewerSuggestion),
  risk: ReviewLineRisk,
  truncated: Schema.Boolean,
});
export type ReviewLineHistoryResult = typeof ReviewLineHistoryResult.Type;

export class ReviewLineHistoryError extends Schema.TaggedErrorClass<ReviewLineHistoryError>()(
  "ReviewLineHistoryError",
  {
    operation: Schema.String,
    cwd: Schema.String,
    path: Schema.String,
    line: PositiveInt,
    stage: Schema.Literals(["validate", "blame", "history"]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}
