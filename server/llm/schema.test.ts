import { describe, it, expect } from 'vitest';
import { buildAnnotationMessages, buildPassageMessages, buildSuggestionMessages, maxTokensForWordTarget } from './schema';
import type { GenerationRequest, PassageAnnotationRequest } from '../../src/types/domain';

describe('buildPassageMessages — translationSpans guidance (Requirement 4)', () => {
  const req: GenerationRequest = {
    level: 'B1',
    intent: 'business',
    newWordRatio: 0.3,
    wordTarget: 200,
    contentType: 'article',
    targetWords: [{ wordId: 'resilient', surface: 'resilient', masteryDensity: 'new' }],
  };

  it('instructs the model to emit translationSpans for the new-element Japanese emphasis', () => {
    const { system } = buildPassageMessages(req);
    // The model is told about the field and its key sub-fields, so it actually produces them.
    expect(system).toContain('translationSpans');
    expect(system).toContain('anchorTextJa');
    expect(system).toContain('isNew');
  });

  it('tells the model the JA anchor must be a verbatim substring of translationJa', () => {
    const { system } = buildPassageMessages(req);
    expect(system.toLowerCase()).toContain('translationja'); // anchored into the translation text
    // It must ask for the verbatim Japanese (so the server can re-derive offsets).
    expect(system).toMatch(/verbatim|そのまま|逐語|exact/i);
  });

  it('tells the model to emit an empty translationSpans array when a sentence has no new elements', () => {
    const { system } = buildPassageMessages(req);
    expect(system.toLowerCase()).toMatch(/empty|空/);
  });
});

describe('buildPassageMessages — new fields (Requirement 7.4 / 8.3 / 8.4 / 6.6)', () => {
  const base: GenerationRequest = {
    level: 'B1',
    intent: 'business',
    newWordRatio: 0.3,
    wordTarget: 300,
    contentType: 'article',
    targetWords: [],
  };

  it('passes the numeric word target through as the approxWords constraint (7.4)', () => {
    const { user } = buildPassageMessages({ ...base, wordTarget: 900 });
    expect(user).toContain('900');
    expect(user).toContain('article');
  });

  it('biases toward exam-frequent vocabulary/formats for exam intents (8.4)', () => {
    const toeic = buildPassageMessages({ ...base, intent: 'toeic' }).user;
    expect(toeic.toLowerCase()).toContain('toeic');
    expect(toeic.toLowerCase()).toMatch(/high-frequency|frequent|prioritize/);
    const eiken = buildPassageMessages({ ...base, intent: 'eiken' }).user;
    expect(eiken.toLowerCase()).toMatch(/high-frequency|frequent|prioritize/);
  });

  it('injects the story consistency context for a chapter request (6.6)', () => {
    const { user } = buildPassageMessages({
      ...base,
      contentType: 'long_story',
      storyContext: {
        storyId: 's1',
        chapterIndex: 2,
        plan: {
          storyId: 's1',
          contentType: 'long_story',
          genre: 'fantasy',
          titleJa: '竜の物語',
          synopsisJa: '竜と少女の冒険。',
          characters: [{ name: 'Aria', role: 'hero', descriptionJa: '勇敢な少女' }],
          chapters: [{ index: 2, headingJa: '第二章', beatJa: '洞窟へ' }],
        },
        priorSummaryJa: '少女は旅に出た。',
      },
    });
    expect(user).toContain('竜と少女の冒険。'); // synopsis threaded in
    expect(user).toContain('少女は旅に出た。'); // prior-chapter summary threaded in
  });
});

describe('maxTokensForWordTarget', () => {
  it('is monotonic in the word target', () => {
    expect(maxTokensForWordTarget(800)).toBeGreaterThan(maxTokensForWordTarget(200));
  });
});

describe('buildSuggestionMessages — intent replaces themes (Requirement 8/5)', () => {
  it('passes the learning intent (not theme tags) to the suggester', () => {
    const { user, system } = buildSuggestionMessages({ level: 'B2', intent: 'toeic', count: 5 });
    expect(user).toContain('toeic');
    expect(user).not.toContain('themes');
    expect(system.toLowerCase()).toContain('intent');
  });
});

describe('buildAnnotationMessages — REQUIRED COVERAGE from body marks', () => {
  it('lists every collocation and study word as required coverage, in canonical surface form', () => {
    const req: PassageAnnotationRequest = {
      level: 'B2',
      sentences: [
        { tokens: ['We', 'can', 'leverage', 'our', 'reputation', '.'], translationJa: '' },
        { tokens: ['It', 'does', "n't", 'matter', '.'], translationJa: '' },
      ],
      collocationSpans: [{ sentenceIndex: 0, tokenStart: 2, tokenEnd: 5, headWordId: 'leverage', collocationId: 'lev' }],
      targetSpans: [{ sentenceIndex: 1, tokenStart: 1, tokenEnd: 3, wordId: 'matter', surface: "doesn't", masteryDensity: 'review' }],
    };
    const { user } = buildAnnotationMessages(req);
    expect(user.toUpperCase()).toContain('REQUIRED COVERAGE');
    expect(user).toContain('"leverage our reputation" (collocation)');
    // Study word rebuilt with canonical spacing (clitic): "doesn't", not "does n't".
    expect(user).toContain('"doesn\'t" (word)');
    expect(user).not.toContain('does n\'t');
  });

  it('does not separately require a study word that sits wholly inside a listed collocation', () => {
    const req: PassageAnnotationRequest = {
      level: 'B2',
      sentences: [{ tokens: ['We', 'can', 'leverage', 'our', 'reputation', '.'], translationJa: '' }],
      collocationSpans: [{ sentenceIndex: 0, tokenStart: 2, tokenEnd: 5, headWordId: 'leverage', collocationId: 'lev' }],
      targetSpans: [{ sentenceIndex: 0, tokenStart: 2, tokenEnd: 3, wordId: 'leverage', surface: 'leverage', masteryDensity: 'new' }],
    };
    const { user } = buildAnnotationMessages(req);
    expect(user).toContain('"leverage our reputation" (collocation)');
    expect(user).not.toContain('"leverage" (word)');
  });

  it('omits the required-coverage section entirely when no spans are supplied (back-compat)', () => {
    const req: PassageAnnotationRequest = {
      level: 'B1',
      sentences: [{ tokens: ['Hello', '.'], translationJa: '' }],
    };
    const { user } = buildAnnotationMessages(req);
    expect(user.toUpperCase()).not.toContain('REQUIRED COVERAGE');
  });
});
