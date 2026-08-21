import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import {
  ReviewLineHistoryError,
  ReviewCiLogError,
  VcsRepositoryDetectionError,
  VcsUnsupportedOperationError,
  type ReviewDiffFileContentsInput,
  type ReviewDiffFileContentsResult,
  type ReviewDiffPreviewError,
  type ReviewDiffPreviewInput,
  type ReviewDiffPreviewResult,
  type ReviewLineHistoryInput,
  type ReviewLineHistoryResult,
  type ReviewCiLogInput,
  type ReviewCiLogResult,
  type VcsError,
} from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import {
  REVIEW_LINE_HISTORY_FORMAT,
  assessLineRisk,
  buildOwnershipSegments,
  buildReviewerSuggestions,
  excerptAtLine,
  normalizeReviewRemote,
  parseGitBlamePorcelain,
  parseGitLineHistory,
  toReviewLineHistoryCommit,
} from "./reviewLineHistory.ts";
import { githubActionsLogArgs, parseGitHubActionsLogTarget } from "./reviewCiLog.ts";

export class ReviewService extends Context.Service<
  ReviewService,
  {
    readonly getDiffPreview: (
      input: ReviewDiffPreviewInput,
    ) => Effect.Effect<ReviewDiffPreviewResult, ReviewDiffPreviewError>;
    readonly getDiffFileContents: (
      input: ReviewDiffFileContentsInput,
    ) => Effect.Effect<ReviewDiffFileContentsResult, ReviewDiffPreviewError>;
    readonly getLineHistory: (
      input: ReviewLineHistoryInput,
    ) => Effect.Effect<ReviewLineHistoryResult, ReviewLineHistoryError | VcsError>;
    readonly getCiLog: (
      input: ReviewCiLogInput,
    ) => Effect.Effect<ReviewCiLogResult, ReviewCiLogError | VcsError>;
  }
>()("t3/review/ReviewService") {}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const vcsProcess = yield* VcsProcess.VcsProcess;

  const canonicalizePath = (value: string) => {
    const resolvedPath = path.resolve(value);
    return fileSystem.realPath(resolvedPath).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeed(resolvedPath)
            : Effect.fail(
                new VcsRepositoryDetectionError({
                  operation: "ReviewService.assertWorkspaceBoundCwd.canonicalizePath",
                  cwd: resolvedPath,
                  detail: "Failed to resolve a path while validating the review workspace.",
                  cause,
                }),
              ),
      }),
    );
  };

  const isWithinRoot = (candidate: string, root: string) => {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  };

  const assertWorkspaceBoundCwd = Effect.fn("ReviewService.assertWorkspaceBoundCwd")(function* (
    operation:
      | "ReviewService.getDiffPreview"
      | "ReviewService.getDiffFileContents"
      | "ReviewService.getLineHistory"
      | "ReviewService.getCiLog",
    cwd: string,
  ) {
    const [candidate, workspaceRoot, worktreesRoot] = yield* Effect.all([
      canonicalizePath(cwd),
      canonicalizePath(config.cwd),
      canonicalizePath(config.worktreesDir),
    ]);

    if (isWithinRoot(candidate, workspaceRoot) || isWithinRoot(candidate, worktreesRoot)) {
      return candidate;
    }

    return yield* new VcsRepositoryDetectionError({
      operation,
      cwd,
      detail:
        operation === "ReviewService.getDiffPreview"
          ? "Review diff preview cwd must stay within the configured workspace root."
          : operation === "ReviewService.getDiffFileContents"
            ? "Review diff file contents cwd must stay within the configured workspace root."
            : operation === "ReviewService.getLineHistory"
              ? "Review line history cwd must stay within the configured workspace root."
              : "Review CI log cwd must stay within the configured workspace root.",
    });
  });

  const getCiLog: ReviewService["Service"]["getCiLog"] = Effect.fn("ReviewService.getCiLog")(
    function* (input) {
      const operation = "ReviewService.getCiLog";
      const cwd = yield* assertWorkspaceBoundCwd(operation, input.cwd);
      const target = parseGitHubActionsLogTarget(input.checkUrl);
      if (target === null) {
        return yield* new ReviewCiLogError({
          operation,
          cwd,
          checkName: input.checkName,
          detail:
            "In-app logs are currently available for GitHub Actions checks. Open this check on its provider instead.",
        });
      }
      const output = yield* vcsProcess.run({
        operation,
        command: "gh",
        args: githubActionsLogArgs(target),
        cwd,
        allowNonZeroExit: true,
        timeoutMs: 30_000,
        maxOutputBytes: 4_000_000,
      });
      if (output.exitCode !== 0) {
        return yield* new ReviewCiLogError({
          operation,
          cwd,
          checkName: input.checkName,
          detail: output.stderr.trim() || "GitHub CLI could not load this workflow log.",
        });
      }
      return {
        checkName: input.checkName,
        checkUrl: input.checkUrl,
        content: output.stdout,
        truncated: output.stdoutTruncated,
        generatedAt: yield* DateTime.now,
      };
    },
  );

  const getLineHistory: ReviewService["Service"]["getLineHistory"] = Effect.fn(
    "ReviewService.getLineHistory",
  )(function* (input) {
    const operation = "ReviewService.getLineHistory";
    const canonicalCwd = yield* assertWorkspaceBoundCwd(operation, input.cwd);
    const absoluteFile = yield* canonicalizePath(path.resolve(canonicalCwd, input.path));
    if (!isWithinRoot(absoluteFile, canonicalCwd)) {
      return yield* new ReviewLineHistoryError({
        operation,
        cwd: canonicalCwd,
        path: input.path,
        line: input.line,
        stage: "validate",
        detail: "Line history paths must stay within the review worktree.",
      });
    }

    const contents = yield* fileSystem.readFileString(absoluteFile).pipe(
      Effect.mapError(
        () =>
          new ReviewLineHistoryError({
            operation,
            cwd: canonicalCwd,
            path: input.path,
            line: input.line,
            stage: "validate",
            detail: "The selected file could not be read from the review worktree.",
          }),
      ),
    );
    const fileLines = contents.split(/\r?\n/u);
    if (input.line > fileLines.length) {
      return yield* new ReviewLineHistoryError({
        operation,
        cwd: canonicalCwd,
        path: input.path,
        line: input.line,
        stage: "validate",
        detail: `Line ${input.line} is outside this ${fileLines.length}-line file.`,
      });
    }

    const contextStart = Math.max(1, input.line - 24);
    const contextEnd = Math.min(fileLines.length, input.line + 24);
    const [headOutput, blameOutput, historyOutput, remoteOutput] = yield* Effect.all(
      [
        vcsProcess.run({
          operation: `${operation}.head`,
          command: "git",
          args: ["rev-parse", "HEAD"],
          cwd: canonicalCwd,
          timeoutMs: 10_000,
          maxOutputBytes: 4_096,
        }),
        vcsProcess.run({
          operation: `${operation}.blame`,
          command: "git",
          args: [
            "blame",
            "--line-porcelain",
            "--date=unix",
            "-L",
            `${contextStart},${contextEnd}`,
            "--",
            input.path,
          ],
          cwd: canonicalCwd,
          allowNonZeroExit: true,
          timeoutMs: 20_000,
          maxOutputBytes: 1_000_000,
        }),
        vcsProcess.run({
          operation: `${operation}.history`,
          command: "git",
          args: [
            "log",
            "-n",
            "12",
            "--no-patch",
            `--format=${REVIEW_LINE_HISTORY_FORMAT}`,
            "-L",
            `${input.line},${input.line}:${input.path}`,
          ],
          cwd: canonicalCwd,
          allowNonZeroExit: true,
          timeoutMs: 20_000,
          maxOutputBytes: 1_000_000,
        }),
        vcsProcess.run({
          operation: `${operation}.remote`,
          command: "git",
          args: ["remote", "get-url", "origin"],
          cwd: canonicalCwd,
          allowNonZeroExit: true,
          timeoutMs: 10_000,
          maxOutputBytes: 16_384,
        }),
      ],
      { concurrency: 4 },
    );
    if (blameOutput.exitCode !== 0) {
      return yield* new ReviewLineHistoryError({
        operation,
        cwd: canonicalCwd,
        path: input.path,
        line: input.line,
        stage: "blame",
        detail: blameOutput.stderr.trim() || "Git could not determine history for this line.",
      });
    }

    const blame = parseGitBlamePorcelain(blameOutput.stdout);
    const selectedBlame = blame.find((line) => line.finalLine === input.line) ?? null;
    if (!selectedBlame) {
      return yield* new ReviewLineHistoryError({
        operation,
        cwd: canonicalCwd,
        path: input.path,
        line: input.line,
        stage: "blame",
        detail: "Git returned no authorship record for the selected line.",
      });
    }

    const history = historyOutput.exitCode === 0 ? parseGitLineHistory(historyOutput.stdout) : [];
    const remote = normalizeReviewRemote(remoteOutput.exitCode === 0 ? remoteOutput.stdout : "");
    const introducedHistory = selectedBlame.commitSha
      ? (history.find((commit) => commit.sha === selectedBlame.commitSha) ??
        (selectedBlame.authoredAt
          ? {
              sha: selectedBlame.commitSha,
              author: selectedBlame.author,
              authoredAt: selectedBlame.authoredAt,
              summary: selectedBlame.summary,
              message: selectedBlame.summary,
            }
          : null))
      : null;
    const introducedBy = introducedHistory
      ? toReviewLineHistoryCommit(introducedHistory, remote)
      : null;
    const versions = (yield* Effect.all(
      history.slice(0, 5).map((commit) =>
        vcsProcess
          .run({
            operation: `${operation}.version`,
            command: "git",
            args: ["show", `${commit.sha}:${input.path}`],
            cwd: canonicalCwd,
            allowNonZeroExit: true,
            timeoutMs: 10_000,
            maxOutputBytes: 1_000_000,
          })
          .pipe(
            Effect.map((output) =>
              output.exitCode === 0
                ? {
                    commit: toReviewLineHistoryCommit(commit, remote),
                    ...excerptAtLine(output.stdout, selectedBlame.originalLine),
                  }
                : null,
            ),
          ),
      ),
      { concurrency: 4 },
    )).filter((version) => version !== null);
    const now = yield* DateTime.now;
    return {
      path: input.path,
      line: input.line,
      headSha: headOutput.stdout.trim(),
      generatedAt: now,
      introducedBy,
      originalLine: selectedBlame.commitSha ? selectedBlame.originalLine : null,
      isUncommitted: selectedBlame.commitSha === null,
      versions,
      ownership: buildOwnershipSegments(blame),
      reviewerSuggestions: buildReviewerSuggestions(blame, history),
      risk: assessLineRisk({
        introducedAt: selectedBlame.authoredAt,
        history,
        now,
      }),
      truncated:
        blameOutput.stdoutTruncated || historyOutput.stdoutTruncated || history.length === 12,
    } satisfies ReviewLineHistoryResult;
  });

  const getDiffPreview: ReviewService["Service"]["getDiffPreview"] = Effect.fn(
    "ReviewService.getDiffPreview",
  )(function* (input) {
    yield* assertWorkspaceBoundCwd("ReviewService.getDiffPreview", input.cwd);

    const handle = yield* vcsRegistry.detect({ cwd: input.cwd, requestedKind: "auto" });
    if (!handle) {
      return {
        cwd: input.cwd,
        generatedAt: yield* DateTime.now,
        sources: [],
      };
    }

    const getDriverDiffPreview = handle.driver.getDiffPreview;
    if (!getDriverDiffPreview) {
      if (handle.kind === "git") {
        return yield* git.getReviewDiffPreview(input);
      }
      return yield* new VcsUnsupportedOperationError({
        operation: "ReviewService.getDiffPreview",
        kind: handle.kind,
        detail: `The ${handle.kind} VCS driver does not support review diff previews.`,
      });
    }

    return yield* getDriverDiffPreview(input);
  });

  const getDiffFileContents: ReviewService["Service"]["getDiffFileContents"] = Effect.fn(
    "ReviewService.getDiffFileContents",
  )(function* (input) {
    yield* assertWorkspaceBoundCwd("ReviewService.getDiffFileContents", input.cwd);

    const handle = yield* vcsRegistry.detect({ cwd: input.cwd, requestedKind: "auto" });
    if (handle?.kind !== "git") {
      return yield* new VcsUnsupportedOperationError({
        operation: "ReviewService.getDiffFileContents",
        kind: handle?.kind ?? "unknown",
        detail: "Unchanged diff expansion currently requires a Git repository.",
      });
    }

    return yield* git.getReviewDiffFileContents(input);
  });

  return ReviewService.of({
    getDiffPreview,
    getDiffFileContents,
    getLineHistory,
    getCiLog,
  });
});

export const layerBase = Layer.effect(ReviewService, make);
export const layer = layerBase.pipe(Layer.provide(VcsProcess.layer));
