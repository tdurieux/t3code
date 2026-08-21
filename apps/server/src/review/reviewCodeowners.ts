import type {
  ReviewCodeownersMetadata,
  ReviewCodeownersOwnership,
  ReviewOwnershipDriftEntry,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

export const REVIEW_CODEOWNERS_PATHS = [
  ".github/CODEOWNERS",
  "CODEOWNERS",
  "docs/CODEOWNERS",
] as const;
export const MAX_REVIEW_CODEOWNERS_BYTES = 1_000_000;
const MAX_CODEOWNERS_LINES = 10_000;
const MAX_CODEOWNERS_RULES = 5_000;
const MAX_OWNERS_PER_RULE = 50;
const MAX_OWNERSHIP_DRIFT_PATHS = 1_000;
const MAX_OWNERSHIP_DRIFT_ENTRIES = 200;

export interface ReviewCodeownersRule {
  readonly pattern: string;
  readonly owners: ReadonlyArray<string>;
  readonly sourceLine: number;
  readonly matcher: RegExp;
}

export interface ReviewCodeownersFile {
  readonly metadata: ReviewCodeownersMetadata;
  readonly rules: ReadonlyArray<ReviewCodeownersRule>;
}

const OWNER =
  /^(?:@[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?(?:\/[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?)?|[^@\s]+@[^@\s]+\.[^@\s]+)$/u;

function codeownersPatternMatcher(pattern: string): RegExp | null {
  if (
    !pattern ||
    pattern.startsWith("#") ||
    pattern.startsWith("!") ||
    pattern.includes("[") ||
    pattern.includes("]")
  ) {
    return null;
  }
  const anchored = pattern.startsWith("/");
  const raw = anchored ? pattern.slice(1) : pattern;
  const hadSlash = raw.includes("/");
  const normalized = raw.replace(/^\.\//u, "").replace(/\/+$/u, "");
  if (!normalized || normalized.includes("//") || normalized.split("/").includes("..")) {
    return null;
  }

  let expression = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]!;
    if (character === "*") {
      if (normalized[index + 1] === "*") {
        index += 1;
        if (normalized[index + 1] === "/") {
          index += 1;
          expression += "(?:.*/)?";
        } else {
          expression += ".*";
        }
      } else {
        expression += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      expression += "[^/]";
      continue;
    }
    expression += character.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
  }

  const prefix = anchored || hadSlash ? "^" : "(?:^|.*/)";
  return new RegExp(`${prefix}${expression}(?:/.*)?$`, "u");
}

export function parseReviewCodeowners(content: string, sourcePath: string): ReviewCodeownersFile {
  const allLines = content.split(/\r?\n/u);
  const lines = allLines.slice(0, MAX_CODEOWNERS_LINES);
  const rules: ReviewCodeownersRule[] = [];
  let discoveredRules = 0;
  let ownersTruncated = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line || line.startsWith("#")) continue;
    const tokens = line.split(/\s+/u);
    const commentIndex = tokens.findIndex((token) => token.startsWith("#"));
    const meaningful = commentIndex >= 0 ? tokens.slice(0, commentIndex) : tokens;
    const pattern = meaningful[0];
    if (!pattern) continue;
    const matcher = codeownersPatternMatcher(pattern);
    const owners = meaningful.slice(1).filter((owner) => OWNER.test(owner));
    if (!matcher || owners.length === 0) continue;
    discoveredRules += 1;
    if (rules.length >= MAX_CODEOWNERS_RULES) continue;
    if (owners.length > MAX_OWNERS_PER_RULE) ownersTruncated = true;
    rules.push({
      pattern,
      owners: [...new Set(owners)].slice(0, MAX_OWNERS_PER_RULE),
      sourceLine: index + 1,
      matcher,
    });
  }
  return {
    metadata: {
      sourcePath,
      ruleCount: rules.length,
      truncated:
        allLines.length > MAX_CODEOWNERS_LINES ||
        discoveredRules > MAX_CODEOWNERS_RULES ||
        ownersTruncated,
    },
    rules,
  };
}

export function reviewCodeownersOwnership(
  filePath: string,
  codeowners: ReviewCodeownersFile | null,
): ReviewCodeownersOwnership | null {
  if (!codeowners) return null;
  const normalizedPath = filePath.replaceAll("\\", "/").replace(/^\/+/, "");
  let match: ReviewCodeownersRule | null = null;
  for (const rule of codeowners.rules) {
    if (rule.matcher.test(normalizedPath)) match = rule;
  }
  return match
    ? {
        sourcePath: codeowners.metadata.sourcePath,
        sourceLine: match.sourceLine,
        pattern: match.pattern,
        owners: match.owners,
      }
    : null;
}

function ownershipRuleEqual(
  left: ReviewCodeownersOwnership | null,
  right: ReviewCodeownersOwnership | null,
): boolean {
  const ownerSet = (ownership: ReviewCodeownersOwnership | null) =>
    JSON.stringify([...(ownership?.owners ?? [])].sort());
  return left?.pattern === right?.pattern && ownerSet(left) === ownerSet(right);
}

export function compareReviewCodeowners(input: {
  readonly paths: ReadonlyArray<string>;
  readonly base: ReviewCodeownersFile | null;
  readonly worktree: ReviewCodeownersFile | null;
}): {
  readonly entries: ReadonlyArray<ReviewOwnershipDriftEntry>;
  readonly checkedPathCount: number;
  readonly truncated: boolean;
} {
  const allPaths = [...new Set(input.paths.map((value) => value.trim()).filter(Boolean))].sort();
  const paths = allPaths.slice(0, MAX_OWNERSHIP_DRIFT_PATHS);
  const entries: ReviewOwnershipDriftEntry[] = [];
  let discoveredEntries = 0;
  for (const filePath of paths) {
    const baseOwnership = reviewCodeownersOwnership(filePath, input.base);
    const worktreeOwnership = reviewCodeownersOwnership(filePath, input.worktree);
    if (ownershipRuleEqual(baseOwnership, worktreeOwnership)) continue;
    discoveredEntries += 1;
    if (entries.length >= MAX_OWNERSHIP_DRIFT_ENTRIES) continue;
    const kind = !baseOwnership
      ? "ownership-added"
      : !worktreeOwnership
        ? "ownership-removed"
        : JSON.stringify([...baseOwnership.owners].sort()) !==
            JSON.stringify([...worktreeOwnership.owners].sort())
          ? "owners-changed"
          : "rule-changed";
    entries.push({ path: filePath, kind, baseOwnership, worktreeOwnership });
  }
  return {
    entries,
    checkedPathCount: paths.length,
    truncated:
      allPaths.length > MAX_OWNERSHIP_DRIFT_PATHS ||
      discoveredEntries > MAX_OWNERSHIP_DRIFT_ENTRIES,
  };
}

export const loadReviewCodeowners = Effect.fn("loadReviewCodeowners")(function* (
  cwd: string,
): Effect.fn.Return<ReviewCodeownersFile | null, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const canonicalRoot = yield* fileSystem
    .realPath(cwd)
    .pipe(Effect.orElseSucceed(() => path.resolve(cwd)));
  for (const sourcePath of REVIEW_CODEOWNERS_PATHS) {
    const loaded = yield* Effect.gen(function* () {
      const canonicalFile = yield* fileSystem.realPath(path.resolve(cwd, sourcePath));
      const relative = path.relative(canonicalRoot, canonicalFile);
      if (
        relative === "" ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      ) {
        return null;
      }
      const info = yield* fileSystem.stat(canonicalFile);
      if (info.type !== "File") return null;
      if (info.size > MAX_REVIEW_CODEOWNERS_BYTES) {
        return {
          metadata: { sourcePath, ruleCount: 0, truncated: true },
          rules: [],
        } satisfies ReviewCodeownersFile;
      }
      return parseReviewCodeowners(yield* fileSystem.readFileString(canonicalFile), sourcePath);
    }).pipe(Effect.orElseSucceed(() => null));
    if (loaded) return loaded;
  }
  return null;
});
