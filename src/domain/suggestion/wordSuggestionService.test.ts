import { describe, it, expect } from 'vitest';
import { createWordSuggestionService, SUGGESTION_PROPOSAL_TTL_MS } from './wordSuggestionService';
import { DAY_MS } from '../srs/parameters';
import type { CachedSuggestion, ContentGateway, SchedulingRepository, SuggestionCacheRepository } from '../../types/ports';
import type { UserId, WordSchedulingState } from '../../types/domain';

const U = 'u1' as UserId;

function sched(wordId: string, over: Partial<WordSchedulingState> = {}): WordSchedulingState {
  return {
    userId: U,
    wordId,
    stability: 5,
    difficulty: 5,
    reps: 1,
    lapses: 0,
    learningStep: 0,
    lastReviewAt: 0,
    dueAt: 0,
    lastSource: 'review',
    mastery: 'Learning',
    reappearCount: 0,
    ...over,
  };
}

/** SchedulingRepository stub: only `get` matters (returns a state ⇒ word already introduced). */
function schedRepo(
  introduced: string[],
  options: { due?: WordSchedulingState[]; weak?: WordSchedulingState[] } = {},
): SchedulingRepository {
  const rows = new Map<string, WordSchedulingState>();
  for (const wordId of introduced) rows.set(wordId, sched(wordId));
  for (const state of [...(options.due ?? []), ...(options.weak ?? [])]) rows.set(state.wordId, state);
  return {
    get: async (_u, w) => rows.get(w),
    upsert: async () => {},
    dueBefore: async () => options.due ?? [],
    lowStability: async () => options.weak ?? [],
  };
}

/** ContentGateway stub whose suggestWords returns a fixed list (or throws). */
function gateway(words: string[] | (() => never)): ContentGateway {
  return {
    generatePassage: async () => {
      throw new Error('unused');
    },
    getWordData: async () => {
      throw new Error('unused');
    },
    suggestWords: typeof words === 'function' ? async () => words() : async () => words,
  };
}

describe('WordSuggestionService.suggest', () => {
  it('returns ABC-ordered, deduped candidates excluding introduced and excluded words (5.2/5.3)', async () => {
    const svc = createWordSuggestionService(gateway(['zephyr', 'apple', 'apple', 'mango', 'introduced', 'excluded']));
    const result = await svc.suggest({
      userId: U,
      level: 'B1',
      intent: 'daily',
      now: 1_000,
      excludedWordIds: ['excluded'],
      count: 10,
    }, schedRepo(['introduced']));
    const ids = result.candidates.map((c) => c.wordId);
    expect(ids).toEqual(['apple', 'mango', 'zephyr']); // ABC, deduped, introduced+excluded removed
  });

  it('reports a shortfall (exhausted) when fewer candidates than requested survive filtering (5.5)', async () => {
    const svc = createWordSuggestionService(gateway(['apple', 'introduced']));
    const result = await svc.suggest({
      userId: U,
      level: 'B1',
      intent: 'daily',
      now: 1_000,
      excludedWordIds: [],
      count: 5,
    }, schedRepo(['introduced']));
    expect(result.candidates.map((c) => c.wordId)).toEqual(['apple']);
    expect(result.shortfall).toEqual({ requested: 5, available: 1, reason: 'exhausted' });
  });

  it('reports a gateway_unavailable shortfall and empty candidates when suggestWords throws (5.5)', async () => {
    const svc = createWordSuggestionService(
      gateway(() => {
        throw new Error('503');
      }),
    );
    const result = await svc.suggest({
      userId: U,
      level: 'B1',
      intent: 'daily',
      now: 1_000,
      excludedWordIds: [],
      count: 5,
    }, schedRepo([]));
    expect(result.candidates).toEqual([]);
    expect(result.shortfall?.reason).toBe('gateway_unavailable');
  });

  it('reports a gateway_unavailable shortfall when the gateway cannot suggest at all', async () => {
    const gw: ContentGateway = {
      generatePassage: async () => {
        throw new Error('unused');
      },
      getWordData: async () => {
        throw new Error('unused');
      },
    };
    const svc = createWordSuggestionService(gw);
    const result = await svc.suggest({ userId: U, level: 'B1', intent: 'daily', now: 1_000, excludedWordIds: [], count: 5 }, schedRepo([]));
    expect(result.candidates).toEqual([]);
    expect(result.shortfall?.reason).toBe('gateway_unavailable');
  });

  it('has no shortfall when the requested count is met', async () => {
    const svc = createWordSuggestionService(gateway(['apple', 'mango', 'zephyr']));
    const result = await svc.suggest({ userId: U, level: 'B1', intent: 'daily', now: 1_000, excludedWordIds: [], count: 3 }, schedRepo([]));
    expect(result.candidates).toHaveLength(3);
    expect(result.shortfall).toBeUndefined();
  });

  it('prioritizes due and weak scheduled words before filling with new proposals', async () => {
    const svc = createWordSuggestionService(gateway(['apple', 'mango', 'zephyr']));
    const result = await svc.suggest(
      {
        userId: U,
        level: 'B1',
        intent: 'daily',
        now: 1_000,
        excludedWordIds: [],
        count: 4,
      },
      schedRepo([], {
        due: [sched('due-word', { level: 'B1', dueAt: 500, stability: 3 })],
        weak: [sched('weak-word', { level: 'B1', dueAt: 9_999, stability: 1 })],
      }),
    );
    expect(result.candidates.map((c) => c.wordId)).toEqual(['apple', 'due-word', 'mango', 'weak-word']);
    expect(result.candidates.find((c) => c.wordId === 'due-word')?.reason).toBe('due');
    expect(result.candidates.find((c) => c.wordId === 'weak-word')?.reason).toBe('weak');
  });

  it('never re-weaves a suspended (known-declared) word, from the due or the weak pool (C-5d)', async () => {
    const svc = createWordSuggestionService(gateway(['apple', 'mango', 'zephyr']));
    const result = await svc.suggest(
      { userId: U, level: 'B1', intent: 'daily', now: 1_000, excludedWordIds: [], count: 4 },
      schedRepo([], {
        due: [sched('due-known', { level: 'B1', dueAt: 500, stability: 3, suspended: true })],
        weak: [sched('weak-known', { level: 'B1', dueAt: 9_999, stability: 1, suspended: true })],
      }),
    );
    const ids = result.candidates.map((c) => c.wordId);
    expect(ids).not.toContain('due-known');
    expect(ids).not.toContain('weak-known');
    expect(ids).toEqual(['apple', 'mango', 'zephyr']); // suspended rows leave only fresh proposals
  });

  it('band-filters only NOT-yet-due weak words; due words re-weave regardless of band (C-5b)', async () => {
    // C-5b / issue 8: a due word is re-encountered in context whatever its band, so the +1 filter no
    // longer silently drops it (too-hard is C1 above the B2 target yet still surfaces). The filter
    // still applies to not-yet-due weak words: one-below (B1) fits, too-easy (A2, 2 below) is held.
    const svc = createWordSuggestionService(gateway(['fresh-b2']));
    const result = await svc.suggest(
      {
        userId: U,
        level: 'B2',
        intent: 'daily',
        now: 1_000,
        excludedWordIds: [],
        count: 4,
      },
      schedRepo([], {
        due: [
          sched('at-level', { level: 'B2', dueAt: 500, stability: 3 }),
          sched('too-hard', { level: 'C1', dueAt: 500, stability: 3 }),
        ],
        weak: [
          sched('one-below', { level: 'B1', dueAt: 9_999, stability: 1 }),
          sched('too-easy', { level: 'A2', dueAt: 9_999, stability: 1 }),
        ],
      }),
    );

    expect(result.candidates.map((c) => c.wordId)).toEqual(['at-level', 'fresh-b2', 'one-below', 'too-hard']);
    expect(result.candidates.map((c) => c.wordId)).toContain('too-hard'); // due → not band-filtered
    expect(result.candidates.map((c) => c.wordId)).not.toContain('too-easy'); // weak + 2-below → filtered
  });

  it('uses the injected CEFR lookup to band-filter legacy WEAK rows without a stored level', async () => {
    const svc = createWordSuggestionService(gateway([]), {
      cefrOf: (wordId) => (wordId === 'legacy-fit' ? 'B1' : 'C1'),
    });
    const result = await svc.suggest(
      {
        userId: U,
        level: 'B1',
        intent: 'daily',
        now: 1_000,
        excludedWordIds: [],
        count: 2,
      },
      schedRepo([], {
        // Weak (not-yet-due) rows: the band filter applies, resolved via cefrOf. legacy-hard (C1) is
        // two bands above B1 and is held back; legacy-fit (B1) is kept with its resolved level.
        weak: [sched('legacy-fit', { dueAt: 9_999, stability: 1 }), sched('legacy-hard', { dueAt: 9_999, stability: 1 })],
      }),
    );

    expect(result.candidates.map((c) => c.wordId)).toEqual(['legacy-fit']);
    expect(result.candidates[0]?.level).toBe('B1');
  });

  it('keeps an unknown-level DUE word as a re-weaving candidate (level 不明語は除外しない, D1)', async () => {
    const svc = createWordSuggestionService(gateway([]));
    const result = await svc.suggest(
      {
        userId: U,
        level: 'B1',
        intent: 'daily',
        now: 1_000,
        excludedWordIds: [],
        count: 1,
      },
      schedRepo([], {
        due: [sched('legacy-unknown', { dueAt: 500, stability: 3 })],
      }),
    );

    expect(result.candidates.map((c) => c.wordId)).toEqual(['legacy-unknown']);
    expect(result.candidates[0]?.reason).toBe('due');
    expect(result.candidates[0]?.level).toBeUndefined();
  });

  it('keeps an unknown-level not-yet-due WEAK word too (band filter only drops KNOWN off-band words)', async () => {
    const svc = createWordSuggestionService(gateway([]));
    const result = await svc.suggest(
      {
        userId: U,
        level: 'B1',
        intent: 'daily',
        now: 1_000,
        excludedWordIds: [],
        count: 1,
      },
      schedRepo([], {
        weak: [sched('weak-unknown', { dueAt: 9_999, stability: 1 })],
      }),
    );

    expect(result.candidates.map((c) => c.wordId)).toEqual(['weak-unknown']);
    expect(result.candidates[0]?.reason).toBe('weak');
  });

  it('uses desiredNewCount to cap the presented candidates', async () => {
    const svc = createWordSuggestionService(gateway(['apple', 'mango', 'zephyr']));
    const result = await svc.suggest(
      { userId: U, level: 'B1', intent: 'daily', now: 1_000, excludedWordIds: [], count: 12, desiredNewCount: 2 },
      schedRepo([]),
    );
    expect(result.candidates.map((c) => c.wordId)).toEqual(['apple', 'mango']);
  });
});

describe('WordSuggestionService.suggest — two-slot plan (A-1-3)', () => {
  const base = { userId: U, level: 'B1' as const, intent: 'daily' as const, now: 1_000, excludedWordIds: [], count: 12 };
  const dueWords = (ids: string[]): WordSchedulingState[] => ids.map((id) => sched(id, { level: 'B1', dueAt: 500 }));
  const reasonsOf = (r: { candidates: { reason?: string }[] }) => r.candidates.map((c) => c.reason);

  it('ratio 0 with enough review words returns review-only candidates (no new proposals fetched)', async () => {
    const svc = createWordSuggestionService(gateway(['n1', 'n2', 'n3']));
    const result = await svc.suggest(
      { ...base, plan: { reviewSlots: 5, newSlots: 0 } },
      schedRepo([], { due: dueWords(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']) }),
    );
    expect(result.candidates).toHaveLength(5);
    expect(reasonsOf(result).every((r) => r === 'due')).toBe(true);
    expect(reasonsOf(result)).not.toContain('new');
  });

  it('ratio 0 with too few review words spills the shortfall into new proposals', async () => {
    const svc = createWordSuggestionService(gateway(['n1', 'n2', 'n3', 'n4']));
    const result = await svc.suggest(
      { ...base, plan: { reviewSlots: 5, newSlots: 0 } },
      schedRepo([], { due: dueWords(['d1', 'd2']) }),
    );
    expect(result.candidates).toHaveLength(5); // 2 review + 3 spilled new
    expect(reasonsOf(result).filter((r) => r === 'due')).toHaveLength(2);
    expect(reasonsOf(result).filter((r) => r === 'new')).toHaveLength(3);
  });

  it('ratio 0 with no review words still returns candidates (no candidate-zero passage)', async () => {
    const svc = createWordSuggestionService(gateway(['n1', 'n2', 'n3']));
    const result = await svc.suggest({ ...base, plan: { reviewSlots: 3, newSlots: 0 } }, schedRepo([]));
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(reasonsOf(result).every((r) => r === 'new')).toBe(true);
  });

  it('ratio 1 fills entirely from new proposals even when review words exist', async () => {
    const svc = createWordSuggestionService(gateway(['n1', 'n2', 'n3', 'n4', 'n5', 'n6']));
    const result = await svc.suggest(
      { ...base, plan: { reviewSlots: 0, newSlots: 5 } },
      schedRepo([], { due: dueWords(['d1', 'd2', 'd3']) }),
    );
    expect(result.candidates).toHaveLength(5);
    expect(reasonsOf(result).every((r) => r === 'new')).toBe(true);
  });

  it('ratio 1 with too few new proposals spills back into review words', async () => {
    const svc = createWordSuggestionService(gateway(['n1', 'n2']));
    const result = await svc.suggest(
      { ...base, plan: { reviewSlots: 0, newSlots: 5 } },
      schedRepo([], { due: dueWords(['d1', 'd2', 'd3', 'd4']) }),
    );
    expect(result.candidates).toHaveLength(5); // 2 new + 3 spilled review
    expect(reasonsOf(result).filter((r) => r === 'new')).toHaveLength(2);
    expect(reasonsOf(result).filter((r) => r === 'due')).toHaveLength(3);
  });

  it('ratio 0.3 with total 10 fills exactly 7 review + 3 new when both slots are supplied', async () => {
    const svc = createWordSuggestionService(gateway(['n1', 'n2', 'n3', 'n4', 'n5']));
    const result = await svc.suggest(
      { ...base, plan: { reviewSlots: 7, newSlots: 3 } },
      schedRepo([], { due: dueWords(['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9']) }),
    );
    expect(result.candidates).toHaveLength(10);
    expect(reasonsOf(result).filter((r) => r === 'due')).toHaveLength(7);
    expect(reasonsOf(result).filter((r) => r === 'new')).toHaveLength(3);
  });

  it('ratio 0.3 supplements new when review words are insufficient (7 review shortfall → new)', async () => {
    const svc = createWordSuggestionService(gateway(['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8']));
    const result = await svc.suggest(
      { ...base, plan: { reviewSlots: 7, newSlots: 3 } },
      schedRepo([], { due: dueWords(['d1', 'd2']) }),
    );
    expect(result.candidates).toHaveLength(10); // 2 review + 8 new (3 own + 5 carried over)
    expect(reasonsOf(result).filter((r) => r === 'due')).toHaveLength(2);
    expect(reasonsOf(result).filter((r) => r === 'new')).toHaveLength(8);
  });

  it('excludes a not-yet-due freshly-seeded word (stability undefined, reps 0, dueAt in future) from review slots', async () => {
    const svc = createWordSuggestionService(gateway([]));
    const seeded = sched('seed-future', { level: 'B1', stability: undefined, reps: 0, dueAt: base.now + 1 });
    const result = await svc.suggest(
      { ...base, plan: { reviewSlots: 3, newSlots: 0 } },
      schedRepo([], { due: [seeded] }),
    );
    expect(result.candidates.map((c) => c.wordId)).not.toContain('seed-future');
  });

  it('includes a seeded word once its dueAt has elapsed, as a re-weaving "due" candidate (D1)', async () => {
    const svc = createWordSuggestionService(gateway([]));
    const seeded = sched('seed-elapsed', { level: 'B1', stability: undefined, reps: 0, dueAt: base.now - 1 });
    const result = await svc.suggest(
      { ...base, plan: { reviewSlots: 3, newSlots: 0 } },
      schedRepo([], { due: [seeded] }),
    );
    expect(result.candidates.map((c) => c.wordId)).toEqual(['seed-elapsed']);
    expect(result.candidates[0]?.reason).toBe('due');
  });
});

describe('WordSuggestionService.suggest — daily new-word cap (C-5b)', () => {
  const base = { userId: U, level: 'B1' as const, intent: 'daily' as const, now: 1_000, excludedWordIds: [], count: 12 };
  const dueWords = (ids: string[]): WordSchedulingState[] => ids.map((id) => sched(id, { level: 'B1', dueAt: 500 }));

  /** schedRepo augmented with countSeededSince so the daily clamp engages. */
  function cappedRepo(
    seededToday: number,
    options: { due?: WordSchedulingState[]; weak?: WordSchedulingState[] } = {},
  ): SchedulingRepository {
    return { ...schedRepo([], options), countSeededSince: async () => seededToday };
  }

  it('clamps new words to DAILY_NEW_WORD_LIMIT minus today’s seeds (11 seeded + 6 asked → 1 new)', async () => {
    const svc = createWordSuggestionService(gateway(['n1', 'n2', 'n3', 'n4', 'n5', 'n6']));
    const result = await svc.suggest({ ...base, plan: { reviewSlots: 0, newSlots: 6 } }, cappedRepo(11));
    expect(result.candidates.filter((c) => c.reason === 'new')).toHaveLength(1);
    expect(result.newWordClamp).toEqual({ remaining: 1 });
  });

  it('drops new words to 0 once the daily limit is reached, spilling into review words', async () => {
    const svc = createWordSuggestionService(gateway(['n1', 'n2', 'n3', 'n4']));
    const result = await svc.suggest(
      { ...base, plan: { reviewSlots: 2, newSlots: 4 } },
      cappedRepo(12, { due: dueWords(['d1', 'd2', 'd3', 'd4', 'd5', 'd6']) }),
    );
    expect(result.candidates.every((c) => c.reason !== 'new')).toBe(true);
    expect(result.candidates).toHaveLength(6); // capped-out new slots fell back to review words
    expect(result.newWordClamp).toEqual({ remaining: 0 });
  });

  it('does not clamp (or notify) when today’s seeds leave room for the requested new words', async () => {
    const svc = createWordSuggestionService(gateway(['n1', 'n2', 'n3']));
    const result = await svc.suggest({ ...base, plan: { reviewSlots: 0, newSlots: 3 } }, cappedRepo(2));
    expect(result.candidates.filter((c) => c.reason === 'new')).toHaveLength(3);
    expect(result.newWordClamp).toBeUndefined();
  });

  // Regression (finding #3): the daily new-word cap window must open at the learner's LOCAL midnight
  // (in step with the dashboard, F-4), not UTC midnight. `countSeededSince` must be queried from the
  // local-day boundary so a non-UTC learner's new-word budget resets at their local midnight.
  it('queries countSeededSince from local midnight, not UTC midnight (JST tz +540)', async () => {
    const TZ = 540; // JST minutes east of UTC
    const tzMs = TZ * 60_000;
    const now = 100 * DAY_MS - tzMs + 10 * 60_000; // 00:10 JST — local midnight is 100·DAY − 9h
    let capturedFrom = -1;
    const repo: SchedulingRepository = {
      ...schedRepo([]),
      countSeededSince: async (_u, from) => {
        capturedFrom = from;
        return 0;
      },
    };
    const svc = createWordSuggestionService(gateway(['n1', 'n2', 'n3']));
    await svc.suggest({ ...base, now, tzOffsetMinutes: TZ, plan: { reviewSlots: 0, newSlots: 3 } }, repo);

    const localMidnight = 100 * DAY_MS - tzMs; // startOfLocalDay(now, 540)
    const utcMidnight = Math.floor(now / DAY_MS) * DAY_MS;
    expect(capturedFrom).toBe(localMidnight);
    expect(capturedFrom).not.toBe(utcMidnight); // the pre-fix boundary would have been UTC midnight
  });

  // Seeds introduced the prior local evening (before local midnight, but sharing the SAME UTC day as
  // `now`) must NOT count against the fresh local day's budget. Here they straddle the cap: excluding
  // them (local boundary) leaves room for new words; including them (UTC boundary) exhausts the cap.
  it('does not count prior-local-evening seeds against the new local day (JST tz +540)', async () => {
    const TZ = 540;
    const tzMs = TZ * 60_000;
    const localMidnight = 100 * DAY_MS - tzMs; // startOfLocalDay(now, 540)
    const now = localMidnight + 10 * 60_000; // 00:10 JST (new local day)
    // 10 seeds already introduced TODAY (after local midnight — counted under either boundary) plus 2
    // seeds the prior local evening (before local midnight but same UTC day — counted only under UTC).
    const todaySeeds = Array.from({ length: 10 }, (_v, i) => localMidnight + (i + 1) * 60_000);
    const priorEveningSeeds = [localMidnight - 2 * 60 * 60_000, localMidnight - 60 * 60_000];
    const seededAt = [...todaySeeds, ...priorEveningSeeds];
    // Real countSeededSince counts seeds with seededAt >= from; emulate that against `from`.
    const repo: SchedulingRepository = {
      ...schedRepo([]),
      countSeededSince: async (_u, from) => seededAt.filter((t) => t >= from).length,
    };
    const svc = createWordSuggestionService(gateway(['n1', 'n2', 'n3']));

    // Local boundary (tz +540): only the 10 today-seeds count → cap leaves room for 2 new words.
    const local = await svc.suggest(
      { ...base, now, tzOffsetMinutes: TZ, plan: { reviewSlots: 0, newSlots: 3 } },
      repo,
    );
    expect(local.candidates.filter((c) => c.reason === 'new')).toHaveLength(2);
    expect(local.newWordClamp).toEqual({ remaining: 2 }); // DAILY_NEW_WORD_LIMIT(12) − 10 today-seeds

    // UTC boundary (no offset — the pre-fix bug): the 2 prior-evening seeds leak into "today" → cap
    // exhausted, no new words this generation even though it is a fresh local day.
    const utc = await svc.suggest({ ...base, now, plan: { reviewSlots: 0, newSlots: 3 } }, repo);
    expect(utc.candidates.filter((c) => c.reason === 'new')).toHaveLength(0);
    expect(utc.newWordClamp).toEqual({ remaining: 0 });
  });
});

describe('WordSuggestionService.suggest — shared proposal cache (E-3(c))', () => {
  const base = { userId: U, level: 'B1' as const, intent: 'daily' as const, excludedWordIds: [], count: 12 };
  const T = 1_000_000;

  /** In-memory SuggestionCacheRepository, keyed like the Dexie one ([userId, suggestionKey]). */
  function memoryCache(): SuggestionCacheRepository & { store: Map<string, CachedSuggestion> } {
    const store = new Map<string, CachedSuggestion>();
    return {
      store,
      async get(userId, key) {
        return store.get(`${userId}::${key}`);
      },
      async put(userId, key, entry) {
        store.set(`${userId}::${key}`, { proposals: [...entry.proposals], updatedAt: entry.updatedAt });
      },
    };
  }

  /** ContentGateway whose suggestWords returns a fixed list and counts its calls. */
  function countingGateway(words: string[]): ContentGateway & { calls: () => number } {
    let calls = 0;
    return {
      calls: () => calls,
      generatePassage: async () => {
        throw new Error('unused');
      },
      getWordData: async () => {
        throw new Error('unused');
      },
      suggestWords: async () => {
        calls += 1;
        return words;
      },
    };
  }

  it('serves a fresh, sufficient cached pool without calling the suggestion LLM again', async () => {
    const gw = countingGateway(['n1', 'n2', 'n3']);
    const cache = memoryCache();
    const svc = createWordSuggestionService(gw, { proposalCache: cache });
    const input = { ...base, now: T, plan: { reviewSlots: 0, newSlots: 3 } };

    const first = await svc.suggest(input, schedRepo([]));
    expect(first.candidates.map((c) => c.wordId)).toEqual(['n1', 'n2', 'n3']);
    expect(gw.calls()).toBe(1);
    // The pool was cached under `${level}|${intent}`.
    expect(cache.store.get(`${U}::B1|daily`)?.proposals).toEqual(['n1', 'n2', 'n3']);

    const second = await svc.suggest(input, schedRepo([]));
    expect(second.candidates.map((c) => c.wordId)).toEqual(['n1', 'n2', 'n3']);
    expect(gw.calls()).toBe(1); // cache hit — no second LLM call
  });

  it('refetches once the cached pool has aged past the TTL', async () => {
    const gw = countingGateway(['n1', 'n2', 'n3']);
    const cache = memoryCache();
    const svc = createWordSuggestionService(gw, { proposalCache: cache });
    const plan = { reviewSlots: 0, newSlots: 3 };

    await svc.suggest({ ...base, now: T, plan }, schedRepo([]));
    expect(gw.calls()).toBe(1);

    // A call one tick past the TTL window must refetch and refresh the cache timestamp.
    await svc.suggest({ ...base, now: T + SUGGESTION_PROPOSAL_TTL_MS + 1, plan }, schedRepo([]));
    expect(gw.calls()).toBe(2);
  });

  it('bypasses the cache when refresh is set (explicit「候補を更新」)', async () => {
    const gw = countingGateway(['n1', 'n2', 'n3']);
    const cache = memoryCache();
    const svc = createWordSuggestionService(gw, { proposalCache: cache });
    const plan = { reviewSlots: 0, newSlots: 3 };

    await svc.suggest({ ...base, now: T, plan }, schedRepo([]));
    expect(gw.calls()).toBe(1);

    await svc.suggest({ ...base, now: T, plan, refresh: true }, schedRepo([]));
    expect(gw.calls()).toBe(2); // forced refetch despite a fresh cache
  });

  it('refetches when the fresh cached pool no longer has enough usable words after exclusion', async () => {
    const gw = countingGateway(['n4', 'n5', 'n6']);
    const cache = memoryCache();
    // Pre-seed a fresh pool whose every word is about to be excluded.
    cache.store.set(`${U}::B1|daily`, { proposals: ['n1', 'n2', 'n3'], updatedAt: new Date(T).toISOString() });
    const svc = createWordSuggestionService(gw, { proposalCache: cache });

    const result = await svc.suggest(
      { ...base, now: T, plan: { reviewSlots: 0, newSlots: 3 }, excludedWordIds: ['n1', 'n2', 'n3'] },
      schedRepo([]),
    );
    expect(gw.calls()).toBe(1); // cached pool unusable (all excluded) → live refetch
    expect(result.candidates.map((c) => c.wordId)).toEqual(['n4', 'n5', 'n6']);
    expect(cache.store.get(`${U}::B1|daily`)?.proposals).toEqual(['n4', 'n5', 'n6']); // cache refreshed
  });

  it('stale-if-error: serves a (stale) cached pool when the gateway throws, without a gateway_unavailable shortfall', async () => {
    const throwingGw: ContentGateway = {
      generatePassage: async () => {
        throw new Error('unused');
      },
      getWordData: async () => {
        throw new Error('unused');
      },
      suggestWords: async () => {
        throw new Error('503');
      },
    };
    const cache = memoryCache();
    // Cache is present but STALE (older than the TTL), so the service tries the gateway first.
    cache.store.set(`${U}::B1|daily`, {
      proposals: ['s1', 's2', 's3'],
      updatedAt: new Date(T - SUGGESTION_PROPOSAL_TTL_MS - 1).toISOString(),
    });
    const svc = createWordSuggestionService(throwingGw, { proposalCache: cache });

    const result = await svc.suggest({ ...base, now: T, plan: { reviewSlots: 0, newSlots: 3 } }, schedRepo([]));
    expect(result.candidates.map((c) => c.wordId)).toEqual(['s1', 's2', 's3']); // stale pool reused
    expect(result.shortfall).toBeUndefined(); // NOT reported as gateway_unavailable
  });

  it('still reports gateway_unavailable when the gateway throws and there is no cached pool', async () => {
    const throwingGw: ContentGateway = {
      generatePassage: async () => {
        throw new Error('unused');
      },
      getWordData: async () => {
        throw new Error('unused');
      },
      suggestWords: async () => {
        throw new Error('503');
      },
    };
    const svc = createWordSuggestionService(throwingGw, { proposalCache: memoryCache() });
    const result = await svc.suggest({ ...base, now: T, plan: { reviewSlots: 0, newSlots: 3 } }, schedRepo([]));
    expect(result.candidates).toEqual([]);
    expect(result.shortfall?.reason).toBe('gateway_unavailable');
  });

  it('a cache-read failure degrades to a normal fetch (best-effort cache)', async () => {
    const gw = countingGateway(['n1', 'n2', 'n3']);
    const brokenCache: SuggestionCacheRepository = {
      async get() {
        throw new Error('idb read failed');
      },
      async put() {
        throw new Error('idb write failed');
      },
    };
    const svc = createWordSuggestionService(gw, { proposalCache: brokenCache });
    const result = await svc.suggest({ ...base, now: T, plan: { reviewSlots: 0, newSlots: 3 } }, schedRepo([]));
    expect(result.candidates.map((c) => c.wordId)).toEqual(['n1', 'n2', 'n3']);
    expect(gw.calls()).toBe(1);
  });
});

describe('WordSuggestionService.normalizeSelection', () => {
  it('re-applies (case-insensitive) ABC order and dedupe to an edited selection set (5.4)', () => {
    const svc = createWordSuggestionService(gateway([]));
    expect(svc.normalizeSelection(['Zebra', 'apple', 'apple', 'Mango'])).toEqual(['apple', 'Mango', 'Zebra']);
  });

  it('is case-insensitive for dedupe but preserves the first-seen spelling', () => {
    const svc = createWordSuggestionService(gateway([]));
    expect(svc.normalizeSelection(['Apple', 'apple', 'APPLE'])).toEqual(['Apple']);
  });
});
