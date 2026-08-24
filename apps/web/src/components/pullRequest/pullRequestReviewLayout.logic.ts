export type PullRequestReviewFileType =
  | "core"
  | "ui"
  | "server"
  | "proto"
  | "tests"
  | "config"
  | "docs"
  | "generated"
  | "build";

export const DEFAULT_COLLAPSED_PULL_REQUEST_REVIEW_FILE_GROUPS: ReadonlyArray<PullRequestReviewFileType> =
  ["core", "generated", "build"];

export interface PullRequestReviewFileGroup<A> {
  readonly type: PullRequestReviewFileType;
  readonly label: string;
  readonly files: ReadonlyArray<A>;
  readonly additions: number;
  readonly deletions: number;
}

const GROUPS: ReadonlyArray<{ type: PullRequestReviewFileType; label: string }> = [
  { type: "core", label: "Core code" },
  { type: "ui", label: "UI" },
  { type: "server", label: "Server & API" },
  { type: "proto", label: "Protos" },
  { type: "tests", label: "Tests" },
  { type: "config", label: "Configuration & CI" },
  { type: "docs", label: "Documentation" },
  { type: "generated", label: "Generated" },
  { type: "build", label: "Build & packages" },
];

export function pullRequestReviewFileType(path: string): PullRequestReviewFileType {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const basename = normalized.split("/").at(-1) ?? normalized;

  if (
    /(^|\/)(generated|dist|out|target|coverage|\.next|\.nuxt|\.output|\.svelte-kit)(\/|$)/u.test(
      normalized,
    ) ||
    /\.(generated|gen)\.[^.]+$/u.test(basename) ||
    /(?:^|\.)openapiv\d*\.swagger\.json$/u.test(basename) ||
    /(?:^|\.)(?:openapi|swagger)\.(?:json|ya?ml)$/u.test(basename)
  ) {
    return "generated";
  }
  if (basename.endsWith(".proto")) return "proto";
  if (
    /(^|\/)(__tests__|tests?|fixtures?)(\/|$)/u.test(normalized) ||
    /\.(test|spec)\.[^.]+$/u.test(basename) ||
    /(^|_)(test|spec)\.[^.]+$/u.test(basename)
  ) {
    return "tests";
  }
  if (
    /(^|\/)(docs?|documentation)(\/|$)/u.test(normalized) ||
    /^(readme|changelog|contributing|license)(\.|$)/u.test(basename) ||
    /\.(md|mdx|rst|adoc)$/u.test(basename)
  ) {
    return "docs";
  }
  if (
    /^(package(-lock)?\.json|pnpm-(?:lock|workspace)\.yaml|yarn\.lock|bun\.lockb?|go\.(mod|sum)|cargo\.(toml|lock)|pyproject\.toml|poetry\.lock|requirements[^/]*\.txt|pom\.xml|build\.gradle(?:\.kts)?)$/u.test(
      basename,
    ) ||
    /^(build|workspace|module)(?:\.bazel)?$/u.test(basename) ||
    /\.(?:bzl|bazel)$/u.test(basename) ||
    /^\.bazelrc(?:\..+)?$/u.test(basename) ||
    /(^|\/)(fx|\.fx)(\/|$)/u.test(normalized) ||
    /^\.?fx(?:rc)?(?:\.(?:json|ya?ml|toml))?$/u.test(basename)
  ) {
    return "build";
  }
  if (
    /(^|\/)(\.github|\.circleci|config|configs|scripts?)(\/|$)/u.test(normalized) ||
    /^(dockerfile|makefile|justfile)$/u.test(basename) ||
    /\.(ya?ml|toml|ini|conf|config)$/u.test(basename)
  ) {
    return "config";
  }
  if (
    /(^|\/)(apps?\/web|web|frontend|client|components?|styles?)(\/|$)/u.test(normalized) ||
    /\.(css|scss|sass|less|tsx|jsx|vue|svelte)$/u.test(basename)
  ) {
    return "ui";
  }
  if (
    /(^|\/)(apps?\/server|server|backend|api|routes?|controllers?|services?)(\/|$)/u.test(
      normalized,
    )
  ) {
    return "server";
  }
  return "core";
}

export function groupPullRequestReviewFiles<
  A extends { readonly path: string; readonly additions: number; readonly deletions: number },
>(files: ReadonlyArray<A>): ReadonlyArray<PullRequestReviewFileGroup<A>> {
  const byType = new Map<PullRequestReviewFileType, A[]>();
  for (const file of files) {
    const type = pullRequestReviewFileType(file.path);
    const group = byType.get(type);
    if (group) group.push(file);
    else byType.set(type, [file]);
  }
  return GROUPS.flatMap(({ type, label }) => {
    const entries = byType.get(type);
    if (!entries?.length) return [];
    return [
      {
        type,
        label,
        files: entries,
        additions: entries.reduce((total, file) => total + file.additions, 0),
        deletions: entries.reduce((total, file) => total + file.deletions, 0),
      },
    ];
  });
}
