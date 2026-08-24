export interface ReviewFilePathLabel {
  readonly name: string;
  readonly parent: string;
}

export function reviewFilePathLabel(path: string): ReviewFilePathLabel {
  const normalized = path
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  const name = segments.pop() ?? path;
  return {
    name,
    parent: segments.join("/"),
  };
}
