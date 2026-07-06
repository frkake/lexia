/**
 * L1 — DashboardProjector: derives the DashboardSnapshot from scheduling state,
 * reading progress, the review log and passages (design.md "DashboardProjector").
 * Pure — the caller fetches the fixtures, the projector computes the view model:
 *   - 4-stage mastery breakdown + total;
 *   - words due by end of today (+ a due list);
 *   - current streak and a 7-day weekly activity window (split by log source: review vs reading);
 *   - in-progress reading ("最近開いた文章"), newest-opened first (capped at readingLimit).
 * Day bucketing is offset-aware (F-4): `tzOffsetMinutes` shifts the midnight boundary to the
 * learner's local day, so a JST 0:30 study still lands on the same calendar day. It defaults to 0
 * (UTC), keeping the projector deterministic under test.
 */

import { masteryProjector } from '../srs/masteryProjector';
import { isDueForReview } from '../srs/dueState';
import { startOfLocalDay } from '../srs/dayBoundary';
import { DAY_MS } from '../srs/parameters';
import type { Cefr, MasteryStage, ReadingProgress, ReviewLogEntry, WordSchedulingState } from '../../types/domain';
import type { PassageRecord } from '../../types/ports';

export interface MasteryBreakdown {
  new: number;
  learning: number;
  consolidating: number;
  mastered: number;
  total: number;
}

export interface DueWordItem {
  wordId: string;
  dueAt: number;
  mastery: MasteryStage;
}

export interface WeeklyActivityDay {
  dayStartMs: number;
  /** Explicit-review-origin events, net of same-day undos (F-3 series 1: 復習). */
  reviewCount: number;
  /** Reading-origin events — lookup / read-through /「知らなかった」(F-3 series 2: 読解由来). */
  readingCount: number;
}

export interface ReadingNowItem {
  passageId: string;
  title: string;
  level?: Cefr;
  percent: number;
  sentenceIndex: number;
}

export interface DashboardSnapshot {
  dueTodayCount: number;
  mastery: MasteryBreakdown;
  reading: ReadingNowItem[];
  weekly: WeeklyActivityDay[];
  dueList: DueWordItem[];
  streakDays: number;
}

export interface DashboardInput {
  now: number;
  states: WordSchedulingState[];
  progress: ReadingProgress[];
  log: ReviewLogEntry[];
  /** Passages backing the in-progress reading cards (used to resolve titles / levels). */
  passages: PassageRecord[];
  /** Max in-progress "continue reading" items to include, newest-opened first (default 3). */
  readingLimit?: number;
  /** Weekly window length in days (default 7). */
  weeklyDays?: number;
  /**
   * Learner's local offset from UTC in minutes (F-4). East of UTC is positive (JST = +540). The
   * day boundary is shifted by this offset so streak / weekly / labels track the learner's calendar
   * day. Defaults to 0 (UTC) — existing callers stay unchanged.
   */
  tzOffsetMinutes?: number;
}

export interface DashboardProjector {
  project(input: DashboardInput): DashboardSnapshot;
}

// F-4: day bucketing delegates to the shared `startOfLocalDay` rule (dayBoundary.ts) so the
// dashboard's local-day boundary can never drift from the review / new-word daily budgets. A
// positive offset (east of UTC) shifts the boundary earlier so e.g. JST 0:30 buckets into the
// same day; offset 0 is the UTC boundary (unchanged default).

const STAGE_KEY: Record<MasteryStage, keyof Omit<MasteryBreakdown, 'total'>> = {
  New: 'new',
  Learning: 'learning',
  Consolidating: 'consolidating',
  Mastered: 'mastered',
};

function project(input: DashboardInput): DashboardSnapshot {
  const { now, states, progress, log, passages } = input;
  const readingLimit = input.readingLimit ?? 3;
  const weeklyDays = input.weeklyDays ?? 7;
  const tzOffsetMinutes = input.tzOffsetMinutes ?? 0;
  const day = (t: number): number => startOfLocalDay(t, tzOffsetMinutes);
  const today = day(now);

  // Mastery breakdown (re-derived so the snapshot reflects the latest stability).
  const mastery: MasteryBreakdown = { new: 0, learning: 0, consolidating: 0, mastered: 0, total: states.length };
  for (const s of states) {
    mastery[STAGE_KEY[masteryProjector.deriveMastery(s, { kind: 'none' })]] += 1;
  }

  // Due now (C-5b): the SAME `isDueForReview` predicate the /review queue uses, so the home
  // "今日の復習 N 語" count and the session's card total agree by construction (they can differ only
  // by SESSION_REVIEW_LIMIT). Seeded New words (stability undefined) are excluded regardless of
  // dueAt; not-yet-arrived reviews (dueAt > now) surface once their time comes, in both places.
  const due = states
    .filter((s) => isDueForReview(s, now))
    .sort((a, b) => a.dueAt - b.dueAt);
  const dueList: DueWordItem[] = due.map((s) => ({ wordId: s.wordId, dueAt: s.dueAt, mastery: s.mastery }));

  // Weekly activity window (oldest day first) + streak day set.
  // F-3: a day is "active" if the learner did ANY real study — an explicit review, a reading-time
  // signal, opening a passage to read (ReadingProgress.lastOpenedAt), or generating one (createdAt) —
  // so a review-free reading day no longer breaks the streak. The weekly bars are split by log
  // source: explicit reviews (net of same-day undos) vs reading-origin passage credits.
  const activeDays = new Set<number>();
  const reviewPerDay = new Map<number, number>();
  const readingPerDay = new Map<number, number>();
  for (const e of log) {
    const d = day(e.at);
    activeDays.add(d);
    if (e.source === 'passage') readingPerDay.set(d, (readingPerDay.get(d) ?? 0) + 1);
    else if (e.source === 'undo') reviewPerDay.set(d, (reviewPerDay.get(d) ?? 0) - 1);
    else reviewPerDay.set(d, (reviewPerDay.get(d) ?? 0) + 1);
  }
  for (const p of progress) activeDays.add(day(p.lastOpenedAt));
  for (const p of passages) activeDays.add(day(p.createdAt));

  const weekly: WeeklyActivityDay[] = [];
  for (let i = weeklyDays - 1; i >= 0; i -= 1) {
    const dayStartMs = today - i * DAY_MS;
    weekly.push({
      dayStartMs,
      reviewCount: Math.max(0, reviewPerDay.get(dayStartMs) ?? 0),
      readingCount: readingPerDay.get(dayStartMs) ?? 0,
    });
  }

  // Streak: consecutive active days ending today (or yesterday if today is idle).
  let streakDays = 0;
  let cursor: number | null = activeDays.has(today)
    ? today
    : activeDays.has(today - DAY_MS)
      ? today - DAY_MS
      : null;
  while (cursor !== null && activeDays.has(cursor)) {
    streakDays += 1;
    cursor -= DAY_MS;
  }

  // In-progress reading, newest-OPENED first (F-2: follows real reading activity, not the fixed
  // generation/first-start time), titles resolved from passages.
  const passageById = new Map(passages.map((p) => [p.passageId, p]));
  const reading: ReadingNowItem[] = progress
    .filter((p) => p.status === 'in_progress')
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .slice(0, readingLimit)
    .map((p) => {
      const meta = passageById.get(p.passageId)?.passage.meta;
      return {
        passageId: p.passageId,
        title: meta?.title ?? p.passageId,
        level: meta?.level,
        percent: p.percent,
        sentenceIndex: p.sentenceIndex,
      };
    });

  return { dueTodayCount: due.length, mastery, reading, weekly, dueList, streakDays };
}

export const dashboardProjector: DashboardProjector = { project };
