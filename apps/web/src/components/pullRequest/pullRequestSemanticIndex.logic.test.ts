import { describe, expect, it } from "vite-plus/test";

import {
  buildPullRequestSemanticRelations,
  pullRequestIdentifier,
  pullRequestSemanticCallees,
} from "./pullRequestSemanticIndex.logic";

describe("pull request semantic index", () => {
  it("extracts identifiers and conservative callees", () => {
    expect(pullRequestIdentifier(" renderItem ")).toBe("renderItem");
    expect(
      pullRequestSemanticCallees({
        contents: "function render() {\n  load();\n  if (ready()) save();\n}",
        line: 1,
        symbol: "render",
      }),
    ).toEqual(["load", "ready", "save"]);
  });

  it("classifies declarations, references, callers, and usages", () => {
    const matches = [
      {
        path: "src/a.ts",
        lineNumber: 1,
        lineContent: "export function render() {}",
        matchRanges: [{ start: 16, end: 22 }],
      },
      {
        path: "src/b.ts",
        lineNumber: 4,
        lineContent: "render();",
        matchRanges: [{ start: 0, end: 6 }],
      },
      {
        path: "src/c.ts",
        lineNumber: 7,
        lineContent: "const value = render;",
        matchRanges: [{ start: 14, end: 20 }],
      },
    ];
    expect(
      buildPullRequestSemanticRelations({ symbol: "render", matches, currentLine: 1 }).definitions,
    ).toHaveLength(1);
    expect(
      buildPullRequestSemanticRelations({ symbol: "render", matches, currentLine: 1 }),
    ).toMatchObject({ references: { length: 2 }, callers: { length: 1 }, usages: { length: 3 } });
  });
});
