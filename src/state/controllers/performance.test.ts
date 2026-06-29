// @vitest-environment node
/**
 * Performance & reliability (task 11.3*). Measures the cost-sensitive paths and asserts
 * correctness at scale (timing bounds are generous so the test is not flaky; the measured
 * numbers are logged as the "計測結果"):
 *   - large-vocabulary dueBefore / lowStability queries (correct ordering, bounded time);
 *   - the follow-along token lookup is O(log n) — fast over thousands of marks;
 *   - export → import round-trips the SRS state + review log with full fidelity.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { LexiaDb } from '../../infra/persistence/lexiaDb';
import { createRepositories } from '../../infra/persistence/repositories';
import { JsonSyncAdapter } from '../../infra/sync/exportImport';
import { findActiveTokenId } from '../stores/highlightController';
import type { ReviewLogEntry, UserId, WordMark, WordSchedulingState } from '../../types/domain';

const VOCAB = 5000;

function makeState(userId: UserId, i: number): WordSchedulingState {
  return {
    userId,
    wordId: `w${i}`,
    stability: ((i * 7) % 50) + 1,
    difficulty: (i % 9) + 1,
    reps: i % 12,
    lapses: i % 4,
    learningStep: 0,
    lastReviewAt: i * 500,
    dueAt: i * 1000,
    lastSource: i % 2 ? 'review' : 'passage',
    mastery: 'Learning',
    reappearCount: i % 6,
  };
}

describe('performance & reliability (task 11.3)', () => {
  it('queries a large vocabulary within budget and returns correct ordering', async () => {
    const userId = 'perf_q' as UserId;
    const db = new LexiaDb(userId);
    await db.open();
    const repos = createRepositories(db);
    await db.scheduling.bulkPut(Array.from({ length: VOCAB }, (_, i) => makeState(userId, i)));

    const now = (VOCAB / 2) * 1000;
    const t0 = performance.now();
    const due = await repos.scheduling.dueBefore(userId, now);
    const tDue = performance.now() - t0;
    const t1 = performance.now();
    const weak = await repos.scheduling.lowStability(userId, 20);
    const tLow = performance.now() - t1;

    // dueBefore: only due words, ascending by dueAt.
    expect(due.length).toBeGreaterThan(0);
    expect(due.every((s) => s.dueAt <= now)).toBe(true);
    for (let i = 1; i < due.length; i += 1) expect(due[i]!.dueAt).toBeGreaterThanOrEqual(due[i - 1]!.dueAt);
    // lowStability: 20 lowest, ascending by stability.
    expect(weak).toHaveLength(20);
    for (let i = 1; i < weak.length; i += 1) {
      expect(weak[i]!.stability ?? 0).toBeGreaterThanOrEqual(weak[i - 1]!.stability ?? 0);
    }

    console.log(`[perf] dueBefore ${VOCAB}→${due.length} in ${tDue.toFixed(1)}ms; lowStability(20) in ${tLow.toFixed(1)}ms`);
    expect(tDue).toBeLessThan(4000);
    db.close();
  });

  it('follow-along token lookup is O(log n) — fast over thousands of marks', () => {
    const n = 5000;
    const marks: WordMark[] = Array.from({ length: n }, (_, i) => ({ tokenId: `t:${i}`, startMs: i * 100, endMs: (i + 1) * 100 }));
    const lookups = 200_000;

    const t0 = performance.now();
    let hits = 0;
    for (let i = 0; i < lookups; i += 1) {
      if (findActiveTokenId(marks, (i * 97) % (n * 100))) hits += 1;
    }
    const dt = performance.now() - t0;

    // Correctness spot-checks (binary search).
    expect(findActiveTokenId(marks, 0)).toBe('t:0');
    expect(findActiveTokenId(marks, 250)).toBe('t:2');
    expect(findActiveTokenId(marks, (n - 1) * 100 + 50)).toBe(`t:${n - 1}`);
    expect(findActiveTokenId(marks, n * 100 + 5)).toBeNull();
    expect(hits).toBeGreaterThan(0);

    console.log(`[perf] ${lookups} binary-search lookups over ${n} marks in ${dt.toFixed(1)}ms`);
    expect(dt).toBeLessThan(2000); // O(log n) keeps 200k lookups well under budget
  });

  it('export → import round-trips SRS state + review log with full fidelity', async () => {
    const src = 'perf_src' as UserId;
    const dst = 'perf_dst' as UserId;
    const db = new LexiaDb(src);
    await db.open();
    const repos = createRepositories(db);

    const N = 1200;
    const states = Array.from({ length: N }, (_, i) => makeState(src, i));
    await db.scheduling.bulkPut(states);
    const logs: ReviewLogEntry[] = Array.from({ length: N }, (_, i) => ({
      userId: src,
      wordId: `w${i}`,
      rating: ((i % 4) + 1) as ReviewLogEntry['rating'],
      source: i % 2 ? 'review' : 'passage',
      at: i * 1000,
      stabilityAfter: (i % 30) + 1,
    }));
    for (const l of logs) await repos.reviewLog.append(l);

    const adapter = new JsonSyncAdapter(db);
    const blob = await adapter.export(src);
    await adapter.import(dst, blob);

    const importedStates = await db.scheduling.where('userId').equals(dst).toArray();
    const importedLogs = await repos.reviewLog.since(dst, 0);

    // SRS state: identical modulo the re-stamped userId.
    const byWord = (a: { wordId: string }, b: { wordId: string }): number => a.wordId.localeCompare(b.wordId);
    expect(importedStates).toHaveLength(N);
    expect(importedStates.map((s) => ({ ...s, userId: src })).sort(byWord)).toEqual([...states].sort(byWord));

    // Review log: every entry preserved (id reassigned, userId re-stamped).
    const strip = (e: ReviewLogEntry) => ({ wordId: e.wordId, rating: e.rating, source: e.source, at: e.at, stabilityAfter: e.stabilityAfter });
    expect(importedLogs).toHaveLength(N);
    expect(importedLogs.map(strip).sort((a, b) => a.at - b.at)).toEqual(logs.map(strip).sort((a, b) => a.at - b.at));

    db.close();
  });
});
