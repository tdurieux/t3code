export interface ReviewFilePathLabel {
  readonly name: string;
  readonly parent: string;
}

export interface ReviewFileFolder<T extends { readonly path: string }> {
  readonly parent: string;
  readonly label: string;
  readonly files: ReadonlyArray<T>;
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

export function reviewFoldedFolderLabel(parent: string, visibleSegments = 3): string {
  if (!parent) return "";
  const segments = parent.split("/").filter(Boolean);
  const visible = segments.slice(-Math.max(1, visibleSegments)).join("/");
  return `${segments.length > visibleSegments ? "…/" : ""}${visible}/`;
}

export function groupReviewFilesByFolder<T extends { readonly path: string }>(
  files: ReadonlyArray<T>,
): ReadonlyArray<ReviewFileFolder<T>> {
  const folders = new Map<string, T[]>();
  for (const file of files) {
    const { parent } = reviewFilePathLabel(file.path);
    const folderFiles = folders.get(parent);
    if (folderFiles) folderFiles.push(file);
    else folders.set(parent, [file]);
  }
  return [...folders].map(([parent, folderFiles]) => ({
    parent,
    label: reviewFoldedFolderLabel(parent),
    files: folderFiles,
  }));
}
