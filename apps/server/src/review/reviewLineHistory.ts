import * as DateTime from "effect/DateTime";

import type {
  ReviewLineHistoryAuthor,
  ReviewLineHistoryCommit,
  ReviewLineOwnershipSegment,
  ReviewLineReviewerSuggestion,
  ReviewLineRisk,
} from "@t3tools/contracts";

const NULL_SHA = /^0+$/u;
const COMMIT_RECORD_SEPARATOR = "\u001e";
const COMMIT_FIELD_SEPARATOR = "\u001f";

export interface ParsedBlameLine {
  readonly commitSha: string | null;
  readonly originalLine: number;
  readonly finalLine: number;
  readonly author: ReviewLineHistoryAuthor;
  readonly authoredAt: DateTime.Utc | null;
  readonly summary: string;
  readonly source: string;
}

export interface ParsedLineHistoryCommit {
  readonly sha: string;
  readonly author: ReviewLineHistoryAuthor;
  readonly authoredAt: DateTime.Utc;
  readonly summary: string;
  readonly message: string;
}

export interface ReviewRemoteLinks {
  readonly repositoryUrl: string | null;
  readonly provider: "github" | "gitlab" | "bitbucket" | "unknown" | null;
}

function cleanEmail(value: string | undefined): string | null {
  const email = value?.trim().replace(/^<|>$/gu, "") ?? "";
  return email.length > 0 ? email : null;
}

function makeUtc(value: string | undefined): DateTime.Utc | null {
  if (!value) return null;
  const milliseconds = Number(value) * 1_000;
  if (!Number.isFinite(milliseconds)) return null;
  return DateTime.makeUnsafe(milliseconds);
}

export function parseGitBlamePorcelain(output: string): ParsedBlameLine[] {
  const lines = output.split(/\r?\n/u);
  const result: ParsedBlameLine[] = [];
  let index = 0;

  while (index < lines.length) {
    const header = /^([0-9a-f]{40,64}) (\d+) (\d+)(?: \d+)?$/iu.exec(lines[index] ?? "");
    if (!header) {
      index += 1;
      continue;
    }

    const commitSha = header[1] ?? "";
    const originalLine = Number(header[2]);
    const finalLine = Number(header[3]);
    const metadata = new Map<string, string>();
    let source = "";
    index += 1;
    while (index < lines.length) {
      const line = lines[index] ?? "";
      if (line.startsWith("\t")) {
        source = line.slice(1);
        index += 1;
        break;
      }
      const separator = line.indexOf(" ");
      if (separator > 0) metadata.set(line.slice(0, separator), line.slice(separator + 1));
      index += 1;
    }

    const authorName = metadata.get("author")?.trim() || "Unknown author";
    result.push({
      commitSha: NULL_SHA.test(commitSha) ? null : commitSha,
      originalLine,
      finalLine,
      author: { name: authorName, email: cleanEmail(metadata.get("author-mail")) },
      authoredAt: makeUtc(metadata.get("author-time")),
      summary: metadata.get("summary")?.trim() || "Uncommitted change",
      source,
    });
  }

  return result;
}

export function parseGitLineHistory(output: string): ParsedLineHistoryCommit[] {
  return output.split(COMMIT_RECORD_SEPARATOR).flatMap((record) => {
    const fields = record.trim().split(COMMIT_FIELD_SEPARATOR);
    const [sha, name, email, authoredAt, summary, ...messageParts] = fields;
    if (!sha || !name || !authoredAt || !summary || Number.isNaN(Date.parse(authoredAt))) return [];
    return [
      {
        sha,
        author: { name, email: cleanEmail(email) },
        authoredAt: DateTime.makeUnsafe(authoredAt),
        summary,
        message: messageParts.join(COMMIT_FIELD_SEPARATOR).trim() || summary,
      },
    ];
  });
}

export function normalizeReviewRemote(remote: string): ReviewRemoteLinks {
  const trimmed = remote.trim().replace(/\.git$/u, "");
  if (!trimmed) return { repositoryUrl: null, provider: null };
  const scp = /^git@([^:]+):(.+)$/u.exec(trimmed);
  const repositoryUrl = scp
    ? `https://${scp[1]}/${scp[2]}`
    : /^https?:\/\//u.test(trimmed)
      ? trimmed
      : trimmed.startsWith("ssh://")
        ? trimmed.replace(/^ssh:\/\/git@/u, "https://")
        : null;
  if (!repositoryUrl) return { repositoryUrl: null, provider: null };
  const host = (() => {
    try {
      return new URL(repositoryUrl).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  return {
    repositoryUrl,
    provider: host.includes("github")
      ? "github"
      : host.includes("gitlab")
        ? "gitlab"
        : host.includes("bitbucket")
          ? "bitbucket"
          : "unknown",
  };
}

function pullRequestNumber(message: string): number | null {
  for (const pattern of [/pull request\s+#(\d+)/iu, /\(#(\d+)\)/u, /merge request\s+!(\d+)/iu]) {
    const value = Number(pattern.exec(message)?.[1]);
    if (Number.isInteger(value) && value > 0) return value;
  }
  return null;
}

export function toReviewLineHistoryCommit(
  commit: ParsedLineHistoryCommit,
  remote: ReviewRemoteLinks,
): ReviewLineHistoryCommit {
  const prNumber = pullRequestNumber(`${commit.summary}\n${commit.message}`);
  const commitUrl = remote.repositoryUrl
    ? remote.provider === "gitlab"
      ? `${remote.repositoryUrl}/-/commit/${commit.sha}`
      : remote.provider === "bitbucket"
        ? `${remote.repositoryUrl}/commits/${commit.sha}`
        : `${remote.repositoryUrl}/commit/${commit.sha}`
    : null;
  const prUrl =
    remote.repositoryUrl && prNumber
      ? remote.provider === "gitlab"
        ? `${remote.repositoryUrl}/-/merge_requests/${prNumber}`
        : remote.provider === "bitbucket"
          ? `${remote.repositoryUrl}/pull-requests/${prNumber}`
          : `${remote.repositoryUrl}/pull/${prNumber}`
      : null;
  return {
    sha: commit.sha,
    shortSha: commit.sha.slice(0, 8),
    author: commit.author,
    authoredAt: commit.authoredAt,
    summary: commit.summary,
    message: commit.message,
    url: commitUrl,
    pullRequest: prUrl && prNumber ? { number: prNumber, url: prUrl } : null,
  };
}

export function buildOwnershipSegments(
  blame: ReadonlyArray<ParsedBlameLine>,
): ReviewLineOwnershipSegment[] {
  const segments: ReviewLineOwnershipSegment[] = [];
  for (const line of blame.toSorted((left, right) => left.finalLine - right.finalLine)) {
    const previous = segments.at(-1);
    const sameOwner =
      previous &&
      previous.endLine + 1 === line.finalLine &&
      previous.author.name.trim().toLocaleLowerCase() ===
        line.author.name.trim().toLocaleLowerCase();
    if (sameOwner) {
      const lineIsNewer =
        line.authoredAt !== null &&
        (previous.authoredAt === null ||
          DateTime.toEpochMillis(line.authoredAt) > DateTime.toEpochMillis(previous.authoredAt));
      segments[segments.length - 1] = {
        ...previous,
        endLine: line.finalLine,
        ...(lineIsNewer ? { commitSha: line.commitSha, authoredAt: line.authoredAt } : {}),
      };
      continue;
    }
    segments.push({
      startLine: line.finalLine,
      endLine: line.finalLine,
      author: line.author,
      commitSha: line.commitSha,
      authoredAt: line.authoredAt,
    });
  }
  return segments;
}

function authorKey(author: ReviewLineHistoryAuthor): string {
  return `${author.name.toLowerCase()}\u0000${author.email?.toLowerCase() ?? ""}`;
}

export function buildReviewerSuggestions(
  blame: ReadonlyArray<ParsedBlameLine>,
  history: ReadonlyArray<ParsedLineHistoryCommit>,
): ReviewLineReviewerSuggestion[] {
  const candidates = new Map<
    string,
    { author: ReviewLineHistoryAuthor; nearbyLines: number; historicalTouches: number }
  >();
  for (const line of blame) {
    if (!line.commitSha) continue;
    const key = authorKey(line.author);
    const current = candidates.get(key) ?? {
      author: line.author,
      nearbyLines: 0,
      historicalTouches: 0,
    };
    candidates.set(key, { ...current, nearbyLines: current.nearbyLines + 1 });
  }
  for (const commit of history) {
    const key = authorKey(commit.author);
    const current = candidates.get(key) ?? {
      author: commit.author,
      nearbyLines: 0,
      historicalTouches: 0,
    };
    candidates.set(key, { ...current, historicalTouches: current.historicalTouches + 1 });
  }
  return [...candidates.values()]
    .map((candidate) => {
      const score = candidate.nearbyLines * 3 + candidate.historicalTouches * 2;
      const reason =
        candidate.nearbyLines > 0 && candidate.historicalTouches > 0
          ? `Owns ${candidate.nearbyLines} nearby lines and touched this line ${candidate.historicalTouches} times`
          : candidate.nearbyLines > 0
            ? `Owns ${candidate.nearbyLines} nearby lines`
            : `Touched this line ${candidate.historicalTouches} times`;
      return { ...candidate, score, reason };
    })
    .toSorted(
      (left, right) =>
        right.score - left.score || left.author.name.localeCompare(right.author.name),
    )
    .slice(0, 5);
}

export function assessLineRisk(input: {
  readonly introducedAt: DateTime.Utc | null;
  readonly history: ReadonlyArray<ParsedLineHistoryCommit>;
  readonly now: DateTime.Utc;
}): ReviewLineRisk {
  const ageDays = input.introducedAt
    ? Math.max(
        0,
        Math.floor(
          (DateTime.toEpochMillis(input.now) - DateTime.toEpochMillis(input.introducedAt)) /
            86_400_000,
        ),
      )
    : 0;
  const touchCount = input.history.length;
  const revertCount = input.history.filter((commit) =>
    /\brevert(?:ed|s|ing)?\b/iu.test(commit.summary),
  ).length;
  const stability =
    revertCount > 0
      ? "reverted"
      : touchCount >= 5
        ? "active"
        : ageDays >= 365
          ? "long-untouched"
          : ageDays <= 30
            ? "recent"
            : "stable";
  const signals: string[] = [];
  if (stability === "reverted")
    signals.push(
      `${revertCount} historical revert${revertCount === 1 ? "" : "s"} touched this line.`,
    );
  if (touchCount >= 5)
    signals.push(`This line changed ${touchCount} times in the available history.`);
  if (ageDays >= 365)
    signals.push(`The current line has been untouched for ${Math.floor(ageDays / 365)}+ years.`);
  else if (ageDays <= 30)
    signals.push(`The current line was introduced ${ageDays} day${ageDays === 1 ? "" : "s"} ago.`);
  if (signals.length === 0)
    signals.push(
      `The current line has ${touchCount} historical touch${touchCount === 1 ? "" : "es"}.`,
    );
  return { stability, ageDays, touchCount, revertCount, signals };
}

export function excerptAtLine(contents: string, line: number, radius = 3) {
  const lines = contents.split(/\r?\n/u);
  const boundedLine = Math.min(Math.max(1, line), Math.max(1, lines.length));
  const excerptStartLine = Math.max(1, boundedLine - radius);
  const excerptEndLine = Math.min(lines.length, boundedLine + radius);
  return {
    line: boundedLine,
    excerptStartLine,
    excerpt: lines.slice(excerptStartLine - 1, excerptEndLine),
  };
}

export const REVIEW_LINE_HISTORY_FORMAT = "%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%B%x1e";
