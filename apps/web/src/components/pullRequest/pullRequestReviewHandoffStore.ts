import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "~/lib/storage";

const EMPTY_EVIDENCE: ReadonlyArray<PullRequestCiEvidence> = [];
const MAX_REVIEW_ENTRIES = 100;
const MAX_EVIDENCE_PER_REVIEW = 20;

export interface PullRequestCiEvidence {
  readonly id: string;
  readonly checkName: string;
  readonly checkUrl: string;
  readonly line: number;
  readonly text: string;
}

interface EvidenceEntry {
  readonly items: ReadonlyArray<PullRequestCiEvidence>;
  readonly updatedAt: number;
}

interface PullRequestReviewHandoffState {
  readonly byReviewKey: Readonly<Record<string, EvidenceEntry>>;
  readonly toggleEvidence: (reviewKey: string, evidence: PullRequestCiEvidence) => void;
  readonly removeEvidence: (reviewKey: string, evidenceId: string) => void;
  readonly clearEvidence: (reviewKey: string) => void;
}

function retainRecent(
  entries: Readonly<Record<string, EvidenceEntry>>,
): Readonly<Record<string, EvidenceEntry>> {
  if (Object.keys(entries).length <= MAX_REVIEW_ENTRIES) return entries;
  return Object.fromEntries(
    Object.entries(entries)
      .toSorted((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_REVIEW_ENTRIES),
  );
}

export const usePullRequestReviewHandoffStore = create<PullRequestReviewHandoffState>()(
  persist(
    (set) => ({
      byReviewKey: {},
      toggleEvidence: (reviewKey, evidence) =>
        set((state) => {
          const key = reviewKey.trim();
          if (!key || !evidence.id.trim()) return state;
          const current = state.byReviewKey[key]?.items ?? EMPTY_EVIDENCE;
          const exists = current.some((item) => item.id === evidence.id);
          const items = exists
            ? current.filter((item) => item.id !== evidence.id)
            : [...current, evidence].slice(-MAX_EVIDENCE_PER_REVIEW);
          if (items.length === 0) {
            const { [key]: _removed, ...byReviewKey } = state.byReviewKey;
            return { byReviewKey };
          }
          return {
            byReviewKey: retainRecent({
              ...state.byReviewKey,
              [key]: { items, updatedAt: Date.now() },
            }),
          };
        }),
      removeEvidence: (reviewKey, evidenceId) =>
        set((state) => {
          const current = state.byReviewKey[reviewKey]?.items;
          if (!current?.some((item) => item.id === evidenceId)) return state;
          const items = current.filter((item) => item.id !== evidenceId);
          if (items.length === 0) {
            const { [reviewKey]: _removed, ...byReviewKey } = state.byReviewKey;
            return { byReviewKey };
          }
          return {
            byReviewKey: {
              ...state.byReviewKey,
              [reviewKey]: { items, updatedAt: Date.now() },
            },
          };
        }),
      clearEvidence: (reviewKey) =>
        set((state) => {
          if (!(reviewKey in state.byReviewKey)) return state;
          const { [reviewKey]: _removed, ...byReviewKey } = state.byReviewKey;
          return { byReviewKey };
        }),
    }),
    {
      name: "t3code:pull-request-review-handoff:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byReviewKey: state.byReviewKey }),
    },
  ),
);

export function pullRequestReviewCiEvidence(
  entries: Readonly<Record<string, EvidenceEntry>>,
  reviewKey: string | null | undefined,
): ReadonlyArray<PullRequestCiEvidence> {
  return reviewKey ? (entries[reviewKey]?.items ?? EMPTY_EVIDENCE) : EMPTY_EVIDENCE;
}

export function pullRequestCiEvidenceId(input: {
  readonly checkName: string;
  readonly checkUrl: string;
  readonly line: number;
}): string {
  return `${input.checkUrl}\0${input.checkName}\0${input.line}`;
}
