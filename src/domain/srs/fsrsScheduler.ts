/**
 * L1 — FsrsScheduler: FSRS-6 scheduling with fixed default weights (design.md
 * "FsrsScheduler"). Only Stability (S, days) and Difficulty (D, 1..10) are
 * persisted; Retrievability is recomputed from elapsed time. Due dates use absolute
 * elapsed ms via the continuous forgetting curve; while a word is in its learning
 * steps the first-display ladder overrides the formula's short intervals.
 */

import type { Rating, UserId, WordSchedulingState } from '../../types/domain';
import {
  FSRS_DEFAULT_WEIGHTS,
  DESIRED_RETENTION,
  S_CONSOLIDATE,
  FIRST_DISPLAY_LADDER_MS,
  DAY_MS,
} from './parameters';

export interface FsrsScheduler {
  initial(rating: Rating, now: number, identity: { userId: UserId; wordId: string }): WordSchedulingState;
  review(state: WordSchedulingState, rating: Rating, now: number): WordSchedulingState;
  /** Non-destructive what-if (drives per-button interval display). */
  simulate(state: WordSchedulingState, rating: Rating, now: number): WordSchedulingState;
  retrievability(state: WordSchedulingState, now: number): number;
  nextIntervalMs(state: WordSchedulingState): number;
  /** Ideal-cadence Good reviews remaining until S exceeds the consolidate threshold. */
  repsToConsolidate(state: WordSchedulingState): number;
}

// ── Algorithm constants ──────────────────────────────────────────────────────

const w = (i: number): number => FSRS_DEFAULT_WEIGHTS[i]!;
const DECAY = -w(20);
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;

const S_MIN = 0.01;
const S_MAX = 36_500;
const D_MIN = 1;
const D_MAX = 10;
const REPS_CAP = 1000;

const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi);

// ── Pure FSRS-6 formulas ─────────────────────────────────────────────────────

const initialStability = (g: Rating): number => clamp(w(g - 1), S_MIN, S_MAX);

const initialDifficulty = (g: Rating): number =>
  clamp(w(4) - Math.exp(w(5) * (g - 1)) + 1, D_MIN, D_MAX);

/** Continuous forgetting curve R(t,S), t and S in days. */
const retrievabilityAt = (elapsedDays: number, stability: number): number =>
  Math.pow(1 + FACTOR * (Math.max(0, elapsedDays) / stability), DECAY);

/** Interval (days) until R falls to the desired retention. Equals S at Rd = 0.9. */
const intervalDays = (stability: number): number =>
  (stability / FACTOR) * (Math.pow(DESIRED_RETENTION, 1 / DECAY) - 1);

const nextDifficulty = (difficulty: number, g: Rating): number => {
  const deltaD = -w(6) * (g - 3);
  const damped = difficulty + deltaD * ((10 - difficulty) / 9);
  const reverted = w(7) * initialDifficulty(4) + (1 - w(7)) * damped;
  return clamp(reverted, D_MIN, D_MAX);
};

const stabilityAfterRecall = (
  difficulty: number,
  stability: number,
  r: number,
  g: Rating,
): number => {
  const hardPenalty = g === 2 ? w(15) : 1;
  const easyBonus = g === 4 ? w(16) : 1;
  const inc =
    Math.exp(w(8)) *
    (11 - difficulty) *
    Math.pow(stability, -w(9)) *
    (Math.exp(w(10) * (1 - r)) - 1) *
    hardPenalty *
    easyBonus;
  return clamp(stability * (1 + inc), S_MIN, S_MAX);
};

const stabilityAfterLapse = (difficulty: number, stability: number, r: number): number => {
  const sLapse =
    w(11) *
    Math.pow(difficulty, -w(12)) *
    (Math.pow(stability + 1, w(13)) - 1) *
    Math.exp(w(14) * (1 - r));
  // A lapse must not increase stability.
  return clamp(Math.min(sLapse, stability), S_MIN, S_MAX);
};

/** Same-day / in-learning short-term stability update (FSRS-6). */
const stabilityShortTerm = (stability: number, g: Rating): number =>
  clamp(stability * Math.exp(w(17) * (g - 3 + w(18))) * Math.pow(stability, -w(19)), S_MIN, S_MAX);

// ── Service ──────────────────────────────────────────────────────────────────

/** Never schedule shorter than a minute out, even for tiny stabilities. */
const MIN_INTERVAL_MS = 60_000;
const nextIntervalMsForStability = (stability: number): number =>
  Math.max(MIN_INTERVAL_MS, Math.round(intervalDays(stability) * DAY_MS));

function applyReview(state: WordSchedulingState, rating: Rating, now: number): WordSchedulingState {
  // A New word (no stability) is bootstrapped via the initial path.
  if (state.stability === undefined) {
    return seed(rating, now, { userId: state.userId, wordId: state.wordId }, state);
  }

  const elapsedDays = Math.max(0, (now - state.lastReviewAt) / DAY_MS);
  const r = retrievabilityAt(elapsedDays, state.stability);
  const difficulty = nextDifficulty(state.difficulty, rating);
  const wasLearning = state.learningStep > 0;

  let stability: number;
  let learningStep: number;
  let dueAt: number;
  let lapses = state.lapses;

  if (rating === 1) {
    // Lapse → relearning on the short ladder step.
    stability = stabilityAfterLapse(state.difficulty, state.stability, r);
    lapses += 1;
    learningStep = 1;
    dueAt = now + FIRST_DISPLAY_LADDER_MS[1];
  } else {
    const success =
      elapsedDays < 1 || wasLearning
        ? stabilityShortTerm(state.stability, rating)
        : stabilityAfterRecall(state.difficulty, state.stability, r, rating);
    stability = success;
    if (wasLearning && rating === 2) {
      // Hard keeps the word in learning on the 1-day ladder step.
      learningStep = 1;
      dueAt = now + FIRST_DISPLAY_LADDER_MS[2];
    } else {
      learningStep = 0;
      dueAt = now + nextIntervalMsForStability(stability);
    }
  }

  return {
    ...state,
    stability,
    difficulty,
    reps: state.reps + 1,
    lapses,
    learningStep,
    lastReviewAt: now,
    dueAt,
    lastSource: 'review',
  };
}

function seed(
  rating: Rating,
  now: number,
  identity: { userId: UserId; wordId: string },
  prior?: WordSchedulingState,
): WordSchedulingState {
  const stability = initialStability(rating);
  const difficulty = initialDifficulty(rating);
  const graduating = rating >= 3;
  return {
    userId: identity.userId,
    wordId: identity.wordId,
    stability,
    difficulty,
    reps: (prior?.reps ?? 0) + 1,
    lapses: (prior?.lapses ?? 0) + (rating === 1 ? 1 : 0),
    learningStep: graduating ? 0 : 1,
    lastReviewAt: now,
    dueAt: now + FIRST_DISPLAY_LADDER_MS[rating],
    lastSource: 'review',
    mastery: 'Learning',
    reappearCount: prior?.reappearCount ?? 0,
  };
}

export const fsrs: FsrsScheduler = {
  initial(rating, now, identity) {
    return seed(rating, now, identity);
  },

  review(state, rating, now) {
    return applyReview(state, rating, now);
  },

  simulate(state, rating, now) {
    return applyReview(state, rating, now);
  },

  retrievability(state, now) {
    if (state.stability === undefined) return 0;
    const elapsedDays = Math.max(0, (now - state.lastReviewAt) / DAY_MS);
    return clamp(retrievabilityAt(elapsedDays, state.stability), 0, 1);
  },

  nextIntervalMs(state) {
    if (state.stability === undefined) return FIRST_DISPLAY_LADDER_MS[3];
    return nextIntervalMsForStability(state.stability);
  },

  repsToConsolidate(state) {
    let s = state.stability ?? initialStability(3);
    let d = state.difficulty || initialDifficulty(3);
    let count = 0;
    while (s <= S_CONSOLIDATE && count < REPS_CAP) {
      // Ideal cadence: review exactly at due, where R = the desired retention.
      s = stabilityAfterRecall(d, s, DESIRED_RETENTION, 3);
      d = nextDifficulty(d, 3);
      count += 1;
    }
    return count;
  },
};
