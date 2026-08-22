import { diffFileTier } from "./pullRequestFileOrder.logic";

export type PullRequestReviewFileType = "code" | "tests" | "docs" | "config" | "generated";

export interface PullRequestReviewFileGroup<A> {
  readonly type: PullRequestReviewFileType;
  readonly label: string;
  readonly files: ReadonlyArray<A>;
}

const GROUPS: ReadonlyArray<{
  readonly type: PullRequestReviewFileType;
  readonly label: string;
}> = [
  { type: "code", label: "Code" },
  { type: "tests", label: "Tests" },
  { type: "docs", label: "Docs" },
  { type: "config", label: "Config" },
  { type: "generated", label: "Generated" },
];

const DOC_EXTENSIONS = new Set(["adoc", "md", "mdx", "rst"]);
const CONFIG_EXTENSIONS = new Set(["json", "toml", "yaml", "yml"]);
const CONFIG_NAMES = new Set([
  "biome.json",
  "deno.json",
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
]);

export function pullRequestReviewFileType(path: string): PullRequestReviewFileType {
  const tier = diffFileTier(path);
  if (tier === "test") return "tests";
  if (tier === "generated") return "generated";

  const segments = path.toLocaleLowerCase().split("/");
  const name = segments.at(-1) ?? "";
  const extension = name.includes(".") ? (name.split(".").at(-1) ?? "") : "";
  if (segments.includes("docs") || DOC_EXTENSIONS.has(extension)) return "docs";
  if (
    segments.includes(".github") ||
    name.startsWith(".") ||
    name.includes(".config.") ||
    CONFIG_NAMES.has(name) ||
    CONFIG_EXTENSIONS.has(extension)
  ) {
    return "config";
  }
  return "code";
}

export function groupPullRequestReviewFiles<A extends { readonly path: string }>(
  files: ReadonlyArray<A>,
): ReadonlyArray<PullRequestReviewFileGroup<A>> {
  const byType = new Map<PullRequestReviewFileType, Array<A>>();
  for (const file of files) {
    const type = pullRequestReviewFileType(file.path);
    const group = byType.get(type);
    if (group) group.push(file);
    else byType.set(type, [file]);
  }
  return GROUPS.flatMap(({ type, label }) => {
    const entries = byType.get(type);
    return entries && entries.length > 0 ? [{ type, label, files: entries }] : [];
  });
}
