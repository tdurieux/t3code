import { describe, expect, it } from "vite-plus/test";

import {
  groupPullRequestReviewFiles,
  pullRequestReviewFileType,
} from "./pullRequestReviewLayout.logic";

describe("pullRequestReviewFileType", () => {
  it("separates code, tests, docs, config, and generated files", () => {
    expect(pullRequestReviewFileType("src/app.tsx")).toBe("code");
    expect(pullRequestReviewFileType("src/app.test.tsx")).toBe("tests");
    expect(pullRequestReviewFileType("docs/review.md")).toBe("docs");
    expect(pullRequestReviewFileType(".github/workflows/ci.yml")).toBe("config");
    expect(pullRequestReviewFileType("pnpm-lock.yaml")).toBe("generated");
  });
});

describe("groupPullRequestReviewFiles", () => {
  it("keeps the review reading order inside stable type groups", () => {
    const groups = groupPullRequestReviewFiles([
      { path: "src/app.ts" },
      { path: "src/app.test.ts" },
      { path: "README.md" },
      { path: "package.json" },
      { path: "pnpm-lock.yaml" },
      { path: "src/lib.ts" },
    ]);

    expect(groups.map((group) => group.label)).toEqual([
      "Code",
      "Tests",
      "Docs",
      "Config",
      "Generated",
    ]);
    expect(groups[0]?.files.map((file) => file.path)).toEqual(["src/app.ts", "src/lib.ts"]);
  });
});
