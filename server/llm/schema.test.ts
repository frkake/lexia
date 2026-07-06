import { describe, it, expect } from 'vitest';
import {
  ANNOTATION_JSON_SCHEMA,
  PASSAGE_JSON_SCHEMA,
  WORD_DATA_JSON_SCHEMA,
  annotationMaxTokens,
  buildAnnotationMessages,
  buildCharacterIllustrationPrompt,
  buildPassageMessages,
  buildPassageIllustrationPrompt,
  buildStoryPlanMessages,
  buildStoryPlanExtensionMessages,
  buildSuggestionMessages,
  buildWordMessages,
  maxTokensForWordTarget,
} from './schema';
import type { GenerationRequest, PassageAnnotationRequest, StoryPlanExtensionRequest } from '../../src/types/domain';

function assertOpenAiStrictObjectSchema(schema: unknown, path = 'schema'): void {
  if (!schema || typeof schema !== 'object') return;
  const obj = schema as { type?: unknown; properties?: Record<string, unknown>; required?: unknown; items?: unknown };
  const types = Array.isArray(obj.type) ? obj.type : [obj.type];
  if (types.includes('object') && obj.properties) {
    expect(obj.required, `${path}.required`).toEqual(Object.keys(obj.properties));
  }
  for (const [key, value] of Object.entries(obj.properties ?? {})) {
    assertOpenAiStrictObjectSchema(value, `${path}.properties.${key}`);
  }
  if (obj.items) assertOpenAiStrictObjectSchema(obj.items, `${path}.items`);
}

describe('PASSAGE_JSON_SCHEMA', () => {
  it('keeps every object property required for OpenAI strict structured outputs', () => {
    assertOpenAiStrictObjectSchema(PASSAGE_JSON_SCHEMA);
  });

  it('does not ask the passage model to emit image-enrichment fields', () => {
    const meta = PASSAGE_JSON_SCHEMA.properties.meta;
    expect('sceneIllustrationUrl' in meta.properties).toBe(false);
  });

  it('adds required expressionSpans (B-1/B-2) and per-sentence paragraphIndex (F-8②)', () => {
    expect('expressionSpans' in PASSAGE_JSON_SCHEMA.properties).toBe(true);
    expect(PASSAGE_JSON_SCHEMA.required).toContain('expressionSpans');
    const expr = PASSAGE_JSON_SCHEMA.properties.expressionSpans.items;
    expect(expr.properties.category.enum).toEqual(['idiom', 'phrasal_verb', 'set_phrase']);
    expect(expr.required).toEqual(['span', 'surface', 'category', 'meaningJa']);
    const sentence = PASSAGE_JSON_SCHEMA.properties.sentences.items;
    expect('paragraphIndex' in sentence.properties).toBe(true);
    expect(sentence.required).toContain('paragraphIndex');
  });

  it('adds required syntaxSpans (B-3) with the self-report pattern enum', () => {
    expect('syntaxSpans' in PASSAGE_JSON_SCHEMA.properties).toBe(true);
    expect(PASSAGE_JSON_SCHEMA.required).toContain('syntaxSpans');
    const syntax = PASSAGE_JSON_SCHEMA.properties.syntaxSpans.items;
    expect(syntax.properties.pattern.enum).toEqual([
      'nonrestrictive_relative',
      'participial',
      'inversion',
      'cleft',
      'subjunctive',
      'appositive',
      'other',
    ]);
    expect(syntax.required).toEqual(['sentenceIndex', 'pattern', 'anchorText', 'noteJa']);
  });
});

describe('WORD_DATA_JSON_SCHEMA — structured attributes (C-1/C-2/C-3)', () => {
  // R7: the same schema object is sent to both providers, so strict-mode compliance (every object
  // property required; optionals nullable) is what keeps OpenAI structured outputs and Anthropic
  // output_config in lockstep. This locks the structured collocations/idioms/etymology/network shapes.
  it('keeps every object property required for OpenAI strict structured outputs', () => {
    assertOpenAiStrictObjectSchema(WORD_DATA_JSON_SCHEMA);
  });

  it('structures core.collocations as CollocationEntry objects (C-3)', () => {
    const coll = WORD_DATA_JSON_SCHEMA.properties.core.properties.collocations.items;
    expect(coll.type).toBe('object');
    expect(coll.properties.type.enum).toEqual(['V+N', 'Adj+N', 'N+of+N', 'V+Prep', 'Adv+V', 'other']);
    expect(coll.required).toEqual(['id', 'pattern', 'type', 'slotExamples', 'glossJa', 'exampleEn', 'l1Contrast']);
  });

  it('structures more.idioms as IdiomEntry objects with an origin field (C-1)', () => {
    const idiom = WORD_DATA_JSON_SCHEMA.properties.more.properties.idioms.items;
    expect(idiom.type).toBe('object');
    expect(idiom.required).toEqual(['expression', 'meaningJa', 'originJa', 'exampleEn', 'exampleJa']);
  });

  it('structures more.etymology as parts + bridge + cognates and semanticNetwork as a flat array (C-2)', () => {
    const etym = WORD_DATA_JSON_SCHEMA.properties.more.properties.etymology;
    expect(etym.required).toEqual(['parts', 'bridgeJa', 'cognates', 'sourceJa']);
    expect(etym.properties.parts.items.required).toEqual(['form', 'surfaceIn', 'meaningJa']);
    const net = WORD_DATA_JSON_SCHEMA.properties.more.properties.semanticNetwork;
    expect(net.type).toBe('array');
    expect(net.items.properties.relation.enum).toEqual(['synonym', 'antonym', 'hypernym', 'hyponym', 'related']);
    expect(net.items.required).toEqual(['word', 'relation', 'noteJa']);
  });
});

describe('buildPassageMessages — writing quality, idioms, set phrases (B-1/B-2)', () => {
  const req: GenerationRequest = {
    level: 'B2',
    intent: 'business',
    newWordRatio: 0.3,
    wordTarget: 300,
    contentType: 'article',
    targetWords: [],
  };

  it('binds native-like prose, an idiom quota, and expressionSpans self-report', () => {
    const { system } = buildPassageMessages(req);
    expect(system).toContain('Writing quality');
    expect(system).toContain('idiomQuota');
    expect(system).toContain('expressionSpans');
    expect(system).toContain('phrasal_verb');
    expect(system).toMatch(/discourse markers/);
  });

  it('adds the formulaic set-phrase instruction (B-2)', () => {
    const { system } = buildPassageMessages(req);
    expect(system).toContain('Formulaic language');
    expect(system).toContain('setPhraseQuota');
    expect(system).toContain('set_phrase');
  });

  it("rewrites collocationId to the id-or-legacy-string fallback (D4)", () => {
    const { system } = buildPassageMessages(req);
    expect(system).toContain('legacy word data');
    expect(system).toMatch(/collocationId = copy the collocation's id/);
  });

  it('B-3: binds the per-level sentence-length bands and the syntaxSpans self-report, dropping the fixed 12-15 rhythm', () => {
    const { system } = buildPassageMessages(req);
    expect(system).toContain('8-12 words per sentence');
    expect(system).toContain('12-16 words per sentence');
    expect(system).toContain('16-24 words per sentence');
    expect(system).toContain('Self-report syntax');
    expect(system).toContain('syntaxSpans');
    // The old fixed "one sentence per 12-15 words" rhythm is removed (it contradicted the bands).
    expect(system).not.toContain('12-15 words');
  });

  it('puts the idiom/set-phrase quotas in the request JSON, scaling with word count', () => {
    // idiomQuota = max(2, round(300/150)) = 2; setPhraseQuota = max(2, round(300/200)) = 2.
    const small = buildPassageMessages({ ...req, wordTarget: 300 }).user;
    expect(small).toContain('"idiomQuota": 2');
    expect(small).toContain('"setPhraseQuota": 2');
    // idiomQuota = round(1000/150) = 7; setPhraseQuota = round(1000/200) = 5.
    const big = buildPassageMessages({ ...req, wordTarget: 1000 }).user;
    expect(big).toContain('"idiomQuota": 7');
    expect(big).toContain('"setPhraseQuota": 5');
  });

  it('injects the intent-specific set-phrase suggestions into the user message', () => {
    const business = buildPassageMessages({ ...req, intent: 'business' }).user;
    expect(business).toContain('Set-phrase suggestions for this intent');
    expect(business).toContain('I am writing to inquire about');
    const travel = buildPassageMessages({ ...req, intent: 'travel' }).user;
    expect(travel).toContain('Is breakfast included?');
    // Every intent defines a hint list (acceptance: all 6 intents).
    for (const intent of ['business', 'daily', 'toeic', 'eiken', 'academic', 'travel'] as const) {
      expect(buildPassageMessages({ ...req, intent }).user).toContain('Set-phrase suggestions for this intent');
    }
  });

  it('adds paragraph-structure guidance (F-8②)', () => {
    const { system } = buildPassageMessages(req);
    expect(system).toContain('paragraphIndex');
    expect(system).toContain('paragraphs of 2-5 sentences');
  });
});

describe('buildPassageMessages — levelDetail sub-band calibration (A-3-1)', () => {
  const base: GenerationRequest = {
    level: 'B2',
    intent: 'business',
    newWordRatio: 0.3,
    wordTarget: 300,
    contentType: 'article',
    targetWords: [],
  };

  it('includes levelDetail and the calibration instruction when present', () => {
    const { user } = buildPassageMessages({ ...base, levelDetail: { subBand: 'high', examLabel: 'TOEIC 900' } });
    expect(user).toContain('"subBand": "high"');
    expect(user).toContain('TOEIC 900');
    expect(user).toContain('Calibrate difficulty WITHIN the CEFR band');
  });

  it('omits the calibration block entirely when levelDetail is absent (back-compat)', () => {
    const { user } = buildPassageMessages(base);
    expect(user).not.toContain('Calibrate difficulty WITHIN the CEFR band');
    expect(user).not.toContain('levelDetail');
  });

  it('produces different prompts for TOEIC 800 (mid) vs 900 (high)', () => {
    const p800 = buildPassageMessages({ ...base, levelDetail: { subBand: 'mid', examLabel: 'TOEIC 800' } }).user;
    const p900 = buildPassageMessages({ ...base, levelDetail: { subBand: 'high', examLabel: 'TOEIC 900' } }).user;
    expect(p800).not.toEqual(p900);
    expect(p800).toContain('"subBand": "mid"');
    expect(p900).toContain('"subBand": "high"');
  });
});

describe('buildPassageMessages — chunked continuation context (B-5 第2弾)', () => {
  const base: GenerationRequest = {
    level: 'B2',
    intent: 'business',
    newWordRatio: 0.3,
    wordTarget: 1000,
    contentType: 'short_story',
    targetWords: [],
  };

  it('marks the opening segment and tells it not to conclude the whole piece', () => {
    const { user } = buildPassageMessages({
      ...base,
      continuationContext: { segmentIndex: 0, segmentCount: 3, priorSummaryJa: '' },
    });
    expect(user).toContain('OPENING section (1 of 3)');
    expect(user).toContain('do NOT wrap up or conclude the whole');
  });

  it('gives a later segment its position and the Japanese summary so far', () => {
    const { user } = buildPassageMessages({
      ...base,
      continuationContext: { segmentIndex: 1, segmentCount: 3, priorSummaryJa: '前の場面のまとめ。' },
    });
    expect(user).toContain('SECTION 2 of 3');
    expect(user).toContain('Continue seamlessly');
    expect(user).toContain('前の場面のまとめ。');
  });

  it('asks the final segment to bring the piece to a close', () => {
    const { user } = buildPassageMessages({
      ...base,
      continuationContext: { segmentIndex: 2, segmentCount: 3, priorSummaryJa: 'これまでの展開。' },
    });
    expect(user).toContain('SECTION 3 of 3');
    expect(user).toContain('FINAL section');
    expect(user).toContain('natural, satisfying close');
  });

  it('omits the continuation block entirely for single-shot generation (back-compat)', () => {
    const { user } = buildPassageMessages(base);
    expect(user).not.toContain('continuous piece');
    expect(user).not.toContain('SECTION');
  });
});

describe('buildPassageMessages — translationSpans guidance (Requirement 4)', () => {
  const req: GenerationRequest = {
    level: 'B1',
    intent: 'business',
    newWordRatio: 0.3,
    wordTarget: 200,
    contentType: 'article',
    readabilityLevel: 'easy',
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
    const { system, user } = buildPassageMessages({ ...base, wordTarget: 900, readabilityLevel: 'advanced' });
    expect(user).toContain('900');
    expect(user).toContain('article');
    expect(user).toContain('advanced');
    expect(system).toContain('Readability');
  });

  it('derives the sentence-structure preset from CEFR when readabilityLevel is omitted', () => {
    const b1 = buildPassageMessages({ ...base, level: 'B1' }).user;
    expect(b1).toContain('"readabilityLevel": "easy"');
    const c1 = buildPassageMessages({ ...base, level: 'C1' }).user;
    expect(c1).toContain('"readabilityLevel": "advanced"');
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

  it('adds listening-scene transcript and speaker guidance for radio/interview practice', () => {
    const { system, user } = buildPassageMessages({
      ...base,
      contentType: 'listening_scene',
      listeningOptions: { sceneKind: 'street_interview', accent: 'in', noiseLevel: 'medium' },
    });
    expect(system).toContain('listening_scene');
    expect(system).toContain('speakerId');
    expect(user).toContain('"sceneKind": "street_interview"');
    expect(user).toContain('target accent for TTS voices: in');
    expect(user).toContain('guest_1');
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

describe('buildWordMessages — memory tips', () => {
  it('asks for natural memory hooks without forced puns', () => {
    const { system } = buildWordMessages('resilient');
    expect(system).toContain('memoryTips');
    expect(system).toContain('Do NOT invent forced puns');
  });

  it('requires etymology spelling, semantic shift, and Japanese synonym nuance', () => {
    const { system } = buildWordMessages('coach');
    expect(system).toContain('original spelling');
    expect(system).toContain('semantic bridge');
    expect(system).toContain('noteJa');
    expect(system).toContain('core.synonymNuances MUST be written in Japanese');
  });
});

describe('buildCharacterIllustrationPrompt', () => {
  it('biases character art toward elegant anime-style full-body illustration instead of childish storybook art', () => {
    const prompt = buildCharacterIllustrationPrompt({
      name: 'Aria',
      role: '主人公',
      descriptionJa: '赤い羽根つき帽子をかぶった勇敢な少女',
      genre: 'fantasy',
      styleHint: '幻想的な作風',
    });
    expect(prompt).toContain('Full-body');
    expect(prompt).toContain('Elegant contemporary anime-inspired');
    expect(prompt).toContain('not photorealistic');
    expect(prompt).toContain('adult learners');
    expect(prompt).toContain('memorable silhouette');
    expect(prompt).toContain('head-to-toe full body');
    expect(prompt).toContain('signature outfit, color accent, or prop');
    expect(prompt).toContain('same face shape');
    expect(prompt).toContain('avoid storybook style');
    expect(prompt).toContain('chibi proportions');
  });

  it('builds portrait prompts for story overview thumbnails with shared cast consistency context', () => {
    const prompt = buildCharacterIllustrationPrompt({
      name: 'Aria',
      role: '主人公',
      descriptionJa: '赤い羽根つき帽子をかぶった勇敢な少女',
      genre: 'fantasy',
      variant: 'portrait',
      storyTitleJa: '星の継承者',
      storySynopsisJa: '星を継ぐ旅。',
      castStyleGuide: '1. Aria: 赤い羽根つき帽子\n2. Draco: 銀色の角',
      styleHint: '幻想的な作風',
    });
    expect(prompt).toContain('Portrait character illustration');
    expect(prompt).toContain('Portrait bust composition');
    expect(prompt).toContain('dedicated portrait illustration');
    expect(prompt).toContain('not a crop');
    expect(prompt).toContain('head and upper torso visible');
    expect(prompt).toContain('square-friendly');
    expect(prompt).toContain('Story title (Japanese): 星の継承者');
    expect(prompt).toContain('Cast consistency guide');
    expect(prompt).toContain('Draco');
  });
});

describe('buildPassageIllustrationPrompt', () => {
  it('uses passage and story context while banning text in the image', () => {
    const prompt = buildPassageIllustrationPrompt({
      title: '星の少女 第一章',
      intent: 'daily',
      level: 'B1',
      sentences: [{ tokens: ['Mia', 'found', 'a', 'glowing', 'map', '.'], translationJa: '' }],
      story: {
        genre: 'fantasy',
        titleJa: '星の少女',
        synopsisJa: '少女が星を探す物語。',
        chapterHeadingJa: '第一章',
        chapterBeatJa: 'ミアが光る地図を見つける。',
        characters: [{ name: 'Mia', role: '主人公', descriptionJa: '赤い羽根つき帽子の少女' }],
        styleHint: '幻想的な作風',
      },
    });
    expect(prompt).toContain('Mia found a glowing map.');
    expect(prompt).toContain('星の少女');
    expect(prompt).toContain('ミアが光る地図を見つける');
    expect(prompt).toContain('single most representative moment');
    expect(prompt).toContain('Elegant contemporary anime-inspired editorial illustration');
    expect(prompt).toContain('generous safe margins');
    expect(prompt).toContain('cropped bodies');
    expect(prompt).toContain('no text, letters, captions');
    expect(prompt).toContain('avoid storybook style');
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
            portraitIllustrationUrl: 'data:image/png;base64,PORTRAIT_TOO_BIG',
            fullBodyIllustrationUrl: 'data:image/png;base64,FULL_TOO_BIG',
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
    expect(user).not.toContain('PORTRAIT_TOO_BIG');
    expect(user).not.toContain('FULL_TOO_BIG');
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
  it('allows richer usage, structure and memory categories in the annotation instructions', () => {
    const req: PassageAnnotationRequest = {
      level: 'B1',
      sentences: [{ tokens: ['Although', 'it', 'was', 'hard', ',', 'she', 'adapted', '.'], translationJa: '' }],
    };
    const { system } = buildAnnotationMessages(req);
    expect(system).toContain('sentence_structure');
    expect(system).toContain('memory_tip');
    expect(system).toContain('metaphor');
  });

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

  it('lists self-reported idioms/phrasal verbs as required coverage with their category (B-1)', () => {
    const req: PassageAnnotationRequest = {
      level: 'B2',
      sentences: [{ tokens: ['They', 'will', 'bite', 'the', 'bullet', 'soon', '.'], translationJa: '' }],
      expressionSpans: [
        { span: { sentenceIndex: 0, tokenStart: 2, tokenEnd: 5 }, surface: 'bite the bullet', category: 'idiom', meaningJa: '思い切ってやる' },
      ],
    };
    const { user, system } = buildAnnotationMessages(req);
    expect(user).toContain('"bite the bullet" (idiom)');
    expect(system).toContain('self-reported idioms / phrasal verbs / set phrases');
  });

  it('maps a set_phrase expression to the "phrase" annotation category in coverage (B-2)', () => {
    const req: PassageAnnotationRequest = {
      level: 'B2',
      sentences: [{ tokens: ['Please', 'find', 'attached', 'the', 'report', '.'], translationJa: '' }],
      expressionSpans: [
        { span: { sentenceIndex: 0, tokenStart: 0, tokenEnd: 3 }, surface: 'Please find attached', category: 'set_phrase', meaningJa: '添付します' },
      ],
    };
    const { user } = buildAnnotationMessages(req);
    // "set_phrase" is not an annotation category, so it is surfaced as "phrase".
    expect(user).toContain('"Please find attached" (phrase)');
  });

  it('numbers sentences absolutely and adds slice guidance for a chunk request (F-6 本命)', () => {
    // A slice covering the full passage's sentences 20..22, spans keep absolute indices.
    const req: PassageAnnotationRequest = {
      level: 'B2',
      sentenceIndexBase: 20,
      sentences: [
        { tokens: ['First', 'sentence', '.'], translationJa: '' },
        { tokens: ['We', 'adapt', 'fast', '.'], translationJa: '' },
        { tokens: ['Then', 'we', 'rest', '.'], translationJa: '' },
      ],
      targetSpans: [{ sentenceIndex: 21, tokenStart: 1, tokenEnd: 2, wordId: 'adapt', surface: 'adapt', masteryDensity: 'new' }],
    };
    const { system, user } = buildAnnotationMessages(req);
    // Slice guidance is appended so the model preserves absolute indices and stays inside the slice.
    expect(system).toContain('CONTIGUOUS SLICE');
    expect(system).toContain('absolute indices');
    // Sentences are numbered from the absolute base, not from zero.
    expect(user).toContain('"sentenceIndex": 20');
    expect(user).toContain('"sentenceIndex": 22');
    expect(user).not.toContain('"sentenceIndex": 0');
    // The coverage item is resolved from the slice (base-offset) but listed at its absolute index.
    expect(user).toContain('s21: "adapt" (word)');
  });

  it('omits slice guidance and numbers from zero for a whole-passage request (back-compat)', () => {
    const req: PassageAnnotationRequest = {
      level: 'B1',
      sentences: [{ tokens: ['Hi', '.'], translationJa: '' }],
    };
    const { system, user } = buildAnnotationMessages(req);
    expect(system).not.toContain('CONTIGUOUS SLICE');
    expect(user).toContain('"sentenceIndex": 0');
  });
});

describe('ANNOTATION_SYSTEM — cue-density cap (D-1 insurance)', () => {
  it('caps standalone annotation cues per sentence and per passage', () => {
    const { system } = buildAnnotationMessages({ level: 'B1', sentences: [{ tokens: ['Hi', '.'], translationJa: '' }] });
    expect(system).toContain('Annotation budget');
    expect(system).toContain('at most ONE standalone cue per sentence');
    expect(system).toContain('ceil(wordCount / 40)');
  });
});

describe('ANNOTATION_JSON_SCHEMA — cue + sentence-note shape (C-1 / C-4)', () => {
  // R7: the same schema goes to both providers, so strict-mode compliance keeps OpenAI + Anthropic in
  // lockstep. This pins the detailJa / anchorTextParts / sentenceNotes additions.
  it('keeps every object property required for OpenAI strict structured outputs', () => {
    assertOpenAiStrictObjectSchema(ANNOTATION_JSON_SCHEMA);
  });

  it('adds nullable detailJa (C-1) and anchorTextParts (C-4) to each cue', () => {
    const cue = ANNOTATION_JSON_SCHEMA.properties.noticeCues.items;
    expect(cue.required).toContain('detailJa');
    expect(cue.required).toContain('anchorTextParts');
    expect(cue.properties.detailJa.type).toEqual(['string', 'null']);
    expect(cue.properties.anchorTextParts.type).toEqual(['array', 'null']);
  });

  it('adds a sentenceNotes array with labelled chunk ranges (C-4)', () => {
    expect(ANNOTATION_JSON_SCHEMA.required).toContain('sentenceNotes');
    const note = ANNOTATION_JSON_SCHEMA.properties.sentenceNotes.items;
    expect(note.required).toEqual(['sentenceIndex', 'patternNameJa', 'structureJa', 'readingJa', 'chunks']);
    expect(note.properties.chunks.items.required).toEqual(['tokenStart', 'tokenEnd', 'roleJa']);
  });
});

describe('buildAnnotationMessages — C-4 syntax notes + C-1 detailJa guidance', () => {
  it('threads readability + writer-flagged hard sentences into the user message when provided', () => {
    const req: PassageAnnotationRequest = {
      level: 'C1',
      readabilityLevel: 'advanced',
      hardSentenceIndexes: [0, 2],
      sentences: [
        { tokens: ['No', 'sooner', 'had', 'it', 'begun', '.'], translationJa: '' },
        { tokens: ['It', 'ran', '.'], translationJa: '' },
        { tokens: ['Rarely', 'do', 'we', 'see', 'this', '.'], translationJa: '' },
      ],
    };
    const { user, system } = buildAnnotationMessages(req);
    expect(user).toContain('Passage readability: advanced.');
    expect(user).toContain('HARD SENTENCES');
    expect(user).toContain('s0');
    expect(user).toContain('s2');
    expect(system).toContain('SENTENCE STRUCTURE NOTES');
    expect(system).toContain('sentenceNotes');
  });

  it('describes the detailJa and discontinuous anchorTextParts rules', () => {
    const { system } = buildAnnotationMessages({ level: 'B1', sentences: [{ tokens: ['Hi', '.'], translationJa: '' }] });
    expect(system).toContain('detailJa');
    expect(system).toContain('anchorTextParts');
    expect(system).toContain('DISCONTINUOUS');
  });

  it('omits the readability/hard-sentence block when readabilityLevel is absent (back-compat)', () => {
    const { user } = buildAnnotationMessages({ level: 'B1', sentences: [{ tokens: ['Hi', '.'], translationJa: '' }] });
    expect(user).not.toContain('Passage readability');
    expect(user).not.toContain('HARD SENTENCES');
  });
});

describe('annotationMaxTokens (F-6 interim ceiling)', () => {
  it('scales with sentence count and no longer flat-lines at 4000 for long passages', () => {
    expect(annotationMaxTokens(10)).toBe(2800); // 800 + 10·200
    expect(annotationMaxTokens(30)).toBe(6800); // 800 + 30·200 — was clamped to 4000 before F-6
    expect(annotationMaxTokens(35)).toBe(7800); // the 35-sentence acceptance case fits comfortably
    expect(annotationMaxTokens(1000)).toBe(16000); // still capped, but at the raised 16000 ceiling
  });
});
