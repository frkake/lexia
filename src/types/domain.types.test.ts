import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  WordData,
  WordSchedulingState,
  MasteryStage,
  MasteryDensity,
  Rating,
  TargetSpan,
  NoticeCategory,
  UserId,
  Settings,
} from './domain';

describe('domain types', () => {
  it('WordData tolerates a missing MORE block (8.5 degradation)', () => {
    // Must compile and be a valid WordData without `more`.
    const w: WordData = {
      wordId: 'w1',
      headword: 'resilient',
      ipa: '/rɪˈzɪliənt/',
      pos: ['adj'],
      register: 'neutral',
      connotation: 'positive',
      frequency: 3,
      core: {
        meaningsJa: ['回復力のある'],
        examples: [{ en: 'a resilient community', ja: '回復力のある共同体' }],
        collocations: ['resilient economy'],
        synonymNuances: ['tough vs resilient'],
      },
    };
    expect(w.more).toBeUndefined();
    expectTypeOf<WordData['more']>().toEqualTypeOf<
      | Partial<{
          etymology: { prefix?: string; root?: string; suffix?: string };
          semanticNetwork: {
            synonyms: string[];
            antonyms: string[];
            hypernyms: string[];
            hyponyms: string[];
            related: string[];
          };
          wordFamily: string[];
          idioms: string[];
          grammarPatterns: string[];
          metaphor: string;
          commonErrors: string[];
        }>
      | undefined
    >();
  });

  it('a New word leaves stability undefined', () => {
    expectTypeOf<WordSchedulingState['stability']>().toEqualTypeOf<number | undefined>();
    const s: WordSchedulingState = {
      userId: 'u1' as UserId,
      wordId: 'w1',
      difficulty: 5,
      reps: 0,
      lapses: 0,
      learningStep: 0,
      lastReviewAt: 0,
      dueAt: 0,
      lastSource: 'review',
      mastery: 'New',
      reappearCount: 0,
    };
    expect(s.stability).toBeUndefined();
  });

  it('MasteryStage has exactly the four learning stages', () => {
    const all: Record<MasteryStage, true> = {
      New: true,
      Learning: true,
      Consolidating: true,
      Mastered: true,
    };
    expect(Object.keys(all).sort()).toEqual(
      ['Consolidating', 'Learning', 'Mastered', 'New'].sort(),
    );
  });

  it('MasteryDensity is the 3-level downcast', () => {
    const all: Record<MasteryDensity, true> = { new: true, review: true, known: true };
    expect(Object.keys(all)).toHaveLength(3);
  });

  it('Rating is 1..4', () => {
    expectTypeOf<Rating>().toEqualTypeOf<1 | 2 | 3 | 4>();
  });

  it('TargetSpan is a half-open token range carrying word identity', () => {
    const span: TargetSpan = {
      sentenceIndex: 0,
      tokenStart: 2,
      tokenEnd: 3,
      wordId: 'w1',
      surface: 'resilient',
      masteryDensity: 'new',
    };
    expect(span.tokenEnd).toBeGreaterThan(span.tokenStart);
  });

  it('NoticeCategory includes the ten supplied annotation kinds', () => {
    const cats: NoticeCategory[] = [
      'connotation',
      'collocation',
      'register',
      'etymology',
      'semantic_network',
      'synonym_nuance',
      'grammar_pattern',
      'word_family',
      'frequency',
      'common_error',
    ];
    expect(new Set(cats).size).toBe(10);
  });

  it('Settings.translationMode is the three reading modes', () => {
    expectTypeOf<Settings['translationMode']>().toEqualTypeOf<'off' | 'per_sentence' | 'full'>();
  });
});
