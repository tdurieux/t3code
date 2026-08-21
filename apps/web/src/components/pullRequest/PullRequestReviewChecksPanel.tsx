import type { EnvironmentId, PullRequestCheck } from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  ClipboardCopyIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { readLocalApi } from "~/localApi";
import { reviewEnvironment } from "~/state/review";
import { useEnvironmentQuery } from "~/state/query";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { PullRequestCheckStatusIcon, pullRequestCheckStatusLabel } from "./pullRequestPresentation";

const MAX_RENDERED_LOG_LINES = 1_000;

function openExternal(url: string): void {
  void readLocalApi()?.shell.openExternal(url);
}

export function PullRequestReviewChecksPanel({
  environmentId,
  cwd,
  checks,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly checks: ReadonlyArray<PullRequestCheck>;
  readonly onClose: () => void;
}) {
  const [selected, setSelected] = useState<PullRequestCheck | null>(null);
  const [query, setQuery] = useState("");
  const log = useEnvironmentQuery(
    selected?.url
      ? reviewEnvironment.ciLog({
          environmentId,
          input: { cwd, checkName: selected.name, checkUrl: selected.url },
        })
      : null,
  );
  const lines = useMemo(() => log.data?.content.split(/\r?\n/) ?? [], [log.data?.content]);
  const visibleLines = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const matching = lines
      .map((text, index) => ({ number: index + 1, text }))
      .filter((line) => !normalized || line.text.toLocaleLowerCase().includes(normalized));
    return normalized
      ? matching.slice(0, MAX_RENDERED_LOG_LINES)
      : matching.slice(-MAX_RENDERED_LOG_LINES);
  }, [lines, query]);
  const visibleText = useMemo(
    () => visibleLines.map((line) => `${line.number}\t${line.text}`).join("\n"),
    [visibleLines],
  );
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: "visible CI log",
    onCopy: () => toastManager.add({ type: "success", title: "Visible CI log copied" }),
  });

  return (
    <aside className="flex min-h-0 w-full shrink-0 flex-col border-t border-border/60 bg-background lg:w-96 lg:border-l lg:border-t-0">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-2">
        {selected ? (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Back to checks"
            onClick={() => {
              setSelected(null);
              setQuery("");
            }}
          >
            <ArrowLeftIcon className="size-3.5" />
          </Button>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {selected?.name ?? "Checks and workflow logs"}
        </span>
        <Button size="icon-sm" variant="ghost" aria-label="Close checks" onClick={onClose}>
          <XIcon className="size-3.5" />
        </Button>
      </div>

      {selected === null ? (
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {checks.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              This pull request has no reported checks.
            </p>
          ) : (
            checks.map((check, index) => (
              <button
                key={`${index}:${check.name}:${check.url ?? ""}`}
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent/60 disabled:cursor-default"
                disabled={!check.url}
                onClick={() => setSelected(check)}
              >
                <PullRequestCheckStatusIcon status={check.status} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{check.name}</span>
                  {check.description ? (
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {check.description}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {pullRequestCheckStatusLabel(check.status)}
                </span>
              </button>
            ))
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 p-2">
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-7 pl-7 text-xs"
                aria-label="Search workflow log"
                placeholder="Search log"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Refresh workflow log"
              disabled={log.isPending}
              onClick={log.refresh}
            >
              <RefreshCwIcon className="size-3.5" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Copy visible workflow log"
              disabled={!visibleText}
              onClick={() => copyToClipboard(visibleText)}
            >
              <ClipboardCopyIcon className="size-3.5" />
            </Button>
            {selected.url ? (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Open check on provider"
                onClick={() => openExternal(selected.url!)}
              >
                <ExternalLinkIcon className="size-3.5" />
              </Button>
            ) : null}
          </div>
          {log.isPending && log.data === null ? (
            <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
              <LoaderCircleIcon className="size-5 animate-spin" />
            </div>
          ) : log.error ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-xs text-destructive">{log.error}</p>
              {selected.url ? (
                <Button size="xs" variant="outline" onClick={() => openExternal(selected.url!)}>
                  <ExternalLinkIcon className="size-3.5" />
                  Open on provider
                </Button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-auto bg-[var(--code-background,var(--background))] p-3">
                <pre className="whitespace-pre font-mono text-[10px] leading-4 text-foreground">
                  {visibleText || "No log lines matched."}
                </pre>
              </div>
              <p className="shrink-0 border-t border-border/60 px-3 py-1 text-[10px] text-muted-foreground">
                {query
                  ? `${visibleLines.length.toLocaleString()} matches shown`
                  : `Showing the last ${visibleLines.length.toLocaleString()} of ${lines.length.toLocaleString()} lines`}
                {log.data?.truncated ? " · response truncated at 4 MB" : ""}
                {isCopied ? " · copied" : ""}
              </p>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
