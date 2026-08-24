import { describe, expect, it } from "vite-plus/test";

import {
  groupPullRequestReviewFiles,
  pullRequestReviewFileType,
} from "./pullRequestReviewLayout.logic";

describe("pullRequestReviewFileType", () => {
  it("uses the review workspace categories", () => {
    expect(pullRequestReviewFileType("src/app.tsx")).toBe("ui");
    expect(pullRequestReviewFileType("apps/server/src/api.ts")).toBe("server");
    expect(pullRequestReviewFileType("proto/review.proto")).toBe("proto");
    expect(pullRequestReviewFileType("src/app.test.tsx")).toBe("tests");
    expect(pullRequestReviewFileType("docs/review.md")).toBe("docs");
    expect(pullRequestReviewFileType(".github/workflows/ci.yml")).toBe("config");
    expect(pullRequestReviewFileType("pnpm-lock.yaml")).toBe("build");
    expect(pullRequestReviewFileType("src/api.generated.ts")).toBe("generated");
    expect(pullRequestReviewFileType("src/lib.rs")).toBe("core");
  });
});

describe("groupPullRequestReviewFiles", () => {
  it("keeps the review reading order inside stable type groups", () => {
    const groups = groupPullRequestReviewFiles([
      { path: "src/lib.rs", additions: 4, deletions: 1 },
      { path: "src/app.tsx", additions: 3, deletions: 0 },
      { path: "src/app.test.ts", additions: 2, deletions: 1 },
      { path: "README.md", additions: 1, deletions: 0 },
      { path: "package.json", additions: 5, deletions: 2 },
      { path: "src/core.rs", additions: 6, deletions: 3 },
    ]);

    expect(groups.map((group) => group.label)).toEqual([
      "Core code",
      "UI",
      "Tests",
      "Documentation",
      "Build & packages",
    ]);
    expect(groups[0]).toMatchObject({ additions: 10, deletions: 4 });
    expect(groups[0]?.files.map((file) => file.path)).toEqual(["src/lib.rs", "src/core.rs"]);
  });
});
