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
  { userId: U, passageId: 'p1', sentenceIndex: 2, percent: 40, status: 'in_progress', startedAt: NOW - 2 * DAY_MS, lastOpenedAt: NOW - 2 * DAY_MS },
  { userId: U, passageId: 'p2', sentenceIndex: 9, percent: 100, status: 'completed', startedAt: NOW - 3 * DAY_MS, lastOpenedAt: NOW - 3 * DAY_MS },
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

  it('counts words currently due (dueAt ≤ now), excluding New and not-yet-due words', () => {
    // C-5b unifies the count with the /review queue via `isDueForReview`: learn1 is due now
    // (dueAt = NOW-1000), while dueToday is scheduled for LATER today (NOW+2h) and so is not yet
    // due — a later-today review no longer inflates "今日の復習" (it surfaces once its time comes).
    expect(snap.dueTodayCount).toBe(1);
    expect(snap.dueList.map((d) => d.wordId)).toEqual(['learn1']);
  });

  it('computes the current streak as consecutive active days ending today', () => {
    // F-3: reading activity now counts too — p2's lastOpenedAt / createdAt on day 7 fills what used
    // to be the day-7 gap, so the composed streak is days 10, 9, 8, 7, 6 (day 5 idle).
    expect(snap.streakDays).toBe(5);
  });

  it('reports a 7-day weekly activity window oldest-first, split by source', () => {
    expect(snap.weekly).toHaveLength(7);
    // The shared log is entirely explicit reviews, so the reading series is empty here.
    expect(snap.weekly.map((d) => d.reviewCount)).toEqual([0, 0, 1, 0, 1, 1, 1]); // days 4..10
    expect(snap.weekly.every((d) => d.readingCount === 0)).toBe(true);
    expect(snap.weekly[6]!.dayStartMs).toBe(10 * DAY_MS);
  });

  it('lists in-progress reading with resolved passage metadata', () => {
    expect(snap.reading).toHaveLength(1);
    expect(snap.reading[0]).toMatchObject({ passageId: 'p1', title: 'Story One', percent: 40, sentenceIndex: 2 });
  });

  // Regression (A-1-2): a passage-seeded word (stability undefined, dueAt = now+1day) must not
  // inflate "今日の復習" — the projector already gates dueTodayCount on `stability !== undefined`.
  it('does not count freshly-seeded New words (stability undefined, next-day dueAt) as due today', () => {
    const seeded: WordSchedulingState = {
      userId: U,
      wordId: 'seed1',
      difficulty: 0,
      reps: 0,
      lapses: 0,
      learningStep: 0,
      lastReviewAt: 0,
      dueAt: NOW + DAY_MS, // A-1-2 next-day seed
      lastSource: 'passage',
      mastery: 'New',
      reappearCount: 0,
    };
    delete seeded.stability;
    const withSeed = dashboardProjector.project({ now: NOW, states: [...states, seeded], progress, log: logs, passages });
    expect(withSeed.dueTodayCount).toBe(1); // unchanged: still only learn1
    expect(withSeed.dueList.map((d) => d.wordId)).toEqual(['learn1']);
    expect(withSeed.mastery.new).toBe(2); // new1 + seed1 counted in the breakdown, not in "due"
  });

  it('caps in-progress reading at readingLimit, newest-OPENED first (default 3)', () => {
    // lastOpenedAt (not startedAt) decides order: startedAt is set in the OPPOSITE order to prove
    // the projector sorts by real open time (F-2) — r0 was started earliest yet opened most recently.
    const many: ReadingProgress[] = Array.from({ length: 6 }, (_, i) => ({
      userId: U,
      passageId: `r${i}`,
      sentenceIndex: 0,
      percent: 10,
      status: 'in_progress' as const,
      startedAt: NOW - (5 - i) * HOUR_MS, // r0 oldest-started … r5 newest-started
      lastOpenedAt: NOW - i * HOUR_MS, // r0 newest-opened … r5 oldest-opened
    }));
    const manyPassages = many.map((p, i) => passageRecord(p.passageId, p.startedAt, `Reading ${i}`, 'travel'));

    const capped = dashboardProjector.project({ now: NOW, states, progress: many, log: logs, passages: manyPassages });
    expect(capped.reading.map((r) => r.passageId)).toEqual(['r0', 'r1', 'r2']); // default cap = 3, by lastOpenedAt

    const limited = dashboardProjector.project({
      now: NOW,
      states,
      progress: many,
      log: logs,
      passages: manyPassages,
      readingLimit: 1,
    });
    expect(limited.reading.map((r) => r.passageId)).toEqual(['r0']); // only the most-recently-opened resume
  });
});

describe('DashboardProjector — activity composition (F-3)', () => {
  it('continues the streak on a review-free day spent only reading (lastOpenedAt)', () => {
    // No review or read-through logged today; the sole signal is having opened a passage to read.
    const yesterdayReview = [log('w', 9 * DAY_MS + HOUR_MS)];
    const openedToday: ReadingProgress[] = [
      { userId: U, passageId: 'p', sentenceIndex: 3, percent: 30, status: 'in_progress', startedAt: 9 * DAY_MS, lastOpenedAt: NOW - HOUR_MS },
    ];
    const snap = dashboardProjector.project({ now: NOW, states: [], progress: openedToday, log: yesterdayReview, passages: [] });
    expect(snap.streakDays).toBe(2); // today (reading) + yesterday (review)
    expect(snap.weekly[snap.weekly.length - 1]!.reviewCount).toBe(0); // reading carries no review credit
    expect(snap.weekly[snap.weekly.length - 1]!.readingCount).toBe(0); // an open with no SRS log is not a bar credit
  });

  it('folds passage createdAt into active days (generating counts as activity)', () => {
    const generatedToday: PassageRecord[] = [passageRecord('p', NOW - 2 * HOUR_MS, 'Fresh', 'daily')];
    const snap = dashboardProjector.project({ now: NOW, states: [], progress: [], log: [], passages: generatedToday });
    expect(snap.streakDays).toBe(1);
  });

  it('splits the weekly bars by log source and nets same-day undos out of the review series', () => {
    const at = 10 * DAY_MS + HOUR_MS; // day 10 (today)
    const mixed: ReviewLogEntry[] = [
      { userId: U, wordId: 'a', rating: 3, source: 'review', at },
      { userId: U, wordId: 'b', rating: 3, source: 'review', at },
      { userId: U, wordId: 'b', rating: 3, source: 'undo', at }, // cancels one review
      { userId: U, wordId: 'c', rating: 1, source: 'passage', at }, // 「知らなかった」/ lookup
      { userId: U, wordId: 'd', rating: 3, source: 'passage', at }, // read-through
    ];
    const snap = dashboardProjector.project({ now: NOW, states: [], progress: [], log: mixed, passages: [] });
    const today = snap.weekly[snap.weekly.length - 1]!;
    expect(today.reviewCount).toBe(1); // 2 reviews − 1 undo
    expect(today.readingCount).toBe(2); // two reading-origin credits — pressing「知らなかった」never adds to 復習
  });
});

describe('DashboardProjector — local timezone bucketing (F-4)', () => {
  const JST = 540; // minutes east of UTC
  const jstMidnight = 100 * DAY_MS - 9 * HOUR_MS; // a JST 00:00 (== UTC 15:00 the previous day)
  const lateNightReview = [log('w', jstMidnight + 30 * 60_000)]; // JST 00:30
  const nowJst = jstMidnight + 10 * HOUR_MS; // JST 10:00 the same local day

  it('buckets a JST 00:30 review into the PREVIOUS calendar day under UTC (offset 0)', () => {
    const snap = dashboardProjector.project({ now: nowJst, states: [], progress: [], log: lateNightReview, passages: [] });
    expect(snap.weekly[snap.weekly.length - 1]!.reviewCount).toBe(0); // today's bar is empty
    expect(snap.weekly[snap.weekly.length - 2]!.reviewCount).toBe(1); // it lands on "yesterday"
  });

  it('counts the same review on the current local day with tzOffsetMinutes=540, keeping today active', () => {
    const snap = dashboardProjector.project({
      now: nowJst,
      states: [],
      progress: [],
      log: lateNightReview,
      passages: [],
      tzOffsetMinutes: JST,
    });
    const today = snap.weekly[snap.weekly.length - 1]!;
    expect(today.dayStartMs).toBe(jstMidnight); // today's bucket is the JST midnight
    expect(today.reviewCount).toBe(1); // counted TODAY, not yesterday
    expect(snap.streakDays).toBe(1); // today is active → the streak continues
  });

  it('is identical to the default (UTC) projection when tzOffsetMinutes is 0', () => {
    const withDefault = dashboardProjector.project({ now: NOW, states, progress, log: logs, passages });
    const explicitZero = dashboardProjector.project({ now: NOW, states, progress, log: logs, passages, tzOffsetMinutes: 0 });
    expect(explicitZero).toEqual(withDefault);
  });
});
