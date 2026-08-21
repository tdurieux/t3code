import type { FileOptions } from "@pierre/diffs/react";
import { File, Virtualizer } from "@pierre/diffs/react";
import { LoaderCircleIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import type { EnvironmentId } from "@t3tools/contracts";

import { useClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import {
  pullRequestIdentifier,
  type PullRequestSemanticTarget,
} from "./pullRequestSemanticIndex.logic";

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
  onOpenSymbol,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly path: string;
  readonly revealLine: number | null;
  readonly onOpenSymbol?: (target: PullRequestSemanticTarget) => void;
}) {
  const { resolvedTheme } = useTheme();
  const wordWrap = useClientSettings((settings) => settings.wordWrap);
  const file = useProjectFileQuery(environmentId, cwd, path);
  const [cursorLine, setCursorLine] = useState(revealLine ?? 1);
  const [hovered, setHovered] = useState<PullRequestSemanticTarget | null>(null);
  const sourceLines = useMemo(() => file.data?.contents.split("\n") ?? [], [file.data?.contents]);

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

  const semanticTarget = (event: MouseEvent | PointerEvent): PullRequestSemanticTarget | null => {
    const nodes = event.nativeEvent.composedPath?.() ?? [];
    const lineElement = nodes.find(
      (node): node is HTMLElement => node instanceof HTMLElement && node.hasAttribute("data-line"),
    );
    const tokenElement = nodes.find(
      (node): node is HTMLElement =>
        node instanceof HTMLElement &&
        node !== lineElement &&
        node.children.length === 0 &&
        pullRequestIdentifier(node.textContent ?? "") !== null,
    );
    const line = Number(lineElement?.getAttribute("data-line"));
    const token = tokenElement?.textContent?.trim() ?? "";
    const symbol = pullRequestIdentifier(token);
    if (!Number.isSafeInteger(line) || line < 1 || !symbol || symbol !== token) return null;
    const lineText = sourceLines[line - 1] ?? "";
    return { path, line, column: Math.max(1, lineText.indexOf(symbol) + 1), symbol };
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
      className="relative flex h-full min-h-0 flex-col outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerOverCapture={(event) => {
        const target = semanticTarget(event);
        setHovered((current) =>
          current?.path === target?.path &&
          current?.line === target?.line &&
          current?.column === target?.column &&
          current?.symbol === target?.symbol
            ? current
            : target,
        );
      }}
      onPointerLeave={() => setHovered(null)}
      onClickCapture={(event) => {
        const target = semanticTarget(event);
        if (!target || !onOpenSymbol) return;
        setCursorLine(target.line);
        onOpenSymbol(target);
      }}
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
      {hovered ? (
        <div className="pointer-events-none absolute right-3 top-3 z-10 max-w-64 rounded-md border border-border/60 bg-popover/95 px-2.5 py-2 shadow-lg backdrop-blur">
          <p className="truncate font-mono text-xs font-medium">{hovered.symbol}</p>
          <p className="mt-0.5 text-[9px] text-muted-foreground">
            Click for definitions, references, callers, callees, and usages.
          </p>
        </div>
      ) : null}
    </div>
  );
}
