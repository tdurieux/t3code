import type { ProjectContentMatch } from "@t3tools/contracts";

import {
  selectPullRequestReviewDeclarations,
  type PullRequestReviewDeclaration,
} from "./pullRequestReviewQuickOpen.logic";

export interface PullRequestSemanticTarget {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly symbol: string;
}

export interface PullRequestSemanticRelations {
  readonly definitions: ReadonlyArray<PullRequestReviewDeclaration>;
  readonly references: ReadonlyArray<ProjectContentMatch>;
  readonly callers: ReadonlyArray<ProjectContentMatch>;
  readonly usages: ReadonlyArray<ProjectContentMatch>;
  readonly callees: ReadonlyArray<string>;
}

const CONTROL_FLOW = new Set([
  "catch",
  "for",
  "if",
  "new",
  "return",
  "sizeof",
  "switch",
  "typeof",
  "while",
]);

export function pullRequestIdentifier(value: string): string | null {
  const match = /[A-Za-z_$][\w$]*/u.exec(value.trim());
  return match?.[0] ?? null;
}

function isDeclaration(
  match: ProjectContentMatch,
  declarations: ReadonlyArray<PullRequestReviewDeclaration>,
): boolean {
  return declarations.some(
    (declaration) => declaration.path === match.path && declaration.line === match.lineNumber,
  );
}

export function pullRequestSemanticCallees(input: {
  readonly contents: string;
  readonly line: number;
  readonly symbol: string;
}): ReadonlyArray<string> {
  const lines = input.contents.split("\n");
  const start = Math.max(0, input.line - 1);
  const excerpt = lines.slice(start, Math.min(lines.length, start + 120)).join("\n");
  const names = new Set<string>();
  for (const match of excerpt.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/gu)) {
    const name = match[1];
    if (!name || name === input.symbol || CONTROL_FLOW.has(name)) continue;
    names.add(name);
    if (names.size >= 40) break;
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

export function buildPullRequestSemanticRelations(input: {
  readonly symbol: string;
  readonly matches: ReadonlyArray<ProjectContentMatch>;
  readonly currentFileContents?: string;
  readonly currentLine: number;
}): PullRequestSemanticRelations {
  const definitions = selectPullRequestReviewDeclarations({
    matches: input.matches,
    query: input.symbol,
  }).filter((declaration) => declaration.name === input.symbol);
  const references = input.matches.filter((match) => !isDeclaration(match, definitions));
  const callPattern = new RegExp(
    `\\b${input.symbol.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*\\(`,
    "u",
  );
  const callers = references.filter((match) => callPattern.test(match.lineContent));
  return {
    definitions,
    references,
    callers,
    usages: input.matches,
    callees:
      input.currentFileContents === undefined
        ? []
        : pullRequestSemanticCallees({
            contents: input.currentFileContents,
            line: input.currentLine,
            symbol: input.symbol,
          }),
  };
}

export function pullRequestSemanticExcerpt(
  contents: string,
  line: number,
  radius = 4,
): ReadonlyArray<{
  readonly number: number;
  readonly text: string;
  readonly highlighted: boolean;
}> {
  const lines = contents.split("\n");
  const start = Math.max(1, line - radius);
  const end = Math.min(lines.length, line + radius);
  return lines.slice(start - 1, end).map((text, index) => ({
    number: start + index,
    text,
    highlighted: start + index === line,
  }));
}
