import type { FileOptions } from "@pierre/diffs/react";
import { File, Virtualizer } from "@pierre/diffs/react";
import { LoaderCircleIcon } from "lucide-react";
import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import type { EnvironmentId } from "@t3tools/contracts";

import { useClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";

import { projectFileCacheKey } from "../files/fileContentRevision";
import { useProjectFileQuery } from "../files/projectFilesQueryState";

const REVIEW_LINE_ATTRIBUTE = "data-pr-review-line";
const REVIEW_FILE_CSS = `
  [${REVIEW_LINE_ATTRIBUTE}][data-line],
  [${REVIEW_LINE_ATTRIBUTE}][data-column-number] {
    background: color-mix(in srgb, var(--color-primary) 16%, transparent) !important;
  }
`;
type FilePostRender = NonNullable<FileOptions<unknown>["onPostRender"]>;

function updateReveal(container: HTMLElement, line: number): void {
  const root = container.shadowRoot ?? container;
  for (const element of root.querySelectorAll<HTMLElement>(`[${REVIEW_LINE_ATTRIBUTE}]`)) {
    element.removeAttribute(REVIEW_LINE_ATTRIBUTE);
  }
  const code = root.querySelector<HTMLElement>(`[data-line="${line}"]`);
  const number = root.querySelector<HTMLElement>(`[data-column-number="${line}"]`);
  code?.setAttribute(REVIEW_LINE_ATTRIBUTE, "");
  number?.setAttribute(REVIEW_LINE_ATTRIBUTE, "");
  code?.scrollIntoView({ block: "center" });
}

export function PullRequestFullFileView({
  environmentId,
  cwd,
  path,
  revealLine,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly path: string;
  readonly revealLine: number | null;
}) {
  const { resolvedTheme } = useTheme();
  const wordWrap = useClientSettings((settings) => settings.wordWrap);
  const file = useProjectFileQuery(environmentId, cwd, path);
  const [cursorLine, setCursorLine] = useState(revealLine ?? 1);

  useEffect(() => setCursorLine(revealLine ?? 1), [path, revealLine]);

  const onPostRender = useCallback<FilePostRender>(
    (container, _instance, phase) => {
      if (phase === "unmount") return;
      requestAnimationFrame(() => {
        if (container.isConnected) updateReveal(container, cursorLine);
      });
    },
    [cursorLine],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    setCursorLine((line) => Math.max(1, line + (event.key === "ArrowDown" ? 1 : -1)));
  };

  if (file.error && file.data === null) {
    return (
      <p className="flex h-full items-center justify-center px-6 text-center text-sm text-destructive">
        {file.error}
      </p>
    );
  }
  if (file.data === null) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <LoaderCircleIcon className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {file.data.truncated ? (
        <p className="shrink-0 border-b border-border/60 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
          This file is too large to load completely. The available prefix is shown.
        </p>
      ) : null}
      <Virtualizer
        key={`${path}:${resolvedTheme}:${file.data.byteLength}`}
        className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]"
        config={{ overscrollSize: 600, intersectionObserverMargin: 1200 }}
      >
        <File
          file={{
            name: path,
            contents: file.data.contents,
            cacheKey: projectFileCacheKey(cwd, path, file.data.contents),
          }}
          options={{
            disableFileHeader: true,
            overflow: wordWrap ? "wrap" : "scroll",
            theme: resolveDiffThemeName(resolvedTheme),
            themeType: resolvedTheme,
            unsafeCSS: REVIEW_FILE_CSS,
            onPostRender,
          }}
          className="min-h-full"
        />
      </Virtualizer>
      <p className="shrink-0 border-t border-border/60 px-3 py-1 text-[10px] text-muted-foreground">
        Line {cursorLine}. Use ↑ and ↓ to move.
      </p>
    </div>
  );
}
