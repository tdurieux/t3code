import type {
  EnvironmentId,
  ProjectContentMatch,
  ReviewCodePosition,
  ReviewCodeSymbol,
} from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BracesIcon,
  ChevronRightIcon,
  NetworkIcon,
  PinIcon,
  XIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { HighlightedSearchLine } from "~/components/search/HighlightedSearchLine";
import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { useProjectContentSearch } from "~/state/queries";
import { useEnvironmentQuery } from "~/state/query";
import { reviewEnvironment } from "~/state/review";

import { useProjectFileQuery } from "../files/projectFilesQueryState";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import {
  buildPullRequestSemanticRelations,
  pullRequestSemanticExcerpt,
  type PullRequestSemanticTarget,
} from "./pullRequestSemanticIndex.logic";

type Relation = "definitions" | "references" | "callers" | "callees" | "usages";

interface SemanticLocation {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly symbol: string;
  readonly label: string;
  readonly detail: string;
}

function locationFromPosition(
  position: ReviewCodePosition,
  symbol: string,
  label: string,
): SemanticLocation {
  return {
    path: position.path,
    line: position.startLine,
    column: position.startColumn ?? 1,
    symbol,
    label,
    detail: `${position.path}:${position.startLine}`,
  };
}

function locationFromSymbol(symbol: ReviewCodeSymbol): SemanticLocation {
  return {
    ...locationFromPosition(symbol.position, symbol.name, symbol.name),
    label: symbol.name,
    detail: `${symbol.kind} · ${symbol.fqn}`,
  };
}

function locationFromMatch(match: ProjectContentMatch, fallbackSymbol: string): SemanticLocation {
  const range = match.matchRanges[0];
  return {
    path: match.path,
    line: match.lineNumber,
    column: (range?.start ?? 0) + 1,
    symbol:
      range === undefined
        ? fallbackSymbol
        : match.lineContent.slice(range.start, range.end) || fallbackSymbol,
    label: match.lineContent.trim() || fallbackSymbol,
    detail: `${match.path}:${match.lineNumber}`,
  };
}

function LocationButton({
  location,
  onNavigate,
}: {
  readonly location: SemanticLocation;
  readonly onNavigate: (target: PullRequestSemanticTarget) => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-start gap-2 border-b border-border/45 px-3 py-2 text-left hover:bg-muted/30"
      onClick={() =>
        onNavigate({
          path: location.path,
          line: location.line,
          column: location.column,
          symbol: location.symbol,
        })
      }
    >
      <BracesIcon className="mt-0.5 size-3.5 shrink-0 text-sky-500" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[10px]">{location.label}</span>
        <span className="block truncate font-mono text-[9px] text-muted-foreground">
          {location.detail}
        </span>
      </span>
      <ChevronRightIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
    </button>
  );
}

export function PullRequestSemanticPanel({
  environmentId,
  cwd,
  target,
  canGoBack,
  canGoForward,
  pinned,
  onNavigate,
  onBack,
  onForward,
  onTogglePin,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly target: PullRequestSemanticTarget;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly pinned: boolean;
  readonly onNavigate: (target: PullRequestSemanticTarget) => void;
  readonly onBack: () => void;
  readonly onForward: () => void;
  readonly onTogglePin: () => void;
  readonly onClose: () => void;
}) {
  const [relation, setRelation] = useState<Relation>("definitions");
  const { resolvedTheme } = useTheme();
  const navigation = useEnvironmentQuery(
    reviewEnvironment.codeNavigation({
      environmentId,
      input: {
        cwd,
        path: target.path,
        line: target.line,
        column: target.column,
        symbol: target.symbol,
      },
    }),
  );
  // Workspace search is deliberately retained as the graceful fallback for a
  // language the bundled semantic engine cannot parse.
  const search = useProjectContentSearch({
    environmentId,
    cwd,
    query: target.symbol,
    caseSensitive: true,
    wholeWord: true,
    useRegex: false,
  });
  const file = useProjectFileQuery(environmentId, cwd, target.path);
  const fallback = useMemo(
    () =>
      buildPullRequestSemanticRelations({
        symbol: target.symbol,
        matches: search.matches,
        currentLine: target.line,
        ...(file.data ? { currentFileContents: file.data.contents } : {}),
      }),
    [file.data, search.matches, target.line, target.symbol],
  );
  const indexed = navigation.data;
  const relations = useMemo<Record<Relation, ReadonlyArray<SemanticLocation>>>(() => {
    if (indexed) {
      const definitions = indexed.definitionCandidates.map(locationFromSymbol);
      const references = indexed.references.map((position) =>
        locationFromPosition(position, target.symbol, "Reference"),
      );
      return {
        definitions,
        references,
        callers: indexed.callers.map(locationFromSymbol),
        callees: indexed.callees.map(locationFromSymbol),
        usages: [...definitions, ...references],
      };
    }
    const definitions = fallback.definitions.map((definition) => ({
      path: definition.path,
      line: definition.line,
      column: definition.column,
      symbol: definition.name,
      label: definition.detail,
      detail: `${definition.path}:${definition.line}`,
    }));
    const references = fallback.references.map((match) => locationFromMatch(match, target.symbol));
    return {
      definitions,
      references,
      callers: fallback.callers.map((match) => locationFromMatch(match, target.symbol)),
      callees: fallback.callees.map((symbol) => ({
        ...target,
        symbol,
        label: symbol,
        detail: "Syntactic call in nearby code",
      })),
      usages: fallback.usages.map((match) => locationFromMatch(match, target.symbol)),
    };
  }, [fallback, indexed, target]);
  const excerpt = file.data ? pullRequestSemanticExcerpt(file.data.contents, target.line) : [];
  const counts = useMemo(
    () =>
      Object.fromEntries(
        (Object.keys(relations) as ReadonlyArray<Relation>).map((key) => [
          key,
          relations[key].length,
        ]),
      ) as Record<Relation, number>,
    [relations],
  );
  const selectedName = indexed?.selectedSymbol?.name ?? target.symbol;

  return (
    <aside className="flex min-h-0 w-96 shrink-0 flex-col border-l border-border/60 bg-background">
      <header className="shrink-0 border-b border-border/60 p-3">
        <div className="flex items-center gap-1">
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Navigate back"
            disabled={!canGoBack}
            onClick={onBack}
          >
            <ArrowLeftIcon className="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Navigate forward"
            disabled={!canGoForward}
            onClick={onForward}
          >
            <ArrowRightIcon className="size-3.5" />
          </Button>
          <NetworkIcon className="ml-1 size-4 text-violet-500" />
          <div className="min-w-0 flex-1 pl-1">
            <h2 className="truncate font-mono text-xs font-semibold">{selectedName}</h2>
            <p className="truncate font-mono text-[9px] text-muted-foreground">
              {target.path}:{target.line}:{target.column}
            </p>
          </div>
          <Button
            size="icon-sm"
            variant={pinned ? "secondary" : "ghost"}
            aria-label={pinned ? "Unpin symbol" : "Pin symbol"}
            onClick={onTogglePin}
          >
            <PinIcon className="size-3.5" />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Close semantic peek" onClick={onClose}>
            <XIcon className="size-3.5" />
          </Button>
        </div>
        <div className="mt-3 overflow-hidden rounded-md border border-border/60 bg-muted/15 font-mono text-[10px]">
          {excerpt.map((line) => {
            const match: ProjectContentMatch = {
              path: target.path,
              lineNumber: line.number,
              lineContent: line.text,
              matchRanges:
                line.number === target.line
                  ? [
                      {
                        start: Math.max(0, target.column - 1),
                        end: Math.max(0, target.column - 1) + target.symbol.length,
                      },
                    ]
                  : [],
            };
            return (
              <div
                key={line.number}
                className={cn(
                  "flex min-w-0",
                  line.highlighted && "bg-violet-500/10 text-foreground",
                )}
              >
                <span className="w-10 shrink-0 select-none border-r border-border/45 pr-2 text-right text-muted-foreground">
                  {line.number}
                </span>
                <code className="min-w-0 flex-1 overflow-hidden whitespace-pre px-2">
                  <HighlightedSearchLine match={match} path={target.path} theme={resolvedTheme} />
                </code>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex items-center gap-2 text-[9px] text-muted-foreground">
          {navigation.isPending && navigation.data === null ? (
            <>
              <Spinner className="size-3" /> Building semantic index…
            </>
          ) : indexed ? (
            <span>{indexed.language} · bundled semantic index</span>
          ) : navigation.error ? (
            <span>Workspace search fallback</span>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {(Object.keys(counts) as ReadonlyArray<Relation>).map((key) => (
            <Button
              key={key}
              size="xs"
              variant={relation === key ? "secondary" : "ghost"}
              onClick={() => setRelation(key)}
            >
              {key} <span className="tabular-nums text-muted-foreground">{counts[key]}</span>
            </Button>
          ))}
        </div>
        {indexed?.truncated || (!indexed && search.truncated) ? (
          <p className="mt-2 text-[9px] text-amber-600">
            Results were capped to keep navigation responsive.
          </p>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {relations[relation].map((location) => (
          <LocationButton
            key={`${location.path}:${location.line}:${location.column}:${location.symbol}`}
            location={location}
            onNavigate={onNavigate}
          />
        ))}
        {(navigation.isPending || (!indexed && search.isPending)) &&
        relations[relation].length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">Indexing {relation}…</p>
        ) : relations[relation].length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">
            No {relation} found in the indexed workspace.
          </p>
        ) : null}
      </div>
    </aside>
  );
}
