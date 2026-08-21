import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import {
  compareReviewCodeowners,
  loadReviewCodeowners,
  parseReviewCodeowners,
  reviewCodeownersOwnership,
} from "./reviewCodeowners.ts";

it("classifies exact ownership drift without inferring unowned paths", () => {
  const base = parseReviewCodeowners(
    ["/src/ @platform", "/src/legacy/ @legacy", "/docs/ @docs"].join("\n"),
    "CODEOWNERS",
  );
  const worktree = parseReviewCodeowners(
    [
      "# shifted comment",
      "/src/ @platform",
      "/src/legacy/ @platform",
      "/new/ @new",
      "/docs/ @docs",
    ].join("\n"),
    "CODEOWNERS",
  );

  assert.deepStrictEqual(
    compareReviewCodeowners({
      paths: ["src/index.ts", "src/legacy/old.ts", "new/index.ts", "docs/readme.md", "unowned.txt"],
      base,
      worktree,
    }),
    {
      checkedPathCount: 5,
      entries: [
        {
          path: "new/index.ts",
          kind: "ownership-added",
          baseOwnership: null,
          worktreeOwnership: {
            sourcePath: "CODEOWNERS",
            sourceLine: 4,
            pattern: "/new/",
            owners: ["@new"],
          },
        },
        {
          path: "src/legacy/old.ts",
          kind: "owners-changed",
          baseOwnership: {
            sourcePath: "CODEOWNERS",
            sourceLine: 2,
            pattern: "/src/legacy/",
            owners: ["@legacy"],
          },
          worktreeOwnership: {
            sourcePath: "CODEOWNERS",
            sourceLine: 3,
            pattern: "/src/legacy/",
            owners: ["@platform"],
          },
        },
      ],
      truncated: false,
    },
  );
});

it("applies GitHub-style patterns in order and keeps the last matching rule", () => {
  const parsed = parseReviewCodeowners(
    [
      "* @global-owner",
      "*.ts @typescript",
      "/apps/ @app-team @platform",
      "/apps/web/ @web-team # inline comment",
      "docs/* @docs-direct",
      "docs/** @docs-all",
      "!ignored @invalid-negation",
      "[ab].ts @invalid-range",
      "no-owner-pattern",
    ].join("\n"),
    ".github/CODEOWNERS",
  );

  assert.strictEqual(parsed.metadata.ruleCount, 6);
  assert.deepStrictEqual(reviewCodeownersOwnership("src/index.ts", parsed)?.owners, [
    "@typescript",
  ]);
  assert.deepStrictEqual(reviewCodeownersOwnership("apps/server/src/index.ts", parsed)?.owners, [
    "@app-team",
    "@platform",
  ]);
  assert.deepStrictEqual(reviewCodeownersOwnership("apps/web/src/index.ts", parsed)?.owners, [
    "@web-team",
  ]);
  assert.deepStrictEqual(reviewCodeownersOwnership("docs/guides/setup.md", parsed)?.owners, [
    "@docs-all",
  ]);
  assert.deepStrictEqual(reviewCodeownersOwnership("README.md", parsed)?.owners, ["@global-owner"]);
});

it.layer(NodeServices.layer)("reviewCodeowners", (it) => {
  it.effect("uses GitHub precedence and rejects a CODEOWNERS symlink outside the worktree", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-codeowners-" });
      const outside = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-codeowners-outside-",
      });
      yield* fileSystem.makeDirectory(`${cwd}/.github`);
      yield* fileSystem.makeDirectory(`${cwd}/docs`);
      yield* fileSystem.writeFileString(`${outside}/CODEOWNERS`, "* @outside\n");
      yield* fileSystem.symlink(`${outside}/CODEOWNERS`, `${cwd}/.github/CODEOWNERS`);
      yield* fileSystem.writeFileString(`${cwd}/CODEOWNERS`, "*.ts @root-owner\n");
      yield* fileSystem.writeFileString(`${cwd}/docs/CODEOWNERS`, "* @docs-owner\n");

      const loaded = yield* loadReviewCodeowners(cwd);

      assert.strictEqual(loaded?.metadata.sourcePath, "CODEOWNERS");
      assert.deepStrictEqual(reviewCodeownersOwnership("src/index.ts", loaded)?.owners, [
        "@root-owner",
      ]);
    }),
  );
});
