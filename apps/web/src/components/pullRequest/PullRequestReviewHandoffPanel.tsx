import type { PullRequestDetailView } from "@t3tools/contracts";
import {
  BotIcon,
  BracesIcon,
  CheckCircle2Icon,
  PinIcon,
  SendIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import type { PullRequestAgentSelectionInput } from "./PullRequestCodeTab";
import { buildPullRequestReviewHandoffComment } from "./pullRequestReviewHandoff.logic";
import type { PullRequestCiEvidence } from "./pullRequestReviewHandoffStore";
import type { PullRequestReviewCoverage } from "./pullRequestReviewProgress.logic";
import type { PullRequestSemanticTarget } from "./pullRequestSemanticIndex.logic";

const DEFAULT_REVIEW_REQUEST =
  "Review the remaining changes. Prioritize correctness risks, missing tests, unresolved CI evidence, and concrete blockers to approval.";

export function PullRequestReviewHandoffPanel({
  detail,
  revision,
  coverage,
  pinnedSymbols,
  ciEvidence,
  pending,
  onNavigateSymbol,
  onRemoveEvidence,
  onClearEvidence,
  onStartConversation,
  onClose,
}: {
  readonly detail: PullRequestDetailView;
  readonly revision: string;
  readonly coverage: PullRequestReviewCoverage;
  readonly pinnedSymbols: ReadonlyArray<PullRequestSemanticTarget>;
  readonly ciEvidence: ReadonlyArray<PullRequestCiEvidence>;
  readonly pending: boolean;
  readonly onNavigateSymbol: (target: PullRequestSemanticTarget) => void;
  readonly onRemoveEvidence: (evidenceId: string) => void;
  readonly onClearEvidence: () => void;
  readonly onStartConversation?: (input: PullRequestAgentSelectionInput) => void;
  readonly onClose: () => void;
}) {
  const [request, setRequest] = useState(DEFAULT_REVIEW_REQUEST);
  const packet = useMemo(
    () =>
      buildPullRequestReviewHandoffComment({
        number: detail.number,
        title: detail.title,
        url: detail.url,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
        revision,
        coverage,
        pinnedSymbols,
        ciEvidence,
      }),
    [ciEvidence, coverage, detail, pinnedSymbols, revision],
  );
  const percentage =
    coverage.totalHunks === 0 ? 0 : Math.round((coverage.visitedHunks / coverage.totalHunks) * 100);

  return (
    <aside className="flex min-h-0 w-96 shrink-0 flex-col border-l border-border/60 bg-background">
      <header className="shrink-0 border-b border-border/60 p-3">
        <div className="flex items-start gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-violet-500/25 bg-violet-500/10">
            <BotIcon className="size-4 text-violet-500" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xs font-semibold">Review agent handoff</h2>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              Starts a dedicated conversation with a bounded packet, not the whole review.
            </p>
          </div>
          <Button size="icon-sm" variant="ghost" aria-label="Close handoff" onClick={onClose}>
            <XIcon className="size-3.5" />
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
          <div className="rounded-md border border-border/60 bg-muted/15 px-2 py-1.5">
            <p className="text-xs font-semibold tabular-nums">{percentage}%</p>
            <p className="text-[8px] uppercase text-muted-foreground">coverage</p>
          </div>
          <div className="rounded-md border border-border/60 bg-muted/15 px-2 py-1.5">
            <p className="text-xs font-semibold tabular-nums">{pinnedSymbols.length}</p>
            <p className="text-[8px] uppercase text-muted-foreground">symbols</p>
          </div>
          <div className="rounded-md border border-border/60 bg-muted/15 px-2 py-1.5">
            <p className="text-xs font-semibold tabular-nums">{ciEvidence.length}</p>
            <p className="text-[8px] uppercase text-muted-foreground">CI lines</p>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <section className="border-b border-border/60 p-3">
          <div className="flex items-center gap-2">
            <PinIcon className="size-3.5 text-violet-500" />
            <h3 className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              Pinned symbols
            </h3>
          </div>
          {pinnedSymbols.length > 0 ? (
            <div className="mt-2 space-y-1">
              {pinnedSymbols.map((symbol) => (
                <button
                  key={`${symbol.path}:${symbol.line}:${symbol.column}:${symbol.symbol}`}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/50"
                  onClick={() => onNavigateSymbol(symbol)}
                >
                  <BracesIcon className="size-3.5 shrink-0 text-sky-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[10px]">{symbol.symbol}</span>
                    <span className="block truncate font-mono text-[8px] text-muted-foreground">
                      {symbol.path}:{symbol.line}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[10px] text-muted-foreground">
              Pin symbols from semantic Peek to include them.
            </p>
          )}
        </section>

        <section className="border-b border-border/60 p-3">
          <div className="flex items-center gap-2">
            <CheckCircle2Icon className="size-3.5 text-emerald-500" />
            <h3 className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
              CI evidence
            </h3>
            {ciEvidence.length > 0 ? (
              <Button size="xs" variant="ghost" className="ml-auto" onClick={onClearEvidence}>
                Clear
              </Button>
            ) : null}
          </div>
          {ciEvidence.length > 0 ? (
            <div className="mt-2 space-y-1.5">
              {ciEvidence.map((evidence) => (
                <div
                  key={evidence.id}
                  className="flex items-start gap-2 rounded-md border border-border/60 p-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[9px] font-medium">
                      {evidence.checkName} · L{evidence.line}
                    </span>
                    <code className="mt-0.5 block truncate text-[9px] text-muted-foreground">
                      {evidence.text || "Empty log line"}
                    </code>
                  </span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Remove ${evidence.checkName} line ${evidence.line}`}
                    onClick={() => onRemoveEvidence(evidence.id)}
                  >
                    <Trash2Icon className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[10px] text-muted-foreground">
              Pin relevant lines from workflow logs to include them.
            </p>
          )}
        </section>
      </div>

      <footer className="shrink-0 border-t border-border/60 p-3">
        <Textarea
          className="min-h-24 resize-none text-xs"
          aria-label="Review agent request"
          value={request}
          onChange={(event) => setRequest(event.target.value)}
        />
        <p className="mt-2 text-[9px] leading-relaxed text-muted-foreground">
          Packet preview: {packet.rangeLabel}. Context is capped at 12,000 characters.
        </p>
        <Button
          className="mt-3 w-full"
          size="sm"
          disabled={!onStartConversation || pending || request.trim().length === 0}
          onClick={() =>
            onStartConversation?.({
              comment: packet,
              request: request.trim(),
            })
          }
        >
          <SendIcon className="size-3.5" />
          {pending ? "Opening conversation…" : "Start dedicated conversation"}
        </Button>
      </footer>
    </aside>
  );
}
