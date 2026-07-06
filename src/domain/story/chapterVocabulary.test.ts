import { describe, it, expect } from 'vitest';
import { collectChapterTargetWordIds, avoidWordIdsForNextChapter, type ChapterVocabularySource } from './chapterVocabulary';
import type { WordSchedulingState } from '../../types/domain';

function chapter(...wordIds: string[]): ChapterVocabularySource {
  return {
    passage: {
      targetSpans: wordIds.map((wordId, i) => ({
        sentenceIndex: i,
        tokenStart: 0,
        tokenEnd: 1,
        wordId,
        surface: wordId,
        masteryDensity: 'new' as const,
      })),
    },
  };
}

function state(wordId: string, overrides: Partial<WordSchedulingState> = {}): WordSchedulingState {
  return {
    userId: 'u' as WordSchedulingState['userId'],
    wordId,
    difficulty: 5,
    reps: 0,
    lapses: 0,
    learningStep: 0,
    lastReviewAt: 0,
    dueAt: 0,
    lastSource: 'review',
    mastery: 'New',
    reappearCount: 0,
    ...overrides,
  };
}

describe('collectChapterTargetWordIds', () => {
  it('unions target-span wordIds across chapters in first-seen order, deduped case-insensitively', () => {
    const ids = collectChapterTargetWordIds([chapter('ancient', 'relic'), chapter('Relic', 'temple')]);
    expect(ids).toEqual(['ancient', 'relic', 'temple']);
  });

  it('returns an empty list when no chapter has target spans', () => {
    expect(collectChapterTargetWordIds([chapter(), chapter()])).toEqual([]);
    expect(collectChapterTargetWordIds([])).toEqual([]);
  });
});

describe('avoidWordIdsForNextChapter', () => {
  const now = 10_000;

  it('avoids every already-woven word when none are review-due', () => {
    const words = ['ancient', 'relic', 'temple'];
    expect(avoidWordIdsForNextChapter(words, new Map(), now)).toEqual(words);
  });

  it('lets a review-due word reappear by dropping it from the avoid set', () => {
    const words = ['ancient', 'relic'];
    // 'relic' has been learned (stability set) and its review time has arrived → allowed to reappear.
    const sched = new Map([['relic', state('relic', { stability: 8, dueAt: now - 1 })]]);
    expect(avoidWordIdsForNextChapter(words, sched, now)).toEqual(['ancient']);
  });

  it('keeps a seeded-but-not-yet-reviewed word avoided even after its dueAt elapses', () => {
    const words = ['ancient'];
    // Introduced in an earlier chapter, dueAt elapsed, but never explicitly reviewed (stability
    // undefined) ⇒ NOT review-due ⇒ still avoided so the next chapter teaches something new.
    const sched = new Map([['ancient', state('ancient', { stability: undefined, dueAt: now - 1 })]]);
    expect(avoidWordIdsForNextChapter(words, sched, now)).toEqual(['ancient']);
  });

  it('keeps a suspended (known) word avoided even when it would otherwise be review-due', () => {
    const words = ['ancient'];
    const sched = new Map([['ancient', state('ancient', { stability: 8, dueAt: now - 1, suspended: true })]]);
    expect(avoidWordIdsForNextChapter(words, sched, now)).toEqual(['ancient']);
  });

  it('matches scheduling entries case-insensitively', () => {
    const words = ['Relic'];
    const sched = new Map([['relic', state('relic', { stability: 8, dueAt: now - 1 })]]);
    expect(avoidWordIdsForNextChapter(words, sched, now)).toEqual([]);
  });
});
