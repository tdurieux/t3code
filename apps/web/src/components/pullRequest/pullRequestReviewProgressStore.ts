import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "~/lib/storage";

const MAX_PROGRESS_ENTRIES = 100;
const EMPTY: ReadonlyArray<string> = [];
const EMPTY_ENTRY: PullRequestReviewProgressEntry = {
  reviewedFiles: EMPTY,
  visitedHunks: EMPTY,
  updatedAt: 0,
};

export interface PullRequestReviewProgressEntry {
  readonly reviewedFiles: ReadonlyArray<string>;
  readonly visitedHunks: ReadonlyArray<string>;
  readonly updatedAt: number;
}

interface PullRequestReviewProgressState {
  readonly byReviewKey: Readonly<Record<string, PullRequestReviewProgressEntry>>;
  readonly setFileReviewed: (reviewKey: string, path: string, reviewed: boolean) => void;
  readonly setHunkVisited: (reviewKey: string, hunkId: string, visited: boolean) => void;
  readonly clear: (reviewKey: string) => void;
}

function retainRecent(
  entries: Readonly<Record<string, PullRequestReviewProgressEntry>>,
): Readonly<Record<string, PullRequestReviewProgressEntry>> {
  const ordered = Object.entries(entries);
  if (ordered.length <= MAX_PROGRESS_ENTRIES) return entries;
  return Object.fromEntries(
    ordered
      .toSorted((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_PROGRESS_ENTRIES),
  );
}

function updateSet(
  state: PullRequestReviewProgressState,
  reviewKey: string,
  field: "reviewedFiles" | "visitedHunks",
  value: string,
  included: boolean,
) {
  const key = reviewKey.trim();
  const item = value.trim();
  if (!key || !item) return state;
  const current = state.byReviewKey[key];
  const values = new Set(current?.[field] ?? EMPTY);
  if (included) values.add(item);
  else values.delete(item);
  const reviewedFiles =
    field === "reviewedFiles" ? [...values].sort() : (current?.reviewedFiles ?? []);
  const visitedHunks =
    field === "visitedHunks" ? [...values].sort() : (current?.visitedHunks ?? []);
  if (reviewedFiles.length === 0 && visitedHunks.length === 0) {
    if (!current) return state;
    const { [key]: _removed, ...byReviewKey } = state.byReviewKey;
    return { ...state, byReviewKey };
  }
  return {
    ...state,
    byReviewKey: retainRecent({
      ...state.byReviewKey,
      [key]: { reviewedFiles, visitedHunks, updatedAt: Date.now() },
    }),
  };
}

export const usePullRequestReviewProgressStore = create<PullRequestReviewProgressState>()(
  persist(
    (set) => ({
      byReviewKey: {},
      setFileReviewed: (reviewKey, path, reviewed) =>
        set((state) => updateSet(state, reviewKey, "reviewedFiles", path, reviewed)),
      setHunkVisited: (reviewKey, hunkId, visited) =>
        set((state) => updateSet(state, reviewKey, "visitedHunks", hunkId, visited)),
      clear: (reviewKey) =>
        set((state) => {
          if (!(reviewKey in state.byReviewKey)) return state;
          const { [reviewKey]: _removed, ...byReviewKey } = state.byReviewKey;
          return { byReviewKey };
        }),
    }),
    {
      name: "t3code:pull-request-review-progress:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ byReviewKey: state.byReviewKey }),
    },
  ),
);

export function selectPullRequestReviewProgress(
  entries: Readonly<Record<string, PullRequestReviewProgressEntry>>,
  reviewKey: string | null | undefined,
): PullRequestReviewProgressEntry {
  return reviewKey ? (entries[reviewKey] ?? EMPTY_ENTRY) : EMPTY_ENTRY;
}
