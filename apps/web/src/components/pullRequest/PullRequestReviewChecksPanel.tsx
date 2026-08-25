import type { EnvironmentId, PullRequestCheck } from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  ClipboardCopyIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  PinIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { readLocalApi } from "~/localApi";
import { reviewEnvironment } from "~/state/review";
import { useEnvironmentQuery } from "~/state/query";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { PullRequestCheckStatusIcon, pullRequestCheckStatusLabel } from "./pullRequestPresentation";
import {
  pullRequestCiEvidenceId,
  type PullRequestCiEvidence,
} from "./pullRequestReviewHandoffStore";

const MAX_RENDERED_LOG_LINES = 1_000;

function openExternal(url: string): void {
  void readLocalApi()?.shell.openExternal(url);
}

export function PullRequestReviewChecksPanel({
  navigation,
  environmentId,
  cwd,
  checks,
  pinnedEvidence,
  onToggleEvidence,
  onClose,
}: {
  readonly navigation?: ReactNode;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly checks: ReadonlyArray<PullRequestCheck>;
  readonly pinnedEvidence: ReadonlyArray<PullRequestCiEvidence>;
  readonly onToggleEvidence: (evidence: PullRequestCiEvidence) => void;
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
  const pinnedEvidenceIds = useMemo(
    () => new Set(pinnedEvidence.map((evidence) => evidence.id)),
    [pinnedEvidence],
  );
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: "visible CI log",
    onCopy: () => toastManager.add({ type: "success", title: "Visible CI log copied" }),
  });

  return (
    <aside className="flex min-h-0 w-full shrink-0 flex-col border-t border-border/60 bg-background lg:w-96 lg:border-l lg:border-t-0">
      {navigation}
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
            checks.map((check) => (
              <button
                key={`${check.name}:${check.url ?? ""}:${check.description ?? ""}`}
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
              <div className="min-h-0 flex-1 overflow-auto bg-[var(--code-background,var(--background))] py-3 font-mono text-[10px] leading-4 text-foreground">
                {visibleLines.length > 0 && selected.url ? (
                  visibleLines.map((line) => {
                    const id = pullRequestCiEvidenceId({
                      checkName: selected.name,
                      checkUrl: selected.url!,
                      line: line.number,
                    });
                    const pinned = pinnedEvidenceIds.has(id);
                    return (
                      <div
                        key={line.number}
                        className={`group flex min-w-max items-start px-2 ${pinned ? "bg-violet-500/10" : "hover:bg-muted/30"}`}
                      >
                        <button
                          type="button"
                          className="mr-1 flex size-4 shrink-0 items-center justify-center text-muted-foreground opacity-0 group-hover:opacity-100 data-[pinned=true]:text-violet-500 data-[pinned=true]:opacity-100"
                          data-pinned={pinned}
                          aria-label={
                            pinned
                              ? `Unpin CI log line ${line.number}`
                              : `Pin CI log line ${line.number}`
                          }
                          onClick={() =>
                            onToggleEvidence({
                              id,
                              checkName: selected.name,
                              checkUrl: selected.url!,
                              line: line.number,
                              text: line.text,
                            })
                          }
                        >
                          <PinIcon className="size-3" />
                        </button>
                        <span className="w-10 shrink-0 select-none pr-2 text-right text-muted-foreground">
                          {line.number}
                        </span>
                        <code className="whitespace-pre">{line.text || " "}</code>
                      </div>
                    );
                  })
                ) : (
                  <p className="px-3 text-muted-foreground">No log lines matched.</p>
                )}
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
