/**
 * L1 — DashboardProjector: derives the DashboardSnapshot from scheduling state,
 * reading progress, the review log and recent passages (design.md "DashboardProjector").
 * Pure — the caller fetches the fixtures, the projector computes the view model:
 *   - 4-stage mastery breakdown + total;
 *   - words due by end of today (+ a due list);
 *   - current streak and a 7-day weekly activity window;
 *   - in-progress reading and recently read passages.
 * Day bucketing uses UTC midnight boundaries so it is deterministic under test.
 */

import { masteryProjector } from '../srs/masteryProjector';
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
  reviewCount: number;
}

export interface ReadingNowItem {
  passageId: string;
  title: string;
  level?: Cefr;
  percent: number;
  sentenceIndex: number;
}

export interface RecentPassageItem {
  passageId: string;
  title: string;
  theme: string;
  createdAt: number;
  completed: boolean;
}

export interface DashboardSnapshot {
  dueTodayCount: number;
  mastery: MasteryBreakdown;
  reading: ReadingNowItem[];
  weekly: WeeklyActivityDay[];
  dueList: DueWordItem[];
  streakDays: number;
  recent: RecentPassageItem[];
}

export interface DashboardInput {
  now: number;
  states: WordSchedulingState[];
  progress: ReadingProgress[];
  log: ReviewLogEntry[];
  passages: PassageRecord[];
  /** Max recently-read passages to include (default 5). */
  recentLimit?: number;
  /** Weekly window length in days (default 7). */
  weeklyDays?: number;
}

export interface DashboardProjector {
  project(input: DashboardInput): DashboardSnapshot;
}

const startOfDay = (t: number): number => Math.floor(t / DAY_MS) * DAY_MS;

const STAGE_KEY: Record<MasteryStage, keyof Omit<MasteryBreakdown, 'total'>> = {
  New: 'new',
  Learning: 'learning',
  Consolidating: 'consolidating',
  Mastered: 'mastered',
};

function project(input: DashboardInput): DashboardSnapshot {
  const { now, states, progress, log, passages } = input;
  const recentLimit = input.recentLimit ?? 5;
  const weeklyDays = input.weeklyDays ?? 7;
  const today = startOfDay(now);
  const endOfToday = today + DAY_MS;

  // Mastery breakdown (re-derived so the snapshot reflects the latest stability).
  const mastery: MasteryBreakdown = { new: 0, learning: 0, consolidating: 0, mastered: 0, total: states.length };
  for (const s of states) {
    mastery[STAGE_KEY[masteryProjector.deriveMastery(s, { kind: 'none' })]] += 1;
  }

  // Due today (learned words only) + due list, due-soonest first.
  const due = states
    .filter((s) => s.stability !== undefined && s.dueAt < endOfToday)
    .sort((a, b) => a.dueAt - b.dueAt);
  const dueList: DueWordItem[] = due.map((s) => ({ wordId: s.wordId, dueAt: s.dueAt, mastery: s.mastery }));

  // Weekly activity window (oldest day first).
  const activeDays = new Set<number>();
  const perDay = new Map<number, number>();
  for (const e of log) {
    const day = startOfDay(e.at);
    activeDays.add(day);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const weekly: WeeklyActivityDay[] = [];
  for (let i = weeklyDays - 1; i >= 0; i -= 1) {
    const dayStartMs = today - i * DAY_MS;
    weekly.push({ dayStartMs, reviewCount: perDay.get(dayStartMs) ?? 0 });
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

  // In-progress reading, newest-started first, titles resolved from passages.
  const passageById = new Map(passages.map((p) => [p.passageId, p]));
  const reading: ReadingNowItem[] = progress
    .filter((p) => p.status === 'in_progress')
    .sort((a, b) => b.startedAt - a.startedAt)
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

  // Recently read passages, newest-created first, with completion flags.
  const completed = new Set(progress.filter((p) => p.status === 'completed').map((p) => p.passageId));
  const recent: RecentPassageItem[] = [...passages]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, recentLimit)
    .map((p) => ({
      passageId: p.passageId,
      title: p.passage.meta.title,
      theme: p.passage.meta.theme,
      createdAt: p.createdAt,
      completed: completed.has(p.passageId),
    }));

  return { dueTodayCount: due.length, mastery, reading, weekly, dueList, streakDays, recent };
}

export const dashboardProjector: DashboardProjector = { project };
