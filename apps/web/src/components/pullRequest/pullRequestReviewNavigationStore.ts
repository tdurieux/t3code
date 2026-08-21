import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "~/lib/storage";
import type { PullRequestSemanticTarget } from "./pullRequestSemanticIndex.logic";

const MAX_TRAIL_LENGTH = 100;
const EMPTY_TARGETS: ReadonlyArray<PullRequestSemanticTarget> = [];

interface NavigationTrail {
  readonly entries: ReadonlyArray<PullRequestSemanticTarget>;
  readonly index: number;
}

interface PullRequestReviewNavigationState {
  readonly trails: Readonly<Record<string, NavigationTrail>>;
  readonly pins: Readonly<Record<string, ReadonlyArray<PullRequestSemanticTarget>>>;
  readonly open: (reviewKey: string, target: PullRequestSemanticTarget) => void;
  readonly move: (reviewKey: string, offset: -1 | 1) => void;
  readonly togglePin: (reviewKey: string, target: PullRequestSemanticTarget) => void;
}

function targetKey(target: PullRequestSemanticTarget): string {
  return `${target.path}:${target.line}:${target.column}:${target.symbol}`;
}

export const usePullRequestReviewNavigationStore = create<PullRequestReviewNavigationState>()(
  persist(
    (set) => ({
      trails: {},
      pins: {},
      open: (reviewKey, target) =>
        set((state) => {
          const trail = state.trails[reviewKey] ?? { entries: EMPTY_TARGETS, index: -1 };
          if (
            targetKey(trail.entries[trail.index] ?? target) === targetKey(target) &&
            trail.index >= 0
          ) {
            return state;
          }
          const entries = [...trail.entries.slice(0, trail.index + 1), target].slice(
            -MAX_TRAIL_LENGTH,
          );
          return {
            trails: { ...state.trails, [reviewKey]: { entries, index: entries.length - 1 } },
          };
        }),
      move: (reviewKey, offset) =>
        set((state) => {
          const trail = state.trails[reviewKey];
          if (!trail) return state;
          const index = Math.max(0, Math.min(trail.entries.length - 1, trail.index + offset));
          if (index === trail.index) return state;
          return { trails: { ...state.trails, [reviewKey]: { ...trail, index } } };
        }),
      togglePin: (reviewKey, target) =>
        set((state) => {
          const pins = state.pins[reviewKey] ?? EMPTY_TARGETS;
          const key = targetKey(target);
          const exists = pins.some((entry) => targetKey(entry) === key);
          const next = exists
            ? pins.filter((entry) => targetKey(entry) !== key)
            : [...pins, target];
          return { pins: { ...state.pins, [reviewKey]: next } };
        }),
    }),
    {
      name: "t3code:pull-request-review-navigation:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ trails: state.trails, pins: state.pins }),
    },
  ),
);

export function pullRequestReviewCurrentNavigation(
  trails: Readonly<Record<string, NavigationTrail>>,
  reviewKey: string | null | undefined,
): {
  readonly target: PullRequestSemanticTarget | null;
  readonly canBack: boolean;
  readonly canForward: boolean;
} {
  const trail = reviewKey ? trails[reviewKey] : undefined;
  if (!trail) return { target: null, canBack: false, canForward: false };
  return {
    target: trail.entries[trail.index] ?? null,
    canBack: trail.index > 0,
    canForward: trail.index >= 0 && trail.index < trail.entries.length - 1,
  };
}

export function pullRequestReviewPinnedSymbols(
  pins: Readonly<Record<string, ReadonlyArray<PullRequestSemanticTarget>>>,
  reviewKey: string | null | undefined,
): ReadonlyArray<PullRequestSemanticTarget> {
  return reviewKey ? (pins[reviewKey] ?? EMPTY_TARGETS) : EMPTY_TARGETS;
}

export function isPullRequestReviewSymbolPinned(
  pins: ReadonlyArray<PullRequestSemanticTarget>,
  target: PullRequestSemanticTarget,
): boolean {
  return pins.some((entry) => targetKey(entry) === targetKey(target));
}
