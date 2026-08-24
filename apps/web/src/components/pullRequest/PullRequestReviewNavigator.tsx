import { useFileTree, useFileTreeSearch } from "@pierre/trees/react";
import type { EnvironmentId, ProjectContentMatch } from "@t3tools/contracts";
import {
  BracesIcon,
  CheckCircle2Icon,
  CircleIcon,
  FileCode2Icon,
  TextSearchIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import type { ResizableWidthHandlers } from "~/hooks/useResizableWidth";
import { useProjectContentSearch, useProjectPathSearch } from "~/state/queries";
import { reviewFilePathLabel } from "~/reviewFilePath";
import { T3_PIERRE_ICONS } from "~/pierre-icons";

import { useProjectFileQuery } from "../files/projectFilesQueryState";
import {
  WorkspaceFileTree,
  WORKSPACE_FILE_TREE_UNSAFE_CSS,
  WorkspaceFileTreeSearchField,
} from "../files/WorkspaceFileTree";
import { ReviewColumnResizeHandle } from "../review/ReviewColumnResizeHandle";
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
} from "../ui/command";
import { Kbd } from "../ui/kbd";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  parsePullRequestReviewQuickOpenQuery,
  pullRequestReviewDeclarationQuery,
  selectPullRequestReviewDeclarations,
  selectPullRequestReviewFiles,
} from "./pullRequestReviewQuickOpen.logic";
import { groupPullRequestReviewFiles } from "./pullRequestReviewLayout.logic";

export interface PullRequestReviewFileEntry {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly reviewed?: boolean;
  readonly visitedHunks?: number;
  readonly totalHunks?: number;
}

function useCopyReviewPath() {
  return useCopyToClipboard<string>({
    target: "relative file path",
    onCopy: (path) =>
      toastManager.add({ type: "success", title: "Relative path copied", description: path }),
    onError: () => toastManager.add({ type: "error", title: "Could not copy the file path" }),
  }).copyToClipboard;
}

export function PullRequestReviewFileSidebar({
  files,
  selectedPath,
  onSelect,
  onOpenQuickOpen,
  onSetReviewed,
  width,
  resizeHandlers,
}: {
  readonly files: ReadonlyArray<PullRequestReviewFileEntry>;
  readonly selectedPath: string | null;
  readonly onSelect: (path: string) => void;
  readonly onOpenQuickOpen: () => void;
  readonly onSetReviewed?: (path: string, reviewed: boolean) => void;
  readonly width: number;
  readonly resizeHandlers: ResizableWidthHandlers;
}) {
  const copyPath = useCopyReviewPath();
  const groups = useMemo(() => groupPullRequestReviewFiles(files), [files]);
  const treeFiles = useMemo(
    () =>
      groups.flatMap((group) =>
        group.files.map((file) => ({
          file,
          treePath: `${group.label}/${file.path.replace(/^\.\/+/, "").replaceAll("\\", "/")}`,
        })),
      ),
    [groups],
  );
  const treePaths = useMemo(() => treeFiles.map((entry) => entry.treePath), [treeFiles]);
  const fileByTreePath = useMemo(
    () => new Map(treeFiles.map((entry) => [entry.treePath, entry.file] as const)),
    [treeFiles],
  );
  const treePathByFilePath = useMemo(
    () => new Map(treeFiles.map((entry) => [entry.file.path, entry.treePath] as const)),
    [treeFiles],
  );
  const groupSummaryByTreePath = useMemo(
    () =>
      new Map(
        groups.map(
          (group) =>
            [
              group.label,
              {
                count: group.files.length,
                reviewed: group.files.filter((file) => file.reviewed).length,
              },
            ] as const,
        ),
      ),
    [groups],
  );
  const totals = useMemo(
    () =>
      files.reduce(
        (total, file) => ({
          additions: total.additions + file.additions,
          deletions: total.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [files],
  );
  const selectedFile = selectedPath ? files.find((file) => file.path === selectedPath) : undefined;
  const fileByTreePathRef = useRef(fileByTreePath);
  const groupSummaryByTreePathRef = useRef(groupSummaryByTreePath);
  const onSelectRef = useRef(onSelect);
  const copyPathRef = useRef(copyPath);
  const syncingSelectionRef = useRef(false);
  const previousTreePathsRef = useRef<readonly string[]>([]);
  fileByTreePathRef.current = fileByTreePath;
  groupSummaryByTreePathRef.current = groupSummaryByTreePath;
  onSelectRef.current = onSelect;
  copyPathRef.current = copyPath;

  const { model } = useFileTree({
    composition: {
      contextMenu: {
        triggerMode: "right-click",
        onOpen: (item, context) => {
          const file = fileByTreePathRef.current.get(item.path.replace(/\/$/, ""));
          if (file) copyPathRef.current(file.path, file.path);
          context.close();
        },
      },
    },
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    // Keep the review categories as distinct roots instead of folding them
    // into the first repository directory.
    flattenEmptyDirectories: false,
    initialExpansion: 2,
    icons: T3_PIERRE_ICONS,
    onSelectionChange: (selectedPaths) => {
      if (syncingSelectionRef.current) return;
      const treePath = selectedPaths.at(-1)?.replace(/\/$/, "");
      const file = treePath ? fileByTreePathRef.current.get(treePath) : undefined;
      if (file) onSelectRef.current(file.path);
    },
    paths: [],
    renderRowDecoration: ({ item }) => {
      const normalizedPath = item.path.replace(/\/$/, "");
      const file = fileByTreePathRef.current.get(normalizedPath);
      if (file) {
        const progress = file.reviewed
          ? "✓"
          : file.totalHunks
            ? `${file.visitedHunks ?? 0}/${file.totalHunks}`
            : null;
        const diff = `+${file.additions} −${file.deletions}`;
        return {
          text: progress ? `${progress}  ${diff}` : diff,
          title: `${file.path} · ${progress ? `review ${progress} · ` : ""}${diff}`,
        };
      }
      const summary = groupSummaryByTreePathRef.current.get(normalizedPath);
      if (!summary) return null;
      return {
        text: summary.reviewed === summary.count ? `✓ ${summary.count}` : `${summary.count}`,
        title: `${summary.reviewed} of ${summary.count} files reviewed`,
      };
    },
    search: false,
    unsafeCSS: WORKSPACE_FILE_TREE_UNSAFE_CSS,
  });
  const search = useFileTreeSearch(model);
  const handleSearchValueChange = (value: string) => {
    if (value.trim().length === 0) {
      search.close();
      return;
    }
    search.setValue(value);
  };

  useEffect(() => {
    if (previousTreePathsRef.current === treePaths) return;
    previousTreePathsRef.current = treePaths;
    model.resetPaths(treePaths, {
      initialExpandedPaths: groups.map((group) => group.label),
    });
  }, [groups, model, treePaths]);

  useEffect(() => {
    if (!selectedPath) return;
    const treePath = treePathByFilePath.get(selectedPath);
    if (!treePath || !model.getItem(treePath)) return;
    if (model.getSelectedPaths().some((path) => path.replace(/\/$/, "") === treePath)) return;

    syncingSelectionRef.current = true;
    for (const path of model.getSelectedPaths()) model.getItem(path)?.deselect();
    const segments = treePath.split("/");
    let ancestorPath = "";
    for (const segment of segments.slice(0, -1)) {
      ancestorPath = ancestorPath ? `${ancestorPath}/${segment}` : segment;
      const item = model.getItem(`${ancestorPath}/`) ?? model.getItem(ancestorPath);
      if (item && "expand" in item) item.expand();
    }
    model.getItem(treePath)?.select();
    model.scrollToPath(treePath, { focus: true, offset: "nearest" });
    queueMicrotask(() => {
      syncingSelectionRef.current = false;
    });
  }, [model, selectedPath, treePathByFilePath, treePaths]);

  return (
    <aside
      className="relative hidden shrink-0 flex-col border-r border-border/65 bg-card/20 md:flex"
      style={{ width: `${width}px` }}
      aria-label="Changed files"
    >
      <ReviewColumnResizeHandle edge="right" handlers={resizeHandlers} />
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/60 px-2">
        <div className="flex min-w-0 flex-1 items-center">
          <WorkspaceFileTreeSearchField
            name="pull-request-changed-files-search"
            ariaLabel="Search changed files"
            placeholder="Search changed files"
            value={search.value}
            onValueChange={handleSearchValueChange}
            onClose={search.close}
          />
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="shrink-0 rounded px-1 py-0.5 text-[9px] text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={onOpenQuickOpen}
                />
              }
            >
              <Kbd>⌘K</Kbd>
            </TooltipTrigger>
            <TooltipPopup>Open files and symbols</TooltipPopup>
          </Tooltip>
        </div>
        {onSetReviewed ? (
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
            aria-label={
              selectedFile?.reviewed
                ? `Mark ${selectedFile.path} unreviewed`
                : selectedFile
                  ? `Mark ${selectedFile.path} reviewed`
                  : "Select a file to update review progress"
            }
            disabled={!selectedFile}
            onClick={() => {
              if (selectedFile) onSetReviewed(selectedFile.path, selectedFile.reviewed !== true);
            }}
          >
            {selectedFile?.reviewed ? (
              <CheckCircle2Icon className="size-3.5 text-emerald-500" />
            ) : (
              <CircleIcon className="size-3.5" />
            )}
          </button>
        ) : null}
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {files.length}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-emerald-500">+{totals.additions}</span>
        {totals.deletions > 0 ? (
          <span className="shrink-0 font-mono text-[10px] text-rose-500">−{totals.deletions}</span>
        ) : null}
      </div>
      {files.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">No changed files.</p>
      ) : (
        <WorkspaceFileTree
          model={model}
          aria-label="Changed files"
          className="min-h-0 flex-1 overflow-hidden"
        />
      )}
    </aside>
  );
}

const PLACEHOLDERS = {
  files: "Search files and symbols…",
  currentSymbols: "Search symbols in the current file…",
  workspaceSymbols: "Search workspace symbols…",
  line: "Go to line:column…",
  text: "Search text across the workspace…",
} as const;

export function PullRequestReviewQuickOpen({
  open,
  environmentId,
  cwd,
  changedPaths,
  selectedPath,
  onOpenChange,
  onSelect,
}: {
  readonly open: boolean;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly changedPaths: ReadonlyArray<string>;
  readonly selectedPath: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (path: string, line?: number, column?: number) => void;
}) {
  const [query, setQuery] = useState("");
  const copyPath = useCopyReviewPath();
  const parsed = useMemo(() => parsePullRequestReviewQuickOpenQuery(query), [query]);
  const fileSearch = useProjectPathSearch(
    {
      environmentId: open ? environmentId : null,
      cwd: open ? cwd : null,
      query: open && parsed.mode === "files" ? parsed.search : null,
      kind: "file",
    },
    100,
    { allowEmptyQuery: true },
  );
  const files = useMemo(
    () =>
      selectPullRequestReviewFiles({
        projectPaths: fileSearch.entries.map((entry) => entry.path.replaceAll("\\", "/")),
        changedPaths,
        query: parsed.search,
      }),
    [changedPaths, fileSearch.entries, parsed.search],
  );
  const symbolMode = parsed.mode === "currentSymbols" || parsed.mode === "workspaceSymbols";
  const declarationSearch = useProjectContentSearch({
    environmentId: open && symbolMode ? environmentId : null,
    cwd: open && symbolMode ? cwd : null,
    query: symbolMode ? pullRequestReviewDeclarationQuery(parsed.search) : "",
    caseSensitive: false,
    wholeWord: false,
    useRegex: true,
  });
  const currentFile = useProjectFileQuery(
    environmentId,
    cwd,
    selectedPath,
    open && parsed.mode === "currentSymbols",
  );
  const declarations = useMemo(() => {
    const localMatches: ReadonlyArray<ProjectContentMatch> = currentFile.data
      ? currentFile.data.contents.split("\n").map((lineContent, index) => ({
          path: selectedPath ?? "",
          lineNumber: index + 1,
          lineContent,
          matchRanges: [],
        }))
      : [];
    const matches = parsed.mode === "currentSymbols" ? localMatches : declarationSearch.matches;
    return selectPullRequestReviewDeclarations({ matches, query: parsed.search });
  }, [currentFile.data, declarationSearch.matches, parsed.mode, parsed.search, selectedPath]);
  const textSearch = useProjectContentSearch({
    environmentId: open && parsed.mode === "text" ? environmentId : null,
    cwd: open && parsed.mode === "text" ? cwd : null,
    query: parsed.mode === "text" ? parsed.search : "",
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
  });

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const select = (path: string, line?: number, column?: number) => {
    onSelect(path, line, column);
    onOpenChange(false);
  };
  const waiting =
    (parsed.mode === "files" && fileSearch.isPending) ||
    (symbolMode && (declarationSearch.isPending || currentFile.isPending)) ||
    (parsed.mode === "text" && textSearch.isPending);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogPopup
        aria-label="Pull request quick open"
        className="overflow-hidden p-0"
        onBackdropPointerDown={() => onOpenChange(false)}
      >
        <Command mode="none" value={query} onValueChange={setQuery}>
          <CommandInput placeholder={PLACEHOLDERS[parsed.mode]} />
          <CommandPanel className="max-h-[min(32rem,72vh)]">
            <CommandList>
              <CommandEmpty>{waiting ? "Searching project…" : "No matching results."}</CommandEmpty>
              {parsed.mode === "line" && parsed.line && selectedPath ? (
                <CommandGroup
                  items={[{ path: selectedPath, line: parsed.line, column: parsed.column ?? 1 }]}
                >
                  <CommandGroupLabel>Go to</CommandGroupLabel>
                  <CommandCollection>
                    {(target) => (
                      <CommandItem
                        value={`line:${target.line}:${target.column}`}
                        onClick={() => select(target.path, target.line, target.column)}
                      >
                        <TextSearchIcon className="size-4" />
                        <span>
                          Line {target.line}, column {target.column}
                        </span>
                        <span className="ml-auto truncate font-mono text-xs text-muted-foreground">
                          {target.path}
                        </span>
                      </CommandItem>
                    )}
                  </CommandCollection>
                </CommandGroup>
              ) : null}
              {parsed.mode === "text" ? (
                <CommandGroup items={textSearch.isPending ? [] : textSearch.matches}>
                  <CommandGroupLabel>Workspace text</CommandGroupLabel>
                  <CommandCollection>
                    {(match) => (
                      <CommandItem
                        value={`text:${match.path}:${match.lineNumber}:${match.lineContent}`}
                        onClick={() =>
                          select(
                            match.path,
                            match.lineNumber,
                            (match.matchRanges[0]?.start ?? 0) + 1,
                          )
                        }
                      >
                        <TextSearchIcon className="size-4 shrink-0 text-amber-500" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-xs">
                            {match.lineContent.trim()}
                          </span>
                          <span className="block truncate font-mono text-[10px] text-muted-foreground">
                            {match.path}:{match.lineNumber}
                          </span>
                        </span>
                      </CommandItem>
                    )}
                  </CommandCollection>
                </CommandGroup>
              ) : null}
              {symbolMode ? (
                <CommandGroup items={declarations}>
                  <CommandGroupLabel>
                    {parsed.mode === "currentSymbols"
                      ? "Current file symbols"
                      : "Workspace symbols"}
                  </CommandGroupLabel>
                  <CommandCollection>
                    {(declaration) => (
                      <CommandItem
                        value={`symbol:${declaration.path}:${declaration.line}:${declaration.name}`}
                        onClick={() =>
                          select(declaration.path, declaration.line, declaration.column)
                        }
                      >
                        <BracesIcon className="size-4 shrink-0 text-sky-500" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">
                            {declaration.name}{" "}
                            <span className="text-xs text-muted-foreground">
                              {declaration.kind}
                            </span>
                          </span>
                          <span className="block truncate font-mono text-[10px] text-muted-foreground">
                            {declaration.path}:{declaration.line} · {declaration.detail}
                          </span>
                        </span>
                      </CommandItem>
                    )}
                  </CommandCollection>
                </CommandGroup>
              ) : null}
              {parsed.mode === "files" ? (
                <CommandGroup items={files}>
                  <CommandGroupLabel>
                    {parsed.search ? "Files" : "Changed and recent files"}
                  </CommandGroupLabel>
                  <CommandCollection>
                    {(file) => {
                      const label = reviewFilePathLabel(file.path);
                      return (
                        <CommandItem
                          value={file.path}
                          onClick={() => select(file.path, parsed.line, parsed.column)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            copyPath(file.path, file.path);
                          }}
                        >
                          <FileCode2Icon className="size-4 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">
                            {label.name}{" "}
                            <span className="text-muted-foreground">{label.parent}</span>
                          </span>
                          {file.changed ? (
                            <span className="text-xs text-muted-foreground">Changed</span>
                          ) : null}
                        </CommandItem>
                      );
                    }}
                  </CommandCollection>
                </CommandGroup>
              ) : null}
            </CommandList>
          </CommandPanel>
          <CommandFooter className="justify-start gap-3 text-xs">
            <span>
              <Kbd>@</Kbd> file symbols
            </span>
            <span>
              <Kbd>#</Kbd> workspace symbols
            </span>
            <span>
              <Kbd>:</Kbd> line
            </span>
            <span>
              <Kbd>/</Kbd> text
            </span>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
