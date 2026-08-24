import { describe, expect, it } from "vite-plus/test";

import { reviewFilePathLabel } from "./reviewFilePath";

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
