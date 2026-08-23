import { describe, expect, it } from "vite-plus/test";

import {
  groupReviewFilesByFolder,
  reviewFilePathLabel,
  reviewFoldedFolderLabel,
} from "./reviewFilePath";

describe("reviewFilePathLabel", () => {
  it("separates the basename from its parent path", () => {
    expect(reviewFilePathLabel("src/golang/internal/endor/findings.go")).toEqual({
      name: "findings.go",
      parent: "src/golang/internal/endor",
    });
  });

  it("normalizes Windows and leading relative separators", () => {
    expect(reviewFilePathLabel("./apps\\web\\src\\main.tsx")).toEqual({
      name: "main.tsx",
      parent: "apps/web/src",
    });
  });

  it("keeps root files readable", () => {
    expect(reviewFilePathLabel("README.md")).toEqual({ name: "README.md", parent: "" });
  });
});

describe("reviewFoldedFolderLabel", () => {
  it("keeps short paths and folds long shared prefixes", () => {
    expect(reviewFoldedFolderLabel("src/components")).toBe("src/components/");
    expect(reviewFoldedFolderLabel("apps/web/src/components/review")).toBe(
      "…/src/components/review/",
    );
  });
});

describe("groupReviewFilesByFolder", () => {
  it("prints a shared parent once while preserving file order", () => {
    const files = [
      { path: "apps/web/src/types.ts" },
      { path: "apps/web/src/index.ts" },
      { path: "README.md" },
      { path: "apps/server/src/index.ts" },
    ];

    expect(groupReviewFilesByFolder(files)).toEqual([
      {
        parent: "apps/web/src",
        label: "apps/web/src/",
        files: [files[0], files[1]],
      },
      { parent: "", label: "", files: [files[2]] },
      {
        parent: "apps/server/src",
        label: "apps/server/src/",
        files: [files[3]],
      },
    ]);
  });
});
