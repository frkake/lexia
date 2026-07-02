import { describe, it, expect } from 'vitest';
import {
  buildAnnotationMessages,
  buildCharacterIllustrationPrompt,
  buildPassageMessages,
  buildStoryPlanMessages,
  buildStoryPlanExtensionMessages,
  buildSuggestionMessages,
  maxTokensForWordTarget,
} from './schema';
import type { GenerationRequest, PassageAnnotationRequest, StoryPlanExtensionRequest } from '../../src/types/domain';

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

describe('buildStoryPlanMessages — memorable illustrated cast guidance', () => {
  it('asks for characters that can carry memorable visual motifs into portraits', () => {
    const { system } = buildStoryPlanMessages({
      contentType: 'short_story',
      genre: 'fantasy',
      intent: 'daily',
      level: 'B1',
    });
    expect(system).toContain('memorable');
    expect(system).toContain('signature motif/color/prop/silhouette');
  });
});

describe('buildCharacterIllustrationPrompt', () => {
  it('biases portraits toward stylized, memorable illustration instead of photorealism', () => {
    const prompt = buildCharacterIllustrationPrompt({
      name: 'Aria',
      role: '主人公',
      descriptionJa: '赤い羽根つき帽子をかぶった勇敢な少女',
      genre: 'fantasy',
      styleHint: '幻想的な作風',
    });
    expect(prompt).toContain('Highly stylized 2D');
    expect(prompt).toContain('not photorealistic');
    expect(prompt).toContain('memorable silhouette');
    expect(prompt).toContain('signature outfit, color accent, or prop');
  });
});

describe('buildStoryPlanExtensionMessages', () => {
  it('asks for future chapter beats starting at the next missing index and strips portrait data', () => {
    const req: StoryPlanExtensionRequest = {
      nextChapterIndex: 2,
      priorSummaryJa: '主人公は星の門を開いた。',
      additionalChapters: 2,
      plan: {
        storyId: 's1',
        contentType: 'long_story',
        genre: 'fantasy',
        titleJa: '星の物語',
        synopsisJa: '星を探す旅。',
        characters: [
          {
            name: 'Mia',
            role: '主人公',
            descriptionJa: '好奇心旺盛な少女',
            illustrationUrl: 'data:image/png;base64,TOO_BIG',
          },
        ],
        chapters: [
          { index: 0, headingJa: '第一章', beatJa: '旅立ち' },
          { index: 1, headingJa: '第二章', beatJa: '門を開く' },
        ],
      },
    };
    const { system, user } = buildStoryPlanExtensionMessages(req);
    expect(system).toContain('Do NOT rewrite existing chapters');
    expect(user).toContain('"nextChapterIndex": 2');
    expect(user).toContain('主人公は星の門を開いた。');
    expect(user).not.toContain('TOO_BIG');
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
