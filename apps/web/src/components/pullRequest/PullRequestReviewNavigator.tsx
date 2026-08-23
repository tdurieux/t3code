import type { EnvironmentId, ProjectContentMatch } from "@t3tools/contracts";
import {
  BracesIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleIcon,
  FileCode2Icon,
  FolderOpenIcon,
  SearchIcon,
  TextSearchIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import type { ResizableWidthHandlers } from "~/hooks/useResizableWidth";
import { useProjectContentSearch, useProjectPathSearch } from "~/state/queries";
import { cn } from "~/lib/utils";
import { groupReviewFilesByFolder, reviewFilePathLabel } from "~/reviewFilePath";

import { useProjectFileQuery } from "../files/projectFilesQueryState";
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
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import { toastManager } from "../ui/toast";
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
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const copyPath = useCopyReviewPath();
  const visible = useMemo(() => {
    const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return words.length === 0
      ? files
      : files.filter((file) => words.every((word) => file.path.toLocaleLowerCase().includes(word)));
  }, [files, query]);
  const groups = useMemo(() => groupPullRequestReviewFiles(visible), [visible]);
  const navigableFiles = useMemo(
    () => groups.flatMap((group) => (collapsedGroups.has(group.type) ? [] : group.files)),
    [collapsedGroups, groups],
  );
  const indexByPath = useMemo(
    () => new Map(navigableFiles.map((file, index) => [file.path, index])),
    [navigableFiles],
  );
  const totals = useMemo(
    () =>
      visible.reduce(
        (total, file) => ({
          additions: total.additions + file.additions,
          deletions: total.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [visible],
  );

  useEffect(() => setActiveIndex(0), [query]);

  const onFilterKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => {
        const offset = event.key === "ArrowDown" ? 1 : -1;
        return navigableFiles.length === 0
          ? 0
          : (current + offset + navigableFiles.length) % navigableFiles.length;
      });
    } else if (event.key === "Enter") {
      const file = navigableFiles[activeIndex];
      if (file) onSelect(file.path);
    }
  };

  return (
    <aside
      className="relative hidden shrink-0 flex-col border-r border-border/65 bg-card/20 md:flex"
      style={{ width: `${width}px` }}
      aria-label="Changed files"
    >
      <ReviewColumnResizeHandle edge="right" handlers={resizeHandlers} />
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-1 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-7 border-0 bg-transparent pr-12 pl-6 text-xs shadow-none focus-visible:ring-0"
            aria-label="Filter changed files"
            placeholder="Filter…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onFilterKeyDown}
          />
          <button
            type="button"
            className="absolute top-1/2 right-0 -translate-y-1/2 rounded px-1 py-0.5 text-[9px] text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onOpenQuickOpen}
          >
            <Kbd>⌘K</Kbd>
          </button>
        </div>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {visible.length}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-emerald-500">+{totals.additions}</span>
        {totals.deletions > 0 ? (
          <span className="shrink-0 font-mono text-[10px] text-rose-500">−{totals.deletions}</span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1" role="listbox" aria-label="Changed files">
        {groups.map((group) => {
          const collapsed = collapsedGroups.has(group.type);
          const reviewed = group.files.filter((file) => file.reviewed).length;
          const additions = group.files.reduce((total, file) => total + file.additions, 0);
          const deletions = group.files.reduce((total, file) => total + file.deletions, 0);
          return (
            <section key={group.type} aria-labelledby={`review-file-group-${group.type}`}>
              <button
                type="button"
                id={`review-file-group-${group.type}`}
                className="flex h-8 w-full items-center gap-1.5 px-3 text-left text-[10px] font-medium text-muted-foreground hover:bg-accent/45 hover:text-foreground"
                aria-expanded={!collapsed}
                onClick={() =>
                  setCollapsedGroups((current) => {
                    const next = new Set(current);
                    if (next.has(group.type)) next.delete(group.type);
                    else next.add(group.type);
                    return next;
                  })
                }
              >
                <ChevronDownIcon
                  className={cn("size-3 shrink-0 transition-transform", collapsed && "-rotate-90")}
                />
                <span className="min-w-0 flex-1 truncate uppercase tracking-wider">
                  {group.label}
                </span>
                <span className="font-mono text-[9px] text-emerald-600/75">+{additions}</span>
                {deletions > 0 ? (
                  <span className="font-mono text-[9px] text-rose-600/75">−{deletions}</span>
                ) : null}
                <span className="w-4 text-right font-mono text-[9px]">
                  {reviewed === group.files.length ? (
                    <CheckCircle2Icon className="ml-auto size-3 text-emerald-500" />
                  ) : (
                    group.files.length
                  )}
                </span>
              </button>
              {!collapsed
                ? groupReviewFilesByFolder(group.files).map((folder) => (
                    <div key={folder.parent || `root:${group.type}`} className="mb-1 last:mb-0">
                      <div className="mx-3 flex h-6 items-center gap-1.5 px-1 font-mono text-[9px] text-muted-foreground/70">
                        <FolderOpenIcon className="size-3 shrink-0 text-sky-500/65" />
                        <span className="min-w-0 flex-1 truncate">
                          {folder.label || "Repository root"}
                        </span>
                        {folder.files.length > 1 ? (
                          <span className="shrink-0 tabular-nums text-muted-foreground/50">
                            {folder.files.length}
                          </span>
                        ) : null}
                      </div>
                      <div className="relative ml-5 border-l border-border/45">
                        {folder.files.map((file) => {
                          const index = indexByPath.get(file.path) ?? 0;
                          const label = reviewFilePathLabel(file.path);
                          const selected = file.path === selectedPath;
                          return (
                            <button
                              key={file.path}
                              type="button"
                              role="option"
                              aria-selected={selected}
                              aria-label={file.path}
                              className={cn(
                                "-ml-px flex h-8 w-[calc(100%+1px)] items-center gap-1.5 border-l-2 border-l-transparent px-2 text-left text-[11px] hover:bg-accent/55",
                                selected && "border-l-primary bg-accent/75 text-foreground",
                                !selected && index === activeIndex && "bg-accent/35",
                              )}
                              onMouseMove={() => setActiveIndex(index)}
                              onClick={() => onSelect(file.path)}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                copyPath(file.path, file.path);
                              }}
                            >
                              {onSetReviewed ? (
                                <span
                                  role="checkbox"
                                  aria-label={
                                    file.reviewed
                                      ? `Mark ${file.path} unreviewed`
                                      : `Mark ${file.path} reviewed`
                                  }
                                  aria-checked={file.reviewed === true}
                                  tabIndex={0}
                                  className="shrink-0 rounded text-muted-foreground hover:text-foreground"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onSetReviewed(file.path, file.reviewed !== true);
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key !== "Enter" && event.key !== " ") return;
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onSetReviewed(file.path, file.reviewed !== true);
                                  }}
                                >
                                  {file.reviewed ? (
                                    <CheckCircle2Icon className="size-3.5 text-emerald-500" />
                                  ) : (
                                    <CircleIcon className="size-3.5" />
                                  )}
                                </span>
                              ) : (
                                <FileCode2Icon className="size-3.5 shrink-0 text-muted-foreground" />
                              )}
                              <span className="min-w-0 flex-1 truncate font-mono font-medium">
                                {label.name}
                              </span>
                              {file.totalHunks ? (
                                <span className="shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground">
                                  {file.visitedHunks ?? 0}/{file.totalHunks}
                                </span>
                              ) : null}
                              <span className="shrink-0 font-mono text-[9px] tabular-nums">
                                <span className="text-emerald-600 dark:text-emerald-400">
                                  +{file.additions}
                                </span>{" "}
                                <span className="text-rose-600 dark:text-rose-400">
                                  −{file.deletions}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                : null}
            </section>
          );
        })}
        {navigableFiles.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">No matching files.</p>
        ) : null}
      </div>
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
