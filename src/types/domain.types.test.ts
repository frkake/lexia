import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  WordData,
  EtymologyV2,
  IdiomEntry,
  SemanticNeighbor,
  WordSchedulingState,
  MasteryStage,
  MasteryDensity,
  Rating,
  TargetSpan,
  NoticeCategory,
  UserId,
  Settings,
  Sentence,
  TranslationSpan,
  ReadabilityLevel,
  PassageMeta,
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
        collocations: [
          { id: 'resilient-economy', pattern: 'a resilient ＜経済＞', type: 'Adj+N', slotExamples: ['economy'], glossJa: '回復力のある経済', l1Contrast: false },
        ],
        synonymNuances: ['tough vs resilient'],
      },
    };
    expect(w.more).toBeUndefined();
    expectTypeOf<WordData['more']>().toEqualTypeOf<
      | Partial<{
          etymology: EtymologyV2;
          semanticNetwork: SemanticNeighbor[];
          wordFamily: string[];
          idioms: IdiomEntry[];
          grammarPatterns: string[];
          metaphor: string;
          commonErrors: string[];
        }>
      | undefined
    >();
    expectTypeOf<WordData['memoryTips']>().toEqualTypeOf<
      | {
          kind: 'image' | 'etymology' | 'collocation' | 'contrast' | 'sound' | 'mistake';
          tipJa: string;
        }[]
      | undefined
    >();
  });

  it('a New word leaves stability undefined', () => {
    expectTypeOf<WordSchedulingState['stability']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<WordSchedulingState['level']>().toEqualTypeOf<'A2' | 'B1' | 'B2' | 'C1' | 'C2' | undefined>();
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

  it('NoticeCategory includes the supplied annotation kinds', () => {
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
      'idiom',
      'phrasal_verb',
      'phrase',
      'metaphor',
      'usage',
      'memory_tip',
      'sentence_structure',
    ];
    expect(new Set(cats).size).toBe(cats.length);
  });

  it('ReadabilityLevel separates sentence structure from vocabulary level', () => {
    expectTypeOf<ReadabilityLevel>().toEqualTypeOf<'easy' | 'standard' | 'advanced'>();
  });

  it('Settings.translationMode is the three reading modes', () => {
    expectTypeOf<Settings['translationMode']>().toEqualTypeOf<'off' | 'per_sentence' | 'full'>();
  });

  it('a TranslationSpan carries a JA char range, a ref type, the EN word link and a new flag (9.5/4.2)', () => {
    const span: TranslationSpan = {
      charStart: 0,
      charEnd: 3,
      refType: 'word',
      wordId: 'resilient',
      isNew: true,
    };
    expect(span.charEnd).toBeGreaterThan(span.charStart);
    expectTypeOf<TranslationSpan['refType']>().toEqualTypeOf<
      'word' | 'collocation' | 'idiom' | 'grammar'
    >();
    expectTypeOf<TranslationSpan['wordId']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<TranslationSpan['isNew']>().toEqualTypeOf<boolean>();
  });

  it('a Sentence keeps translationSpans OPTIONAL so existing passages stay valid (9.5)', () => {
    // No translationSpans — must still compile as a valid Sentence.
    const legacy: Sentence = { tokens: ['Hi', '.'], translationJa: 'やあ。' };
    expect(legacy.translationSpans).toBeUndefined();
    // With spans — also valid.
    const annotated: Sentence = {
      tokens: ['She', 'stayed', 'resilient', '.'],
      translationJa: '彼女は粘り強いままだった。',
      translationSpans: [{ charStart: 3, charEnd: 6, refType: 'word', isNew: true }],
    };
    expect(annotated.translationSpans).toHaveLength(1);
    expectTypeOf<Sentence['translationSpans']>().toEqualTypeOf<TranslationSpan[] | undefined>();
  });

  it('PassageMeta keeps sceneIllustrationUrl optional for legacy passages', () => {
    const legacy: PassageMeta = {
      title: 'T',
      intent: 'daily',
      level: 'B1',
      newCount: 0,
      reviewCount: 0,
      approxWords: 100,
    };
    const illustrated: PassageMeta = { ...legacy, sceneIllustrationUrl: 'data:image/png;base64,SCENE' };
    expect(legacy.sceneIllustrationUrl).toBeUndefined();
    expect(illustrated.sceneIllustrationUrl).toContain('data:image/png;base64,');
    expectTypeOf<PassageMeta['sceneIllustrationUrl']>().toEqualTypeOf<string | undefined>();
  });
});
