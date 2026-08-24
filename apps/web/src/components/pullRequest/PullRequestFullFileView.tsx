import type {
  CodeViewFileItem,
  LineAnnotation,
  PostRenderPhase,
  SelectedLineRange,
} from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import type { EnvironmentId } from "@t3tools/contracts";
import { LoaderCircleIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { DiffCommentAnnotation } from "~/components/diffs/DiffCommentAnnotation";
import { StyledDiffCodeView } from "~/components/diffs/StyledDiffCodeView";
import {
  isCodeNavigationGesture,
  isCodeNavigationIdentifier,
} from "~/components/files/codePointerNavigation";
import { nextFileCommentId } from "~/components/files/fileCommentAnnotations";
import { useClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { fnv1a32, resolveDiffThemeName } from "~/lib/diffRendering";
import { buildFileReviewComment, type ReviewCommentContext } from "~/reviewCommentContext";

import { projectFileCacheKey } from "../files/fileContentRevision";
import { useProjectFileQuery } from "../files/projectFilesQueryState";
import {
  pullRequestIdentifier,
  type PullRequestSemanticTarget,
} from "./pullRequestSemanticIndex.logic";

const REVIEW_LINE_ATTRIBUTE = "data-pr-review-line";
const REVIEW_FILE_CSS = `
  [${REVIEW_LINE_ATTRIBUTE}][data-line],
  [${REVIEW_LINE_ATTRIBUTE}][data-column-number] {
    background: color-mix(in srgb, var(--color-primary) 16%, transparent) !important;
  }
`;
interface FullFileAnnotationGroup {
  readonly draft: true;
}

type FullFileAnnotation = LineAnnotation<FullFileAnnotationGroup>;

export interface PullRequestFullFileSelectionInput {
  readonly comment: ReviewCommentContext;
  readonly request: string;
}

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
  canAddReviewComment,
  onAddReviewComment,
  onAskAgentSelection,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly path: string;
  readonly revealLine: number | null;
  readonly onOpenSymbol?: (target: PullRequestSemanticTarget) => void;
  readonly canAddReviewComment?: (line: number) => boolean;
  readonly onAddReviewComment?: (input: { readonly line: number; readonly body: string }) => void;
  readonly onAskAgentSelection?: (input: PullRequestFullFileSelectionInput) => void;
}) {
  const { resolvedTheme } = useTheme();
  const wordWrap = useClientSettings((settings) => settings.wordWrap);
  const file = useProjectFileQuery(environmentId, cwd, path);
  const viewerRef = useRef<CodeViewHandle<FullFileAnnotationGroup>>(null);
  const [cursorLine, setCursorLine] = useState(revealLine ?? 1);
  const [hovered, setHovered] = useState<PullRequestSemanticTarget | null>(null);
  const [selectedLines, setSelectedLines] = useState<{
    readonly id: string;
    readonly range: SelectedLineRange;
  } | null>(null);
  const [draft, setDraft] = useState<{
    readonly id: string;
    readonly range: SelectedLineRange;
  } | null>(null);
  const contents = file.data?.contents ?? "";
  const fileKey = `review-full-file:${path}`;

  useEffect(() => {
    setCursorLine(revealLine ?? 1);
    setSelectedLines(null);
    setDraft(null);
  }, [path, revealLine]);

  const onPostRender = useCallback(
    (container: HTMLElement, _instance: unknown, phase: PostRenderPhase) => {
      if (phase === "unmount") return;
      requestAnimationFrame(() => {
        if (container.isConnected) updateReveal(container, cursorLine);
      });
    },
    [cursorLine],
  );

  const beginComment = useCallback(
    (range: SelectedLineRange | null) => {
      if (!range) return;
      const canReview = canAddReviewComment?.(range.end) === true;
      if (!canReview && !onAskAgentSelection) return;
      setCursorLine(range.end);
      setDraft({ id: nextFileCommentId(), range });
      setSelectedLines(null);
    },
    [canAddReviewComment, onAskAgentSelection],
  );

  const clearDraft = useCallback(() => {
    setDraft(null);
    setSelectedLines(null);
  }, []);

  const askAgent = useCallback(
    (text: string) => {
      if (!draft || !onAskAgentSelection) return;
      onAskAgentSelection({
        request: text,
        comment: buildFileReviewComment({
          id: draft.id,
          filePath: path,
          startLine: draft.range.start,
          endLine: draft.range.end,
          text,
          contents,
        }),
      });
      clearDraft();
    },
    [clearDraft, contents, draft, onAskAgentSelection, path],
  );

  const canReviewDraft = draft ? canAddReviewComment?.(draft.range.end) === true : false;
  const annotations = useMemo<FullFileAnnotation[]>(
    () => (draft ? [{ lineNumber: draft.range.end, metadata: { draft: true } }] : []),
    [draft],
  );
  const items = useMemo<CodeViewFileItem<FullFileAnnotationGroup>[]>(
    () => [
      {
        id: fileKey,
        type: "file",
        file: {
          name: path,
          contents,
          cacheKey: projectFileCacheKey(cwd, path, contents),
        },
        annotations,
        collapsed: false,
        version: fnv1a32(`${fileKey}:${draft?.id ?? ""}:${draft?.range.end ?? ""}`),
      },
    ],
    [annotations, contents, cwd, draft?.id, draft?.range.end, fileKey, path],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const line = Math.max(1, cursorLine + (event.key === "ArrowDown" ? 1 : -1));
    setCursorLine(line);
    viewerRef.current?.scrollTo({
      type: "line",
      id: fileKey,
      lineNumber: line,
      align: "center",
    });
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
    >
      {file.data.truncated ? (
        <p className="shrink-0 border-b border-border/60 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
          This file is too large to load completely. The available prefix is shown.
        </p>
      ) : null}
      <StyledDiffCodeView<FullFileAnnotationGroup>
        viewerRef={viewerRef}
        className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]"
        items={items}
        selectedLines={selectedLines}
        onSelectedLinesChange={setSelectedLines}
        unsafeCSSExtra={REVIEW_FILE_CSS}
        options={{
          disableFileHeader: true,
          overflow: wordWrap ? "wrap" : "scroll",
          theme: resolveDiffThemeName(resolvedTheme),
          themeType: resolvedTheme,
          enableGutterUtility: draft === null,
          enableLineSelection: draft === null,
          onGutterUtilityClick: beginComment,
          onLineSelectionEnd: beginComment,
          onPostRender,
          onLineClick: (line) => setCursorLine(line.lineNumber),
          onTokenEnter: (token) => {
            const symbol = pullRequestIdentifier(token.tokenText.trim());
            setHovered(
              symbol
                ? {
                    path,
                    line: token.lineNumber,
                    column: token.lineCharStart + 1,
                    symbol,
                  }
                : null,
            );
          },
          onTokenLeave: () => setHovered(null),
          onTokenClick: (token, event) => {
            if (!onOpenSymbol || !isCodeNavigationGesture(event)) return;
            const symbol = token.tokenText.trim();
            if (!isCodeNavigationIdentifier(symbol)) return;
            event.preventDefault();
            event.stopPropagation();
            setCursorLine(token.lineNumber);
            onOpenSymbol({
              path,
              line: token.lineNumber,
              column: token.lineCharStart + 1,
              symbol,
            });
          },
        }}
        renderHeaderPrefix={() => null}
        renderAnnotation={() =>
          draft ? (
            <div className="py-1 font-sans text-foreground">
              <DiffCommentAnnotation
                kind="draft"
                rangeLabel={`${path}:${draft.range.end}`}
                text=""
                placeholder={canReviewDraft ? "Add a review comment…" : "Ask about these lines…"}
                submitLabel={canReviewDraft ? "Add to review" : "Ask agent"}
                {...(canReviewDraft && onAskAgentSelection
                  ? {
                      secondaryAction: {
                        label: "Add to agent",
                        onAction: askAgent,
                      },
                    }
                  : {})}
                onCancel={clearDraft}
                onComment={(body) => {
                  if (canReviewDraft && onAddReviewComment) {
                    onAddReviewComment({ line: draft.range.end, body });
                    clearDraft();
                    return;
                  }
                  askAgent(body);
                }}
              />
            </div>
          ) : null
        }
      />
      <p className="shrink-0 border-t border-border/60 px-3 py-1 text-[10px] text-muted-foreground">
        Line {cursorLine}. Use ↑ and ↓ to move. Cmd/Ctrl-click a symbol to navigate.
      </p>
      {hovered ? (
        <div className="pointer-events-none absolute right-3 top-3 z-10 max-w-64 rounded-md border border-border/60 bg-popover/95 px-2.5 py-2 shadow-lg backdrop-blur">
          <p className="truncate font-mono text-xs font-medium">{hovered.symbol}</p>
          <p className="mt-0.5 text-[9px] text-muted-foreground">
            Cmd/Ctrl-click for definitions, references, callers, callees, and usages.
          </p>
        </div>
      ) : null}
    </div>
  );
}
