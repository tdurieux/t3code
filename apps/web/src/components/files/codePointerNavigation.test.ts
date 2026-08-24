import { describe, expect, it } from "vite-plus/test";

import { isCodeNavigationGesture, isCodeNavigationIdentifier } from "./codePointerNavigation";

describe("codePointerNavigation", () => {
  it("accepts Cmd and Ctrl without treating a plain click as navigation", () => {
    expect(isCodeNavigationGesture({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(isCodeNavigationGesture({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(isCodeNavigationGesture({ metaKey: false, ctrlKey: false })).toBe(false);
  });

  it("accepts identifiers and rejects punctuation or whitespace", () => {
    expect(isCodeNavigationIdentifier("$value_2")).toBe(true);
    expect(isCodeNavigationIdentifier("foo.bar")).toBe(false);
    expect(isCodeNavigationIdentifier(" ")).toBe(false);
  });
});
