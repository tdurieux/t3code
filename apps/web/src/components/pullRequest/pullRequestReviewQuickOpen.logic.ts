import type { ProjectContentMatch } from "@t3tools/contracts";

export type PullRequestReviewQuickOpenMode =
  | "files"
  | "currentSymbols"
  | "workspaceSymbols"
  | "line"
  | "text";

export interface PullRequestReviewQuickOpenQuery {
  readonly mode: PullRequestReviewQuickOpenMode;
  readonly search: string;
  readonly line?: number;
  readonly column?: number;
}

export interface PullRequestReviewDeclaration {
  readonly name: string;
  readonly kind: "type" | "function" | "method" | "module";
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly detail: string;
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function parsePullRequestReviewQuickOpenQuery(
  query: string,
): PullRequestReviewQuickOpenQuery {
  const value = query.trimStart();
  const prefix = value[0];
  if (prefix === "@" || prefix === "#" || prefix === "/") {
    return {
      mode: prefix === "@" ? "currentSymbols" : prefix === "#" ? "workspaceSymbols" : "text",
      search: value.slice(1).trim(),
    };
  }
  if (prefix === ":") {
    const match = /^:\s*(\d+)?(?:\s*[:,]\s*(\d+))?/.exec(value);
    const line = positiveInteger(match?.[1]);
    const column = positiveInteger(match?.[2]);
    return {
      mode: "line",
      search: "",
      ...(line === undefined ? {} : { line }),
      ...(column === undefined ? {} : { column }),
    };
  }
  const filePosition = /^(.*?):(\d+)(?::(\d+))?\s*$/.exec(value);
  const line = positiveInteger(filePosition?.[2]);
  const column = positiveInteger(filePosition?.[3]);
  return {
    mode: "files",
    search: (filePosition?.[1] ?? query).trim(),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
  };
}

function normalize(value: string): string {
  return value.replaceAll("\\", "/").toLocaleLowerCase();
}

function fuzzyPathScore(path: string, query: string): number | null {
  const candidate = normalize(path);
  const needle = normalize(query).replaceAll(" ", "");
  if (!needle) return 0;
  const basename = candidate.slice(candidate.lastIndexOf("/") + 1);
  if (basename === needle) return 20_000;
  if (basename.startsWith(needle)) return 18_000 - basename.length;
  const basenameMatch = basename.indexOf(needle);
  if (basenameMatch >= 0) return 16_000 - basenameMatch * 10 - basename.length;
  const pathMatch = candidate.indexOf(needle);
  if (pathMatch >= 0) return 12_000 - pathMatch - candidate.length;

  let score = 8_000;
  let cursor = 0;
  let previous = -1;
  for (const character of needle) {
    const match = candidate.indexOf(character, cursor);
    if (match < 0) return null;
    const boundary = match === 0 || candidate[match - 1] === "/" || candidate[match - 1] === ".";
    if (boundary) score += 80;
    score -= previous < 0 ? match : Math.max(0, match - previous - 1) * 4;
    previous = match;
    cursor = match + 1;
  }
  return score - candidate.length;
}

export function selectPullRequestReviewFiles(input: {
  readonly projectPaths: ReadonlyArray<string>;
  readonly changedPaths: ReadonlyArray<string>;
  readonly query: string;
  readonly limit?: number;
}): ReadonlyArray<{ readonly path: string; readonly changed: boolean }> {
  const changed = new Set(input.changedPaths);
  const candidates = [...new Set([...input.changedPaths, ...input.projectPaths])];
  return candidates
    .flatMap((path, index) => {
      const score = fuzzyPathScore(path, input.query);
      return score === null ? [] : [{ path, index, score: score + (changed.has(path) ? 100 : 0) }];
    })
    .toSorted((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, input.limit ?? 100)
    .map(({ path }) => ({ path, changed: changed.has(path) }));
}

export function pullRequestReviewDeclarationQuery(query: string): string {
  return (query.match(/[A-Za-z0-9_$]/g)?.slice(0, 24) ?? []).join("[\\w$]*");
}

const TYPE_KEYWORDS = new Set([
  "actor",
  "class",
  "enum",
  "interface",
  "protocol",
  "record",
  "struct",
  "trait",
  "type",
]);
const MODULE_KEYWORDS = new Set(["module", "namespace"]);
const CONTROL_FLOW_NAMES = new Set(["catch", "for", "if", "new", "return", "switch", "while"]);
const KEYWORD_DECLARATION =
  /\b(actor|class|enum|interface|protocol|record|struct|trait|type|module|namespace|function|fn|func|def|fun)\s+(?:\([^)]*\)\s*)?(?:(?:class|struct)\s+)?(?:self\.)?\*?\s*([A-Za-z_$][\w$]*)/;
const VARIABLE_FUNCTION =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)(?:\s*:[^=]+)?\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/;
const DECLARATION_MODIFIER =
  "(?:abstract|async|declare|default|export|external|final|inline|internal|open|operator|override|private|protected|public|readonly|static|suspend|virtual)";
const SIMPLE_METHOD = new RegExp(
  `^\\s*((?:${DECLARATION_MODIFIER}\\s+)*)(?:get\\s+|set\\s+)?([A-Za-z_$][\\w$]*)\\s*(?:<[^>]*>)?\\s*\\([^;]*\\)\\s*(:[^=;{]+)?\\s*(\\{|=>|;)?\\s*$`,
);
const TYPED_METHOD = new RegExp(
  `^\\s*(?:${DECLARATION_MODIFIER}\\s+)*(?:<[^>]+>\\s+)?(?:[A-Za-z_$][\\w$<>,.?\\[\\]:*&]*\\s+)+([A-Za-z_$][\\w$]*)\\s*\\(`,
);

function declarationAt(match: ProjectContentMatch): PullRequestReviewDeclaration | null {
  const line = match.lineContent;
  const keyword = KEYWORD_DECLARATION.exec(line);
  if (keyword?.[1] && keyword[2]) {
    const name = keyword[2];
    const offset = line.indexOf(name, keyword.index);
    const kind = TYPE_KEYWORDS.has(keyword[1])
      ? "type"
      : MODULE_KEYWORDS.has(keyword[1])
        ? "module"
        : keyword[1] === "func" && line.slice(keyword.index, offset).includes("(")
          ? "method"
          : "function";
    return {
      name,
      kind,
      path: match.path,
      line: match.lineNumber,
      column: offset + 1,
      detail: line.trim(),
    };
  }
  const variable = VARIABLE_FUNCTION.exec(line);
  if (variable?.[1]) {
    return {
      name: variable[1],
      kind: "function",
      path: match.path,
      line: match.lineNumber,
      column: line.indexOf(variable[1], variable.index) + 1,
      detail: line.trim(),
    };
  }
  const method = SIMPLE_METHOD.exec(line);
  if (
    method?.[2] &&
    !CONTROL_FLOW_NAMES.has(method[2]) &&
    Boolean(method[1] || method[3] || (method[4] && method[4] !== ";"))
  ) {
    return {
      name: method[2],
      kind: "method",
      path: match.path,
      line: match.lineNumber,
      column: line.indexOf(method[2], method.index) + 1,
      detail: line.trim(),
    };
  }
  const typed = TYPED_METHOD.exec(line);
  if (typed?.[1] && !CONTROL_FLOW_NAMES.has(typed[1])) {
    return {
      name: typed[1],
      kind: "method",
      path: match.path,
      line: match.lineNumber,
      column: line.indexOf(typed[1], typed.index) + 1,
      detail: line.trim(),
    };
  }
  return null;
}

function declarationScore(name: string, query: string): number | null {
  const candidate = name.toLocaleLowerCase();
  const needle = query.trim().toLocaleLowerCase().replaceAll(" ", "");
  if (!needle) return 0;
  if (candidate === needle) return 10_000;
  if (candidate.startsWith(needle)) return 9_000 - candidate.length;
  const substring = candidate.indexOf(needle);
  if (substring >= 0) return 8_000 - substring * 10 - candidate.length;
  let cursor = 0;
  let score = 5_000;
  for (const character of needle) {
    const position = candidate.indexOf(character, cursor);
    if (position < 0) return null;
    score -= position - cursor;
    cursor = position + 1;
  }
  return score - candidate.length;
}

export function selectPullRequestReviewDeclarations(input: {
  readonly matches: ReadonlyArray<ProjectContentMatch>;
  readonly query: string;
  readonly limit?: number;
}): ReadonlyArray<PullRequestReviewDeclaration> {
  const seen = new Set<string>();
  return input.matches
    .flatMap((match, index) => {
      const declaration = declarationAt(match);
      if (!declaration) return [];
      const score = declarationScore(declaration.name, input.query);
      const key = `${declaration.path}:${declaration.line}:${declaration.name}`;
      if (score === null || seen.has(key)) return [];
      seen.add(key);
      return [{ declaration, index, score }];
    })
    .toSorted((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, input.limit ?? 50)
    .map(({ declaration }) => declaration);
}
