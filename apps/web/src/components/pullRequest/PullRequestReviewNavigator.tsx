import type { EnvironmentId, ProjectContentMatch } from "@t3tools/contracts";
import {
  BracesIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  FileCode2Icon,
  FolderOpenIcon,
  TextSearchIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import type { ResizableWidthHandlers } from "~/hooks/useResizableWidth";
import { cn } from "~/lib/utils";
import { useProjectContentSearch, useProjectPathSearch } from "~/state/queries";
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
import { Kbd } from "../ui/kbd";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  parsePullRequestReviewQuickOpenQuery,
  pullRequestReviewDeclarationQuery,
  selectPullRequestReviewDeclarations,
  selectPullRequestReviewFiles,
} from "./pullRequestReviewQuickOpen.logic";
import {
  DEFAULT_COLLAPSED_PULL_REQUEST_REVIEW_FILE_GROUPS,
  groupPullRequestReviewFiles,
  type PullRequestReviewFileType,
} from "./pullRequestReviewLayout.logic";
import type { PullRequestReviewHunk } from "./pullRequestReviewProgress.logic";

export interface PullRequestReviewFileEntry {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly reviewed?: boolean;
  readonly visitedHunks?: number;
  readonly totalHunks?: number;
  readonly hunks: ReadonlyArray<PullRequestReviewHunk & { readonly visited: boolean }>;
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
  onOpenHunk,
  onOpenQuickOpen,
  onSetReviewed,
  width,
  resizeHandlers,
}: {
  readonly files: ReadonlyArray<PullRequestReviewFileEntry>;
  readonly selectedPath: string | null;
  readonly onSelect: (path: string) => void;
  readonly onOpenHunk: (hunk: PullRequestReviewHunk) => void;
  readonly onOpenQuickOpen: () => void;
  readonly onSetReviewed?: (path: string, reviewed: boolean) => void;
  readonly width: number;
  readonly resizeHandlers: ResizableWidthHandlers;
}) {
  const copyPath = useCopyReviewPath();
  const [filter, setFilter] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<PullRequestReviewFileType>>(
    () => new Set(DEFAULT_COLLAPSED_PULL_REQUEST_REVIEW_FILE_GROUPS),
  );
  const [expandedFiles, setExpandedFiles] = useState<ReadonlySet<string>>(() => new Set());
  const filteredFiles = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    return query ? files.filter((file) => file.path.toLocaleLowerCase().includes(query)) : files;
  }, [files, filter]);
  const groups = useMemo(() => groupPullRequestReviewFiles(filteredFiles), [filteredFiles]);
  const totals = useMemo(
    () =>
      filteredFiles.reduce(
        (total, file) => ({
          additions: total.additions + file.additions,
          deletions: total.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [filteredFiles],
  );

  useEffect(() => {
    if (!selectedPath) return;
    setExpandedFiles((current) =>
      current.has(selectedPath) ? current : new Set([...current, selectedPath]),
    );
  }, [selectedPath]);

  return (
    <aside
      className="relative hidden shrink-0 flex-col border-r border-border/65 bg-card/20 md:flex"
      style={{ width: `${width}px` }}
      aria-label="Changed files"
    >
      <ReviewColumnResizeHandle edge="right" handlers={resizeHandlers} />
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <Input
            type="search"
            size="sm"
            className="min-w-0 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            aria-label="Filter changed files"
            placeholder="Filter…"
            value={filter}
            onChange={(event) => setFilter(event.currentTarget.value)}
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
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {filteredFiles.length}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-emerald-500">+{totals.additions}</span>
        {totals.deletions > 0 ? (
          <span className="shrink-0 font-mono text-[10px] text-rose-500">−{totals.deletions}</span>
        ) : null}
      </div>
      {filteredFiles.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          {filter.trim() ? "No matching files." : "No changed files."}
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {groups.map((group) => {
            const collapsed = collapsedGroups.has(group.type);
            const reviewedInGroup = group.files.filter((file) => file.reviewed).length;
            return (
              <section key={group.type} className="pb-1">
                <button
                  type="button"
                  className="flex h-9 w-full items-center gap-1.5 px-3 text-left text-[10px] font-medium text-muted-foreground hover:bg-accent/45 hover:text-foreground"
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
                    className={cn(
                      "size-3 shrink-0 transition-transform",
                      collapsed && "-rotate-90",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate uppercase tracking-wider">
                    {group.label}
                  </span>
                  <span className="font-mono text-[9px] text-emerald-600/75">
                    +{group.additions}
                  </span>
                  {group.deletions > 0 ? (
                    <span className="font-mono text-[9px] text-rose-600/75">
                      −{group.deletions}
                    </span>
                  ) : null}
                  <span
                    className="w-4 text-right font-mono text-[9px]"
                    aria-label={`${reviewedInGroup} of ${group.files.length} reviewed`}
                  >
                    {reviewedInGroup === group.files.length ? (
                      <CheckCircle2Icon className="ml-auto size-3 text-emerald-500" />
                    ) : (
                      group.files.length
                    )}
                  </span>
                </button>
                {!collapsed
                  ? groupReviewFilesByFolder(group.files).map((folder) => (
                      <div key={folder.parent || `root:${group.type}`} className="mb-1 last:mb-0">
                        <div
                          className="mx-3 flex h-6 items-center gap-1.5 px-1 font-mono text-[9px] text-muted-foreground/70"
                          aria-label={folder.parent ? `${folder.parent}/` : "Repository root"}
                        >
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
                            const pathLabel = reviewFilePathLabel(file.path);
                            const expanded = expandedFiles.has(file.path);
                            return (
                              <div key={file.path}>
                                <div
                                  className={cn(
                                    "group/file -ml-px flex h-8 w-[calc(100%+1px)] items-center border-l-2 border-l-transparent text-[11px] hover:bg-accent/55",
                                    selectedPath === file.path &&
                                      "border-l-primary bg-accent/75 text-foreground",
                                  )}
                                  onContextMenu={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    copyPath(file.path, file.path);
                                  }}
                                >
                                  {file.hunks.length > 0 ? (
                                    <button
                                      type="button"
                                      className="ml-1 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:bg-background/70 hover:text-foreground"
                                      aria-label={`${expanded ? "Hide" : "Show"} changed locations in ${pathLabel.name}`}
                                      aria-expanded={expanded}
                                      onClick={() =>
                                        setExpandedFiles((current) => {
                                          const next = new Set(current);
                                          if (next.has(file.path)) next.delete(file.path);
                                          else next.add(file.path);
                                          return next;
                                        })
                                      }
                                    >
                                      <ChevronRightIcon
                                        className={cn(
                                          "size-3 transition-transform",
                                          expanded && "rotate-90",
                                        )}
                                      />
                                    </button>
                                  ) : (
                                    <span className="ml-1 size-6 shrink-0" />
                                  )}
                                  <button
                                    type="button"
                                    className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-left"
                                    aria-label={file.path}
                                    onClick={() => onSelect(file.path)}
                                  >
                                    <FileCode2Icon className="size-3 shrink-0 text-muted-foreground/50" />
                                    <span className="min-w-0 flex-1 truncate font-mono font-medium">
                                      {pathLabel.name}
                                    </span>
                                    {file.additions > 0 ? (
                                      <span className="shrink-0 font-mono text-[10px] text-emerald-500">
                                        +{file.additions}
                                      </span>
                                    ) : null}
                                    {file.deletions > 0 ? (
                                      <span className="shrink-0 font-mono text-[10px] text-rose-500">
                                        −{file.deletions}
                                      </span>
                                    ) : null}
                                  </button>
                                  {onSetReviewed ? (
                                    <button
                                      type="button"
                                      className="mx-1 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground/45 hover:bg-background/70 hover:text-foreground"
                                      aria-label={
                                        file.reviewed
                                          ? "Mark file unreviewed"
                                          : "Mark file reviewed"
                                      }
                                      onClick={() =>
                                        onSetReviewed(file.path, file.reviewed !== true)
                                      }
                                    >
                                      {file.reviewed ? (
                                        <CheckCircle2Icon className="size-3.5 text-emerald-500" />
                                      ) : (
                                        <CircleIcon className="size-3" />
                                      )}
                                    </button>
                                  ) : null}
                                </div>
                                {expanded ? (
                                  <div className="ml-7 border-l border-border/45 bg-muted/15 py-1">
                                    {file.hunks.map((hunk) => (
                                      <button
                                        key={hunk.id}
                                        type="button"
                                        className={cn(
                                          "-ml-px flex w-[calc(100%+1px)] items-center gap-2 border-l-2 border-l-transparent py-1 pr-2 pl-3 text-left font-mono text-[10px] text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                                          hunk.visited && "border-l-sky-500/60 text-foreground",
                                        )}
                                        onClick={() => onOpenHunk(hunk)}
                                      >
                                        <span
                                          className={cn(
                                            "text-muted-foreground/45",
                                            hunk.visited && "text-sky-500",
                                          )}
                                        >
                                          {hunk.visited ? "●" : "↳"}
                                        </span>
                                        <span className="shrink-0 text-emerald-500">
                                          L{hunk.startLine}
                                        </span>
                                        <span className="truncate">{hunk.label}</span>
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  : null}
              </section>
            );
          })}
        </div>
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
