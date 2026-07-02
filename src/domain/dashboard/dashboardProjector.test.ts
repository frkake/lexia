import { describe, it, expect } from 'vitest';
import { dashboardProjector } from './dashboardProjector';
import { DAY_MS, HOUR_MS } from '../srs/parameters';
import type { UserId, WordSchedulingState, ReadingProgress, ReviewLogEntry, LearningIntent } from '../../types/domain';
import type { PassageRecord } from '../../types/ports';

const U = 'u1' as UserId;
const NOW = 10 * DAY_MS + 5 * HOUR_MS; // 5h into day #10

function sched(wordId: string, over: Partial<WordSchedulingState>): WordSchedulingState {
  return {
    userId: U,
    wordId,
    stability: 5,
    difficulty: 5,
    reps: 1,
    lapses: 0,
    learningStep: 0,
    lastReviewAt: 0,
    dueAt: NOW + 100 * DAY_MS,
    lastSource: 'review',
    mastery: 'Learning',
    reappearCount: 0,
    ...over,
  };
}

function log(wordId: string, at: number): ReviewLogEntry {
  return { userId: U, wordId, rating: 3, source: 'review', at };
}

function passageRecord(passageId: string, createdAt: number, title: string, intent: LearningIntent): PassageRecord {
  return {
    passageId,
    userId: U,
    createdAt,
    passage: {
      meta: { title, intent, level: 'B1', newCount: 0, reviewCount: 0, approxWords: 0 },
      sentences: [],
      targetSpans: [],
      collocationSpans: [],
      noticeCues: [],
    },
  };
}

const states: WordSchedulingState[] = [
  (() => {
    const s = sched('new1', { mastery: 'New' });
    delete s.stability;
    return s;
  })(),
  sched('learn1', { stability: 3, mastery: 'Learning', dueAt: NOW - 1_000 }),
  sched('consol1', { stability: 10, mastery: 'Consolidating' }),
  sched('master1', { stability: 40, lapses: 0, mastery: 'Mastered' }),
  sched('dueToday', { stability: 5, mastery: 'Learning', dueAt: NOW + 2 * HOUR_MS }),
];

const logs: ReviewLogEntry[] = [
  log('learn1', NOW - 1_000), // day 10 (today)
  log('learn1', 9 * DAY_MS + HOUR_MS), // day 9
  log('consol1', 8 * DAY_MS + HOUR_MS), // day 8
  log('master1', 6 * DAY_MS), // day 6 (day 7 is a gap)
];

const progress: ReadingProgress[] = [
  { userId: U, passageId: 'p1', sentenceIndex: 2, percent: 40, status: 'in_progress', startedAt: NOW - 2 * DAY_MS },
  { userId: U, passageId: 'p2', sentenceIndex: 9, percent: 100, status: 'completed', startedAt: NOW - 3 * DAY_MS },
];

const passages: PassageRecord[] = [
  passageRecord('p1', NOW - 2 * DAY_MS, 'Story One', 'travel'),
  passageRecord('p2', NOW - 3 * DAY_MS, 'Story Two', 'business'),
];

describe('DashboardProjector', () => {
  const snap = dashboardProjector.project({ now: NOW, states, progress, log: logs, passages });

  it('breaks mastery down across the four stages plus total', () => {
    expect(snap.mastery).toEqual({ new: 1, learning: 2, consolidating: 1, mastered: 1, total: 5 });
  });

  it("counts words due by end of today, excluding New words", () => {
    expect(snap.dueTodayCount).toBe(2); // learn1 + dueToday
    expect(snap.dueList.map((d) => d.wordId)).toEqual(['learn1', 'dueToday']); // due-soonest first
  });

  it('computes the current streak as consecutive active days ending today', () => {
    expect(snap.streakDays).toBe(3); // days 10, 9, 8 (day 7 gap)
  });

  it('reports a 7-day weekly activity window oldest-first', () => {
    expect(snap.weekly).toHaveLength(7);
    expect(snap.weekly.map((d) => d.reviewCount)).toEqual([0, 0, 1, 0, 1, 1, 1]); // days 4..10
    expect(snap.weekly[6]!.dayStartMs).toBe(10 * DAY_MS);
  });

  it('lists in-progress reading with resolved passage metadata', () => {
    expect(snap.reading).toHaveLength(1);
    expect(snap.reading[0]).toMatchObject({ passageId: 'p1', title: 'Story One', percent: 40, sentenceIndex: 2 });
  });

  it('caps in-progress reading at readingLimit, newest-started first (default 3)', () => {
    const many: ReadingProgress[] = Array.from({ length: 6 }, (_, i) => ({
      userId: U,
      passageId: `r${i}`,
      sentenceIndex: 0,
      percent: 10,
      status: 'in_progress' as const,
      startedAt: NOW - i * HOUR_MS, // r0 newest … r5 oldest
    }));
    const manyPassages = many.map((p, i) => passageRecord(p.passageId, p.startedAt, `Reading ${i}`, 'travel'));

    const capped = dashboardProjector.project({ now: NOW, states, progress: many, log: logs, passages: manyPassages });
    expect(capped.reading.map((r) => r.passageId)).toEqual(['r0', 'r1', 'r2']); // default cap = 3

    const limited = dashboardProjector.project({
      now: NOW,
      states,
      progress: many,
      log: logs,
      passages: manyPassages,
      readingLimit: 1,
    });
    expect(limited.reading.map((r) => r.passageId)).toEqual(['r0']); // only the most-recent resume
  });
});
