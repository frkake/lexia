/**
 * L1 — single source of truth for learning-scheduling parameters.
 *
 * Every scheduling / validation rule reads its constants from here; no other module
 * may redefine them (design.md "FsrsScheduler → Implementation Notes": one settings
 * module). The product-loop policy these encode — passive-recall weighting, review
 * load limits, new-word cap, leech threshold — is specified in `docs/learning-policy.md`
 * (the "設定値" table); its ◎-marked rows are reconciled against these exports by
 * `parameters.policy.test.ts`. Three groups:
 *  - FSRS-6 defaults & stage thresholds (published algorithm constants).
 *  - Learning-loop policy limits (canonical values from learning-policy.md §設定値).
 *  - "Unvalidated" product constants — estimates to be re-tuned against real data
 *    (calibration procedure: learning-policy.md §較正); kept here, clearly labelled,
 *    never inlined elsewhere.
 */

import type { Rating } from '../../types/domain';

// ── Time units (ms) ──────────────────────────────────────────────────────────
export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

// ── FSRS-6 ───────────────────────────────────────────────────────────────────

/**
 * FSRS-6 default weights `w[0..20]` (open-spaced-repetition reference defaults).
 * Index map:
 *  - w[0..3]  initial stability per grade (Again/Hard/Good/Easy)
 *  - w[4..5]  initial difficulty
 *  - w[6..7]  difficulty update + mean reversion
 *  - w[8..10] stability increase on successful recall
 *  - w[11..14] post-lapse stability
 *  - w[15]    hard penalty, w[16] easy bonus
 *  - w[17..19] same-day (short-term) stability
 *  - w[20]    forgetting-curve decay term (FSRS-6)
 *
 * NOTE: research.md links the source but does not pin the array; these are the
 * canonical FSRS-6 defaults and are tunable (no per-user optimization is run).
 */
export const FSRS_DEFAULT_WEIGHTS = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
  0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
] as const;

/** Desired retrievability (request retention). S is the days until R falls to Rd. */
export const DESIRED_RETENTION = 0.9;

/** Stability (days) at which a word becomes Consolidating. */
export const S_CONSOLIDATE = 7;
/** Stability (days) at which a word becomes Mastered. */
export const S_MASTER = 30;

/**
 * First-display ladder: overrides the formula's short intervals while a word is in
 * its learning steps (design.md). Again 10m / Hard 1d / Good 4d / Easy 10d.
 */
export const FIRST_DISPLAY_LADDER_MS: Record<Rating, number> = {
  1: 10 * MINUTE_MS,
  2: 1 * DAY_MS,
  3: 4 * DAY_MS,
  4: 10 * DAY_MS,
};

// ── Learning-loop policy limits (canonical: docs/learning-policy.md §設定値) ──
// ◎ CI-reconciled product constants for the review / generation loop. C-5b/C-5c
// read these from here (single source of truth); parameters.policy.test.ts checks
// they still match the policy document's 設定値 table.

/** Max review cards surfaced in one session (load design; policy principle 7). */
export const SESSION_REVIEW_LIMIT = 20;

/** Max review cards graded per day; overflow rolls to the next day (settable 20–200). */
export const DAILY_REVIEW_LIMIT = 60;

/** Max new words introduced per day; the newWordRatio slider is clamped to this. */
export const DAILY_NEW_WORD_LIMIT = 12;

/** Lapse count at/above which a word is treated as a leech (elaboration mode). */
export const LEECH_LAPSE_THRESHOLD = 6;

// ── Unvalidated product constants (re-tune with real data) ───────────────────

/**
 * Passive-recall damping: a tap-free read-through grades as a damped Good,
 * `S' = S + PASSIVE_RECALL_DECAY · (S_good − S)` (design.md "RecallEventService").
 * UNVALIDATED — estimate. 較正手順: learning-policy.md §較正.
 */
export const PASSIVE_RECALL_DECAY = 0.5;

/**
 * Cooldown window for passage-origin updates of the same word, preventing
 * double-counting with a same-day explicit review. UNVALIDATED — estimate.
 * 較正手順: learning-policy.md §較正.
 */
export const DAILY_COOLDOWN_MS = DAY_MS;

/**
 * Allowed ratio of out-of-band (above target CEFR level) tokens in a generated
 * passage before the generation is repaired/regenerated. UNVALIDATED — estimate.
 * 較正手順: learning-policy.md §較正.
 */
export const CEFR_OUT_OF_BAND_TOLERANCE = 0.15;
