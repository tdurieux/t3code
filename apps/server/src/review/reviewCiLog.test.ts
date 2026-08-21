import { assert, describe, it } from "@effect/vitest";

import { githubActionsLogArgs, parseGitHubActionsLogTarget } from "./reviewCiLog.ts";

describe("review CI logs", () => {
  it("parses a GitHub Actions run and optional job", () => {
    assert.deepStrictEqual(
      parseGitHubActionsLogTarget("https://github.com/t3tools/t3code/actions/runs/123/job/456"),
      { repository: "github.com/t3tools/t3code", runId: "123", jobId: "456" },
    );
    assert.deepStrictEqual(
      githubActionsLogArgs({ repository: "github.com/t3tools/t3code", runId: "123", jobId: "456" }),
      ["run", "view", "123", "--repo", "github.com/t3tools/t3code", "--job", "456", "--log"],
    );
  });

  it("rejects arbitrary and non-HTTPS check URLs", () => {
    assert.strictEqual(parseGitHubActionsLogTarget("https://example.com/build/123"), null);
    assert.strictEqual(
      parseGitHubActionsLogTarget("http://github.com/t3tools/t3code/actions/runs/123"),
      null,
    );
  });
});
