import { describe, it, expect } from 'vitest';
import { passageSearch } from './passageSearch';
import type { PassageRecord } from '../../types/ports';
import type { LearningIntent, Cefr, PassageOutput, UserId } from '../../types/domain';

function article(
  passageId: string,
  createdAt: number,
  meta: { title: string; intent?: LearningIntent; level?: Cefr },
  sentences: { en: string; ja: string }[] = [],
): PassageRecord {
  const passage: PassageOutput = {
    meta: {
      title: meta.title,
      intent: meta.intent ?? 'daily',
      level: meta.level ?? 'B1',
      newCount: 0,
      reviewCount: 0,
      approxWords: 0,
    },
    sentences: sentences.map((s) => ({ tokens: s.en.split(' '), translationJa: s.ja })),
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [],
  };
  return { passageId, userId: 'u' as UserId, createdAt, passage };
}

function chapter(storyId: string, chapterIndex: number, createdAt: number, title: string): PassageRecord {
  const rec = article(`${storyId}:${chapterIndex}`, createdAt, { title });
  rec.passage.meta.storyRef = { storyId, chapterIndex };
  return rec;
}

describe('passageSearch', () => {
  it('empty query returns every entry in recency order', () => {
    const out = passageSearch(
      [article('a', 100, { title: 'Alpha' }), article('b', 300, { title: 'Beta' })],
      '',
    );
    expect(out.map((e) => (e.kind === 'article' ? e.passage.passageId : e.storyId))).toEqual(['b', 'a']);
  });

  it('ranks a title match above a body-only match', () => {
    const titled = article('t', 100, { title: 'Ocean Currents' });
    const bodied = article('b', 200, { title: 'Markets' }, [{ en: 'The ocean was calm.', ja: '海は穏やかだった。' }]);
    const out = passageSearch([bodied, titled], 'ocean');
    expect(out.map((e) => (e.kind === 'article' ? e.passage.passageId : e.storyId))).toEqual(['t', 'b']);
  });

  it('matches the Japanese translation body', () => {
    const out = passageSearch(
      [article('j', 100, { title: 'Untitled' }, [{ en: 'It rained.', ja: '雨が降った。' }])],
      '雨',
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.kind === 'article' && out[0]!.passage.passageId).toBe('j');
  });

  it('matches on the learning-intent label (theme)', () => {
    const out = passageSearch([article('biz', 100, { title: 'Untitled', intent: 'business' })], 'ビジネス');
    expect(out).toHaveLength(1);
  });

  it('collapses story chapters into one directory entry and matches on any chapter', () => {
    const out = passageSearch(
      [
        chapter('s1', 0, 100, 'Chapter One'),
        chapter('s1', 1, 200, 'The Hidden Cave'),
        article('a', 50, { title: 'Solo' }),
      ],
      'cave',
      { s1: 'My Saga' },
    );
    const story = out.find((e) => e.kind === 'story');
    expect(story && story.kind === 'story' && story.storyId).toBe('s1');
    expect(story && story.kind === 'story' && story.chapterCount).toBe(2);
    expect(story && story.kind === 'story' && story.title).toBe('My Saga');
    // The solo article does not match "cave", so only the story is returned.
    expect(out.filter((e) => e.kind === 'article')).toHaveLength(0);
  });
});
