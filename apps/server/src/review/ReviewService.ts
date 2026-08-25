import * as Context from "effect/Context";
import * as NodeCrypto from "node:crypto";
import * as NodeURL from "node:url";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import {
  ReviewLineHistoryError,
  ReviewCodeNavigationError,
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
  type ReviewCodeNavigationInput,
  type ReviewCodeNavigationResult,
  type ReviewCodeSymbol,
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
import {
  compareReviewCodeowners,
  loadReviewCodeowners,
  MAX_REVIEW_CODEOWNERS_BYTES,
  parseReviewCodeowners,
  REVIEW_CODEOWNERS_PATHS,
  reviewCodeownersOwnership,
  type ReviewCodeownersFile,
} from "./reviewCodeowners.ts";
import {
  WasmCodeNavigation,
  type WasmNavigationLocation,
  type WasmNavigationSymbol,
  type WasmProjectFile,
} from "./WasmCodeNavigation.ts";

const MAX_CODE_NAVIGATION_RESULTS = 300;
const MAX_CODE_NAVIGATION_FILES = 2_000;
const MAX_CODE_NAVIGATION_SOURCE_BYTES = 32 * 1024 * 1024;
const WASM_LANGUAGE_PATTERNS = {
  typescript: ["*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs"],
  go: ["*.go"],
  java: ["*.java"],
  python: ["*.py"],
  csharp: ["*.cs"],
  c: ["*.c", "*.h", "*.h.in", "*.cc", "*.cpp", "*.cxx", "*.hh", "*.hpp"],
  ruby: ["*.rb"],
  rust: ["*.rs"],
} as const;
type WasmLanguage = keyof typeof WASM_LANGUAGE_PATTERNS;

function wasmLanguageForPath(filePath: string): WasmLanguage | null {
  const normalized = filePath.toLowerCase();
  if (/\.(?:ts|tsx|js|jsx|mjs)$/u.test(normalized)) return "typescript";
  if (normalized.endsWith(".go")) return "go";
  if (normalized.endsWith(".java")) return "java";
  if (normalized.endsWith(".py")) return "python";
  if (normalized.endsWith(".cs")) return "csharp";
  if (/\.(?:c|h|h\.in|cc|cpp|cxx|hh|hpp)$/u.test(normalized)) return "c";
  if (normalized.endsWith(".rb")) return "ruby";
  if (normalized.endsWith(".rs")) return "rust";
  return null;
}

function reviewSymbolKind(kind: string): ReviewCodeSymbol["kind"] {
  switch (kind.toLowerCase()) {
    case "functiondecl":
      return "function";
    case "typedecl":
      return "type";
    case "variabledecl":
      return "variable";
    case "fielddecl":
      return "field";
    case "parameterdecl":
      return "parameter";
    case "namespacedecl":
      return "namespace";
    case "moduledecl":
      return "module";
    case "typealiasdecl":
      return "alias";
    default:
      return "unknown";
  }
}

export class ReviewService extends Context.Service<
  ReviewService,
  {
    readonly getDiffPreview: (
      input: ReviewDiffPreviewInput,
    ) => Effect.Effect<ReviewDiffPreviewResult, ReviewDiffPreviewError>;
    readonly getDiffFileContents: (
      input: ReviewDiffFileContentsInput,
    ) => Effect.Effect<ReviewDiffFileContentsResult, ReviewDiffPreviewError>;
    readonly getCodeNavigation: (
      input: ReviewCodeNavigationInput,
    ) => Effect.Effect<ReviewCodeNavigationResult, ReviewCodeNavigationError | VcsError>;
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
  const wasmCodeNavigation = new WasmCodeNavigation();
  const wasmProjectTruncation = new Map<string, boolean>();

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
      | "ReviewService.getCodeNavigation"
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
            : operation === "ReviewService.getCodeNavigation"
              ? "Review code navigation cwd must stay within the configured workspace root."
              : operation === "ReviewService.getLineHistory"
                ? "Review line history cwd must stay within the configured workspace root."
                : "Review CI log cwd must stay within the configured workspace root.",
    });
  });

  const codeNavigationError = (input: ReviewCodeNavigationInput, cwd: string, detail: string) =>
    new ReviewCodeNavigationError({
      operation: "ReviewService.getCodeNavigation",
      cwd,
      path: input.path,
      detail,
    });

  const navigationPath = (cwd: string, filePath: string): string | null => {
    const candidate = path.isAbsolute(filePath) ? path.relative(cwd, filePath) : filePath;
    const normalized = path.normalize(candidate).replaceAll("\\", "/");
    if (!normalized || normalized === ".." || normalized.startsWith("../")) return null;
    if (normalized.split("/").some((segment) => segment === ".git" || segment === "node_modules"))
      return null;
    return normalized;
  };

  const loadCodeownersAtRevision = Effect.fn("ReviewService.loadCodeownersAtRevision")(function* (
    cwd: string,
    revision: string,
  ): Effect.fn.Return<ReviewCodeownersFile | null> {
    for (const sourcePath of REVIEW_CODEOWNERS_PATHS) {
      const output = yield* vcsProcess
        .run({
          operation: "ReviewService.loadCodeownersAtRevision",
          command: "git",
          args: [
            "show",
            "--no-textconv",
            "--format=",
            "--end-of-options",
            `${revision}:${sourcePath}`,
          ],
          cwd,
          allowNonZeroExit: true,
          timeoutMs: 10_000,
          maxOutputBytes: MAX_REVIEW_CODEOWNERS_BYTES + 1,
        })
        .pipe(Effect.orElseSucceed(() => null));
      if (!output || output.exitCode !== 0) continue;
      if (output.stdoutTruncated || output.stdout.length > MAX_REVIEW_CODEOWNERS_BYTES) {
        return {
          metadata: { sourcePath, ruleCount: 0, truncated: true },
          rules: [],
        };
      }
      return parseReviewCodeowners(output.stdout, sourcePath);
    }
    return null;
  });

  const loadLineOwnership = Effect.fn("ReviewService.loadLineOwnership")(function* (
    cwd: string,
    baseRef: string | undefined,
  ) {
    const worktree = yield* loadReviewCodeowners(cwd).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
    if (!baseRef) return { worktree, base: undefined };

    let baseSha: string | null = null;
    for (const candidate of [baseRef, `origin/${baseRef}`]) {
      const mergeBase = yield* vcsProcess
        .run({
          operation: "ReviewService.loadLineOwnership.mergeBase",
          command: "git",
          args: ["merge-base", "--", candidate, "HEAD"],
          cwd,
          allowNonZeroExit: true,
          timeoutMs: 10_000,
          maxOutputBytes: 4_096,
        })
        .pipe(Effect.orElseSucceed(() => null));
      const resolved = mergeBase?.exitCode === 0 ? mergeBase.stdout.trim() : "";
      if (resolved) {
        baseSha = resolved;
        break;
      }
    }
    if (!baseSha) return { worktree, base: undefined };
    return { worktree, base: yield* loadCodeownersAtRevision(cwd, baseSha) };
  });

  const getCodeNavigation: ReviewService["Service"]["getCodeNavigation"] = Effect.fn(
    "ReviewService.getCodeNavigation",
  )(function* (input) {
    const cwd = yield* assertWorkspaceBoundCwd("ReviewService.getCodeNavigation", input.cwd);
    const absoluteFile = yield* canonicalizePath(path.resolve(cwd, input.path));
    if (!isWithinRoot(absoluteFile, cwd)) {
      return yield* codeNavigationError(
        input,
        cwd,
        "Code navigation paths must stay within the review worktree.",
      );
    }
    const language = wasmLanguageForPath(input.path);
    if (!language) {
      return yield* codeNavigationError(
        input,
        cwd,
        "The bundled Semasmith engine does not support this file type.",
      );
    }

    const configuredWasm = globalThis.process.env.T3_SEMASMITH_WASM_PATH?.trim();
    const candidates = configuredWasm
      ? [configuredWasm]
      : [
          NodeURL.fileURLToPath(new URL("./semasmith/semasmith.wasm", import.meta.url)),
          NodeURL.fileURLToPath(new URL("../../assets/semasmith/semasmith.wasm", import.meta.url)),
        ];
    let wasmPath: string | null = null;
    for (const candidate of candidates) {
      const modulePath = candidate.replace(/\.wasm$/iu, ".mjs");
      const available = yield* Effect.all(
        [fileSystem.exists(candidate), fileSystem.exists(modulePath)],
        {
          concurrency: 2,
        },
      ).pipe(Effect.orElseSucceed(() => [false, false] as const));
      if (available.every(Boolean)) {
        wasmPath = candidate;
        break;
      }
    }
    if (!wasmPath) {
      return yield* codeNavigationError(
        input,
        cwd,
        "The bundled Semasmith engine assets are unavailable.",
      );
    }

    const revision = yield* Effect.all(
      [
        vcsProcess.run({
          operation: "ReviewService.getCodeNavigation.head",
          command: "git",
          args: ["rev-parse", "HEAD"],
          cwd,
          timeoutMs: 10_000,
          maxOutputBytes: 4_096,
        }),
        vcsProcess.run({
          operation: "ReviewService.getCodeNavigation.diffIdentity",
          command: "git",
          args: ["diff", "--binary", "--no-ext-diff", "HEAD", "--"],
          cwd,
          timeoutMs: 30_000,
          maxOutputBytes: 16 * 1024 * 1024,
        }),
        vcsProcess.run({
          operation: "ReviewService.getCodeNavigation.untracked",
          command: "git",
          args: ["ls-files", "--others", "--exclude-standard", "-z"],
          cwd,
          timeoutMs: 15_000,
          maxOutputBytes: 2 * 1024 * 1024,
        }),
      ],
      { concurrency: 3 },
    );
    const untrackedPaths = revision[2].stdout.split("\0").filter(Boolean);
    const boundedIdentity =
      !revision[1].stdoutTruncated &&
      !revision[2].stdoutTruncated &&
      untrackedPaths.length <= MAX_CODE_NAVIGATION_FILES;
    const untrackedHashes =
      boundedIdentity && untrackedPaths.length > 0
        ? yield* vcsProcess.run({
            operation: "ReviewService.getCodeNavigation.untrackedIdentity",
            command: "git",
            args: ["hash-object", "--", ...untrackedPaths],
            cwd,
            timeoutMs: 30_000,
            maxOutputBytes: untrackedPaths.length * 80,
          })
        : null;
    const identityHash = NodeCrypto.createHash("sha256")
      .update(revision[0].stdout)
      .update("\0")
      .update(revision[1].stdout)
      .update("\0")
      .update(revision[2].stdout);
    if (untrackedHashes) identityHash.update("\0").update(untrackedHashes.stdout);
    if (!boundedIdentity) {
      identityHash.update("\0").update(String(DateTime.toEpochMillis(yield* DateTime.now)));
    }
    const identity = identityHash.digest("hex");
    const projectKey = `${cwd}\0${language}\0${identity}`;

    const hasProject = yield* Effect.tryPromise({
      try: () => wasmCodeNavigation.hasProject({ wasmPath, projectKey }),
      catch: (cause) =>
        codeNavigationError(input, cwd, cause instanceof Error ? cause.message : String(cause)),
    });
    let projectTruncated = wasmProjectTruncation.get(projectKey) ?? false;
    if (!hasProject) {
      const listed = yield* vcsProcess.run({
        operation: "ReviewService.getCodeNavigation.files",
        command: "git",
        args: [
          "ls-files",
          "-co",
          "--exclude-standard",
          "-z",
          "--",
          ...WASM_LANGUAGE_PATTERNS[language],
        ],
        cwd,
        timeoutMs: 30_000,
        maxOutputBytes: 16 * 1024 * 1024,
      });
      const allSourcePaths = [...new Set(listed.stdout.split("\0").filter(Boolean))].filter(
        (filePath) => wasmLanguageForPath(filePath) === language,
      );
      projectTruncated =
        listed.stdoutTruncated || allSourcePaths.length > MAX_CODE_NAVIGATION_FILES;
      const sourcePaths = allSourcePaths.slice(0, MAX_CODE_NAVIGATION_FILES);
      if (!sourcePaths.includes(input.path)) sourcePaths.push(input.path);
      let sourceBytes = 0;
      const files = yield* Effect.forEach(
        sourcePaths,
        (filePath) =>
          fileSystem.readFileString(path.resolve(cwd, filePath)).pipe(
            Effect.map((source): WasmProjectFile | null => {
              sourceBytes += new TextEncoder().encode(source).byteLength;
              if (sourceBytes > MAX_CODE_NAVIGATION_SOURCE_BYTES) {
                projectTruncated = true;
                return null;
              }
              return { path: filePath.replaceAll("\\", "/"), source };
            }),
            Effect.orElseSucceed(() => null),
          ),
        { concurrency: 1 },
      );
      const readable = files.filter((file): file is WasmProjectFile => file !== null);
      if (readable.length === 0) {
        return yield* codeNavigationError(
          input,
          cwd,
          `No readable ${language} source files were found.`,
        );
      }
      yield* Effect.tryPromise({
        try: () => wasmCodeNavigation.build({ wasmPath, projectKey, files: readable, language }),
        catch: (cause) =>
          codeNavigationError(input, cwd, cause instanceof Error ? cause.message : String(cause)),
      });
      wasmProjectTruncation.set(projectKey, projectTruncated);
      if (wasmProjectTruncation.size > 12) {
        const oldest = wasmProjectTruncation.keys().next().value;
        if (oldest) wasmProjectTruncation.delete(oldest);
      }
    }

    const query = yield* Effect.tryPromise({
      try: () =>
        wasmCodeNavigation.query({
          wasmPath,
          projectKey,
          path: input.path.replaceAll("\\", "/"),
          line: input.line ?? 1,
          column: input.column ?? 1,
          ...(input.symbol ? { symbol: input.symbol } : {}),
        }),
      catch: (cause) =>
        codeNavigationError(input, cwd, cause instanceof Error ? cause.message : String(cause)),
    });
    const position = (location: WasmNavigationLocation | null) => {
      if (!location) return null;
      const relativePath = navigationPath(cwd, location.filePath);
      if (!relativePath) return null;
      return {
        path: relativePath,
        startLine: Math.max(1, Math.floor(location.startLine)),
        endLine: Math.max(1, Math.floor(location.endLine)),
        startColumn: Math.max(1, Math.floor(location.startColumn)),
        endColumn: Math.max(1, Math.floor(location.endColumn)),
      };
    };
    const symbol = (value: WasmNavigationSymbol): ReviewCodeSymbol | null => {
      const location = position(value.location);
      return location && value.name.trim() && value.fqName.trim()
        ? {
            name: value.name,
            fqn: value.fqName,
            kind: reviewSymbolKind(value.kind),
            position: location,
          }
        : null;
    };
    const symbols = (values: ReadonlyArray<WasmNavigationSymbol>) =>
      values
        .flatMap((value) => {
          const normalized = symbol(value);
          return normalized ? [normalized] : [];
        })
        .slice(0, MAX_CODE_NAVIGATION_RESULTS);
    const references = query.references
      .flatMap((value) => {
        const normalized = position(value.location);
        return normalized ? [normalized] : [];
      })
      .slice(0, MAX_CODE_NAVIGATION_RESULTS);
    return {
      analyzer: "bundled-semasmith-wasm",
      language,
      selectedSymbol: query.symbol ? symbol(query.symbol) : null,
      definitionCandidates: symbols(query.definitionCandidates),
      callers: symbols(query.callers),
      callees: symbols(query.callees),
      references,
      truncated:
        projectTruncated ||
        query.definitionCandidates.length > MAX_CODE_NAVIGATION_RESULTS ||
        query.callers.length > MAX_CODE_NAVIGATION_RESULTS ||
        query.callees.length > MAX_CODE_NAVIGATION_RESULTS ||
        query.references.length > MAX_CODE_NAVIGATION_RESULTS,
    };
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
    const [headOutput, blameOutput, historyOutput, remoteOutput, declaredOwnership] =
      yield* Effect.all(
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
          loadLineOwnership(canonicalCwd, input.baseRef),
        ],
        { concurrency: 5 },
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
    const codeowners =
      declaredOwnership.worktree?.metadata.truncated === true
        ? null
        : reviewCodeownersOwnership(input.path, declaredOwnership.worktree);
    const ownershipDrift =
      declaredOwnership.base === undefined ||
      declaredOwnership.base?.metadata.truncated === true ||
      declaredOwnership.worktree?.metadata.truncated === true
        ? null
        : (compareReviewCodeowners({
            paths: [input.path],
            base: declaredOwnership.base,
            worktree: declaredOwnership.worktree,
          }).entries[0] ?? null);
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
      codeowners,
      ownershipDrift,
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
    getCodeNavigation,
    getLineHistory,
    getCiLog,
  });
});

export const layerBase = Layer.effect(ReviewService, make);
export const layer = layerBase.pipe(Layer.provide(VcsProcess.layer));
