import { describe, it, expect, vi } from 'vitest';
import {
  ProviderError,
  generatePassage,
  getWordData,
  suggestWords,
  annotatePassage,
  planStory,
  extendStoryPlan,
  illustrateCharacter,
  type Env,
} from './providers';
import type { CharacterIllustrationRequest, GenerationRequest } from '../../src/types/domain';

const req: GenerationRequest = {
  level: 'B1',
  intent: 'business',
  newWordRatio: 0.3,
  wordTarget: 200,
  contentType: 'article',
  targetWords: [],
};

const samplePassage = {
  meta: { title: 't', intent: 'business', level: 'B1', newCount: 0, reviewCount: 0, approxWords: 11 },
  sentences: [{ tokens: ['A', 'small', 'team', 'met', '.'], translationJa: '小さなチームが集まった。' }],
  targetSpans: [],
  collocationSpans: [],
  noticeCues: [],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function openAiCompletion(content: unknown, finish = 'stop'): Response {
  return jsonResponse(200, { choices: [{ message: { content: JSON.stringify(content) }, finish_reason: finish }] });
}

function anthropicMessage(content: unknown, stop = 'end_turn'): Response {
  return jsonResponse(200, { content: [{ type: 'text', text: JSON.stringify(content) }], stop_reason: stop });
}

describe('generatePassage — OpenAI provider (default)', () => {
  it('posts to the chat completions endpoint with the key and returns the passage', async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init };
      return openAiCompletion(samplePassage);
    });
    const env: Env = { OPENAI_API_KEY: 'sk-real-key', OPENAI_MODEL: 'gpt-4o' };

    const res = await generatePassage(env, req, fetchImpl as unknown as typeof fetch);

    expect(captured!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect((captured!.init?.headers as Record<string, string>).authorization).toBe('Bearer sk-real-key');
    const sent = JSON.parse(String(captured!.init?.body));
    expect(sent.model).toBe('gpt-4o');
    expect(sent.response_format.type).toBe('json_schema');
    expect(sent.response_format.json_schema).toMatchObject({ name: 'passage_output', strict: true });
    expect(res.stopReason).toBe('end_turn');
    expect(res.passage.sentences[0]!.tokens).toContain('team');
  });

  it('maps finish_reason "length" to a max_tokens stop reason', async () => {
    const fetchImpl = vi.fn(async () => openAiCompletion(samplePassage, 'length'));
    const env: Env = { OPENAI_API_KEY: 'sk-real-key' };
    const res = await generatePassage(env, req, fetchImpl as unknown as typeof fetch);
    expect(res.stopReason).toBe('max_tokens');
  });

  it('fills missing annotation arrays so the validator can run', async () => {
    const fetchImpl = vi.fn(async () =>
      openAiCompletion({ meta: samplePassage.meta, sentences: samplePassage.sentences }),
    );
    const env: Env = { OPENAI_API_KEY: 'sk-real-key' };
    const res = await generatePassage(env, req, fetchImpl as unknown as typeof fetch);
    expect(res.passage.targetSpans).toEqual([]);
    expect(res.passage.collocationSpans).toEqual([]);
    expect(res.passage.noticeCues).toEqual([]);
  });

  it('re-anchors mis-indexed target and collocation spans by their declared text', async () => {
    const reqWithTargets: GenerationRequest = {
      level: 'B1',
      intent: 'business',
      newWordRatio: 0.3,
      wordTarget: 200,
      contentType: 'article',
      targetWords: [{ wordId: 'agenda', surface: 'agenda', masteryDensity: 'new', attributes: { connotation: 'neutral' } }],
    };
    const passage = {
      meta: { title: 't', intent: 'business', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 9 },
      sentences: [{ tokens: ['We', 'set', 'an', 'agenda', 'for', 'the', 'team', 'meeting', '.'], translationJa: '' }],
      // Wrong indices: "agenda" declared at [0,1) ("We"); collocation declared at [5,9).
      targetSpans: [{ sentenceIndex: 0, tokenStart: 0, tokenEnd: 1, wordId: 'agenda', surface: 'agenda', masteryDensity: 'new' }],
      collocationSpans: [{ sentenceIndex: 0, tokenStart: 5, tokenEnd: 9, headWordId: 'agenda', collocationId: 'set an agenda' }],
      noticeCues: [],
    };
    const fetchImpl = vi.fn(async () => openAiCompletion(passage));
    const res = await generatePassage({ OPENAI_API_KEY: 'sk-real-key' }, reqWithTargets, fetchImpl as unknown as typeof fetch);
    expect(res.passage.targetSpans[0]).toMatchObject({ tokenStart: 3, tokenEnd: 4 }); // "agenda"
    expect(res.passage.collocationSpans[0]).toMatchObject({ tokenStart: 1, tokenEnd: 4 }); // "set an agenda"
    // Notices are produced by the separate annotation pass (annotatePassage), not by generation.
    expect(res.passage.noticeCues).toEqual([]);
  });

  it('re-derives translationSpans char offsets from the model\'s verbatim JA anchor, dropping unlocatable ones (4.2)', async () => {
    const passage = {
      meta: { title: 't', intent: 'business', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 6 },
      sentences: [
        {
          tokens: ['She', 'stayed', 'resilient', '.'],
          translationJa: '彼女は粘り強いままだった。',
          // Model quotes the JA verbatim but supplies no offsets; server re-derives them.
          translationSpans: [
            { anchorTextJa: '粘り強い', refType: 'word', wordId: 'resilient', isNew: true },
            { anchorTextJa: '存在しない語', refType: 'word', wordId: 'ghost', isNew: true },
          ],
        },
      ],
      targetSpans: [],
      collocationSpans: [],
      noticeCues: [],
    };
    const fetchImpl = vi.fn(async () => openAiCompletion(passage));
    const res = await generatePassage({ OPENAI_API_KEY: 'sk-real-key' }, req, fetchImpl as unknown as typeof fetch);
    // '粘り強い' begins at index 3 of "彼女は粘り強いままだった。" and is 4 chars long.
    expect(res.passage.sentences[0]!.translationSpans).toEqual([
      { charStart: 3, charEnd: 7, refType: 'word', wordId: 'resilient', isNew: true },
    ]);
  });

  it('leaves a sentence without translationSpans unchanged (back-compat with old passages)', async () => {
    const fetchImpl = vi.fn(async () => openAiCompletion(samplePassage));
    const res = await generatePassage({ OPENAI_API_KEY: 'sk-real-key' }, req, fetchImpl as unknown as typeof fetch);
    expect(res.passage.sentences[0]!.translationSpans).toBeUndefined();
  });

  it('unwraps a {meta, passage:{sentences}} shape and backfills missing meta from the request', async () => {
    const wrapped = {
      meta: { newCount: 0, reviewCount: 0, approxWords: 11 }, // no title/intent/level
      passage: { sentences: samplePassage.sentences },
    };
    const fetchImpl = vi.fn(async () => openAiCompletion(wrapped));
    const env: Env = { OPENAI_API_KEY: 'sk-real-key' };
    const res = await generatePassage(env, req, fetchImpl as unknown as typeof fetch);
    expect(res.passage.sentences[0]!.tokens).toContain('team');
    expect(res.passage.meta.intent).toBe('business'); // backfilled from request
    expect(res.passage.meta.level).toBe('B1');
  });

  it('attaches storyRef from storyContext even when the model omits it', async () => {
    const fetchImpl = vi.fn(async () => openAiCompletion(samplePassage));
    const storyReq: GenerationRequest = {
      ...req,
      contentType: 'long_story',
      storyContext: {
        storyId: 'story_1',
        chapterIndex: 2,
        plan: {
          storyId: 'story_1',
          contentType: 'long_story',
          genre: 'fantasy',
          titleJa: '星の物語',
          synopsisJa: '星を探す旅。',
          characters: [{ name: 'Mia', role: '主人公', descriptionJa: '好奇心旺盛な少女' }],
          chapters: [{ index: 2, headingJa: '第三章', beatJa: '星へ近づく' }],
        },
      },
    };
    const res = await generatePassage({ OPENAI_API_KEY: 'sk-real-key' }, storyReq, fetchImpl as unknown as typeof fetch);
    expect(res.passage.meta.storyRef).toEqual({ storyId: 'story_1', chapterIndex: 2 });
  });
});

describe('generatePassage — Anthropic provider', () => {
  it('posts to the messages endpoint with x-api-key and output_config, mapping stop_reason', async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init };
      return anthropicMessage(samplePassage);
    });
    const env: Env = { LLM_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'sk-ant-key' };

    const res = await generatePassage(env, req, fetchImpl as unknown as typeof fetch);

    expect(captured!.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = captured!.init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const sent = JSON.parse(String(captured!.init?.body));
    expect(sent.model).toBe('claude-opus-4-8');
    expect(sent.output_config.format.type).toBe('json_schema');
    expect(res.stopReason).toBe('end_turn');
    expect(res.passage.sentences[0]!.tokens).toContain('team');
  });
});

describe('error handling (so the UI can show "API down")', () => {
  it('throws a 503 ProviderError when no key is configured', async () => {
    const fetchImpl = vi.fn();
    await expect(generatePassage({}, req, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({
      status: 503,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats a placeholder key as not configured', async () => {
    const env: Env = { OPENAI_API_KEY: 'sk-...' };
    await expect(generatePassage(env, req)).rejects.toBeInstanceOf(ProviderError);
  });

  it('maps an upstream 429 to a 429 ProviderError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(429, { error: 'rate limited' }));
    const env: Env = { OPENAI_API_KEY: 'sk-real-key' };
    await expect(generatePassage(env, req, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({
      status: 429,
    });
  });

  it('maps an upstream 401 (bad key) to a 503 ProviderError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { error: 'bad key' }));
    const env: Env = { OPENAI_API_KEY: 'sk-real-key' };
    await expect(generatePassage(env, req, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({
      status: 503,
    });
  });

  it('raises when the model returns a passage with no sentences', async () => {
    const fetchImpl = vi.fn(async () => openAiCompletion({ meta: samplePassage.meta, sentences: [] }));
    const env: Env = { OPENAI_API_KEY: 'sk-real-key' };
    await expect(generatePassage(env, req, fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(ProviderError);
  });

  it('surfaces a network failure as a 503', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const env: Env = { OPENAI_API_KEY: 'sk-real-key' };
    await expect(generatePassage(env, req, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({
      status: 503,
    });
  });
});

describe('getWordData', () => {
  it('returns WordData and forces the requested wordId', async () => {
    const word = {
      wordId: 'wrong',
      headword: 'resilient',
      ipa: '/rɪˈzɪljənt/',
      pos: ['adj'],
      register: 'neutral',
      connotation: 'positive',
      frequency: 3,
      core: { meaningsJa: ['回復力のある'], examples: [], collocations: [], synonymNuances: [] },
    };
    const fetchImpl = vi.fn(async () => openAiCompletion(word));
    const env: Env = { OPENAI_API_KEY: 'sk-real-key' };
    const res = await getWordData(env, 'resilient', fetchImpl as unknown as typeof fetch);
    expect(res.wordId).toBe('resilient');
    expect(res.headword).toBe('resilient');
  });

  it('prunes empty/null more fields so only grounded attributes remain', async () => {
    const word = {
      wordId: 'x',
      headword: 'resilient',
      ipa: '/rɪˈzɪljənt/',
      pos: ['adj'],
      register: 'neutral',
      connotation: 'positive',
      frequency: 3,
      memoryTips: [
        { kind: 'etymology', tipJa: 're- の戻るイメージで覚える。' },
        { kind: 'bad', tipJa: 'drop me' },
        { kind: 'image', tipJa: '' },
      ],
      core: { meaningsJa: ['回復力のある'], examples: [], collocations: ['remain resilient'], synonymNuances: [] },
      more: {
        etymology: {
          prefix: null,
          root: 'salire',
          suffix: null,
          noteJa: 'ラテン語 salire は「跳ぶ」。跳ね返るイメージから回復する力へ広がった。',
        },
        semanticNetwork: { synonyms: [], antonyms: [], hypernyms: [], hyponyms: [], related: [] },
        wordFamily: ['resilience'],
        idioms: [],
        grammarPatterns: [],
        metaphor: null,
        commonErrors: [],
      },
    };
    const fetchImpl = vi.fn(async () => openAiCompletion(word));
    const env: Env = { OPENAI_API_KEY: 'sk-real-key' };
    const res = await getWordData(env, 'resilient', fetchImpl as unknown as typeof fetch);
    expect(res.more).toEqual({
      etymology: {
        root: 'salire',
        noteJa: 'ラテン語 salire は「跳ぶ」。跳ね返るイメージから回復する力へ広がった。',
      },
      wordFamily: ['resilience'],
    });
    expect(res.memoryTips).toEqual([{ kind: 'etymology', tipJa: 're- の戻るイメージで覚える。' }]);
  });
});

describe('suggestWords', () => {
  it('returns cleaned lemmas: lowercased, deduped, multiword + excluded dropped, capped to count', async () => {
    const fetchImpl = vi.fn(async () =>
      openAiCompletion({ words: ['Agenda', 'consensus', 'agenda', 'close a deal', 'stakeholder', 'defer'] }),
    );
    const env: Env = { OPENAI_API_KEY: 'sk-real-key' };
    const words = await suggestWords(
      env,
      { level: 'B1', intent: 'business', count: 3, exclude: ['Stakeholder'] },
      fetchImpl as unknown as typeof fetch,
    );
    expect(words).toEqual(['agenda', 'consensus', 'defer']);
  });

  it('tolerates a non-array reply and returns an empty list', async () => {
    const fetchImpl = vi.fn(async () => openAiCompletion({ words: null }));
    const env: Env = { OPENAI_API_KEY: 'sk-real-key' };
    const words = await suggestWords(env, { level: 'B1', intent: 'business', count: 5 }, fetchImpl as unknown as typeof fetch);
    expect(words).toEqual([]);
  });
});

describe('planStory (Requirement 6.2 / 13.2)', () => {
  const planReply = {
    titleJa: '竜の物語',
    synopsisJa: '竜と少女の冒険。',
    characters: [
      { name: 'Aria', role: 'hero', descriptionJa: '勇敢な少女' },
      { name: 'Draco', role: 'dragon', descriptionJa: '孤独な竜' },
    ],
    chapters: [
      { index: 0, headingJa: '第一章', beatJa: '出会い' },
      { index: 1, headingJa: '第二章', beatJa: '試練' },
    ],
  };

  it('returns a plan with characters, synopsis and chapters, assigning a storyId', async () => {
    const fetchImpl = vi.fn(async () => openAiCompletion(planReply));
    const plan = await planStory(
      { OPENAI_API_KEY: 'sk-real-key' },
      { contentType: 'long_story', genre: 'fantasy', intent: 'daily', level: 'B1' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(plan.storyId).toBeTruthy();
    expect(plan.contentType).toBe('long_story');
    expect(plan.characters).toHaveLength(2);
    expect(plan.chapters.map((c) => c.index)).toEqual([0, 1]);
    expect(plan.synopsisJa).toBe('竜と少女の冒険。');
  });

  it('collapses a short story to a single chapter regardless of the model reply', async () => {
    const fetchImpl = vi.fn(async () => openAiCompletion(planReply)); // reply has 2 chapters
    const plan = await planStory(
      { OPENAI_API_KEY: 'sk-real-key' },
      { contentType: 'short_story', genre: 'mystery', intent: 'daily', level: 'B1' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(plan.contentType).toBe('short_story');
    expect(plan.chapters).toHaveLength(1);
  });

  it('carries the homage reference through to the plan', async () => {
    const fetchImpl = vi.fn(async () => openAiCompletion(planReply));
    const plan = await planStory(
      { OPENAI_API_KEY: 'sk-real-key' },
      { contentType: 'short_story', genre: 'mystery', homageTitle: 'Sherlock Holmes', intent: 'daily', level: 'B2' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(plan.homage?.title).toBe('Sherlock Holmes');
  });

  it('throws when the plan has no chapters', async () => {
    const fetchImpl = vi.fn(async () => openAiCompletion({ ...planReply, chapters: [] }));
    await expect(
      planStory(
        { OPENAI_API_KEY: 'sk-real-key' },
        { contentType: 'long_story', genre: 'fantasy', intent: 'daily', level: 'B1' },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('extendStoryPlan (long-story continuation)', () => {
  const existingPlan = {
    storyId: 'story_1',
    contentType: 'long_story' as const,
    genre: 'fantasy',
    titleJa: '星の物語',
    synopsisJa: '星を探す旅。',
    characters: [{ name: 'Mia', role: '主人公', descriptionJa: '好奇心旺盛な少女' }],
    chapters: [{ index: 0, headingJa: '第一章', beatJa: '旅立ち' }],
  };

  it('appends generated future chapter beats starting at nextChapterIndex', async () => {
    const fetchImpl = vi.fn(async () =>
      openAiCompletion({
        synopsisJa: '星を探す旅は、星の門の向こうへ続く。',
        chapters: [
          { index: 99, headingJa: '第二章', beatJa: '星の門を開く' },
          { index: 100, headingJa: '第三章', beatJa: '影の街へ進む' },
        ],
      }),
    );

    const extended = await extendStoryPlan(
      { OPENAI_API_KEY: 'sk-real-key' },
      { plan: existingPlan, nextChapterIndex: 1, priorSummaryJa: 'ミアは旅立った。', additionalChapters: 2 },
      fetchImpl as unknown as typeof fetch,
    );

    expect(extended.synopsisJa).toContain('星の門');
    expect(extended.chapters.map((chapter) => chapter.index)).toEqual([0, 1, 2]);
    expect(extended.chapters[1]!.beatJa).toBe('星の門を開く');
    const sent = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    expect(sent.response_format.json_schema.name).toBe('story_plan_extension');
    expect(String(sent.messages[1]!.content)).toContain('ミアは旅立った。');
  });

  it('rejects non-long-story plans', async () => {
    await expect(
      extendStoryPlan(
        { OPENAI_API_KEY: 'sk-real-key' },
        { plan: { ...existingPlan, contentType: 'short_story' }, nextChapterIndex: 1 },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('illustrateCharacter (Requirement 6.8 — IMAGE_PROVIDER-switched portrait)', () => {
  const charReq: CharacterIllustrationRequest = {
    name: 'Aria',
    role: '主人公',
    descriptionJa: '勇敢な少女',
    genre: 'fantasy',
    styleHint: '幻想的な作風',
  };

  function openAiImage(b64: string): Response {
    return jsonResponse(200, { data: [{ b64_json: b64 }] });
  }

  it('defaults to OpenAI: POSTs to the images endpoint with the key and returns a PNG data URL', async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init };
      return openAiImage('QUJD');
    });
    const env: Env = { OPENAI_API_KEY: 'sk-real-key' };

    const dataUrl = await illustrateCharacter(env, charReq, fetchImpl as unknown as typeof fetch);

    expect(captured!.url).toBe('https://api.openai.com/v1/images/generations');
    expect((captured!.init?.headers as Record<string, string>).authorization).toBe('Bearer sk-real-key');
    const sent = JSON.parse(String(captured!.init?.body));
    expect(sent.model).toBe('gpt-image-1');
    expect(sent.n).toBe(1);
    expect(typeof sent.prompt).toBe('string');
    // The character's role/description feed the prompt so portraits match the plan.
    expect(sent.prompt).toContain('Aria');
    expect(dataUrl).toBe('data:image/png;base64,QUJD');
  });

  it('honors IMAGE_MODEL and reuses OPENAI_API_KEY for the openai image provider', async () => {
    let captured: { init?: RequestInit } | null = null;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      captured = { init };
      return openAiImage('QUJD');
    });
    const env: Env = { IMAGE_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-real-key', IMAGE_MODEL: 'gpt-image-1-mini' };
    await illustrateCharacter(env, charReq, fetchImpl as unknown as typeof fetch);
    expect(JSON.parse(String(captured!.init?.body)).model).toBe('gpt-image-1-mini');
  });

  it('switches to Gemini (Imagen) when IMAGE_PROVIDER=gemini, reading the inline base64 image', async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init };
      return jsonResponse(200, { predictions: [{ bytesBase64Encoded: 'R0lG' }] });
    });
    const env: Env = { IMAGE_PROVIDER: 'gemini', GEMINI_API_KEY: 'gm-key' };

    const dataUrl = await illustrateCharacter(env, charReq, fetchImpl as unknown as typeof fetch);

    expect(captured!.url).toContain('imagen');
    expect(captured!.url).toContain('gm-key'); // key passed as query param, per the Imagen REST contract
    expect(dataUrl).toBe('data:image/png;base64,R0lG');
  });

  it('throws a 503 ProviderError when the active image key is missing', async () => {
    const fetchImpl = vi.fn();
    await expect(
      illustrateCharacter({ IMAGE_PROVIDER: 'gemini' }, charReq, fetchImpl as unknown as typeof fetch),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps an upstream 429 to a 429 ProviderError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(429, { error: 'rate limited' }));
    await expect(
      illustrateCharacter({ OPENAI_API_KEY: 'sk-real-key' }, charReq, fetchImpl as unknown as typeof fetch),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('raises a 502 when the provider returns no image payload', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { data: [] }));
    await expect(
      illustrateCharacter({ OPENAI_API_KEY: 'sk-real-key' }, charReq, fetchImpl as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('annotatePassage', () => {
  const sentences = [
    { tokens: ['The', 'board', 'will', 'bite', 'the', 'bullet', '.'], translationJa: '' },
    { tokens: ['It', 'paid', 'off', '.'], translationJa: '' },
  ];

  it('re-derives each cue span from its verbatim anchorText and numbers them in reading order', async () => {
    const reply = {
      noticeCues: [
        // Listed out of reading order; the model's indices are unreliable (deliberately wrong here).
        { span: { sentenceIndex: 1, tokenStart: 0, tokenEnd: 0 }, category: 'phrasal_verb', anchorText: 'paid off', explanationJa: '報われた' },
        { span: { sentenceIndex: 0, tokenStart: 9, tokenEnd: 9 }, category: 'idiom', anchorText: 'bite the bullet', explanationJa: '思い切ってやる' },
      ],
    };
    const fetchImpl = vi.fn(async () => openAiCompletion(reply));
    const cues = await annotatePassage({ OPENAI_API_KEY: 'sk-real-key' }, { sentences, level: 'B1' }, fetchImpl as unknown as typeof fetch);
    expect(cues.map((c) => [c.category, c.index, c.span.sentenceIndex, c.span.tokenStart, c.span.tokenEnd])).toEqual([
      ['idiom', 1, 0, 3, 6], // "bite the bullet"
      ['phrasal_verb', 2, 1, 1, 3], // "paid off"
    ]);
  });

  it('drops a cue whose anchorText does not occur in the passage', async () => {
    const reply = { noticeCues: [{ span: { sentenceIndex: 0, tokenStart: 0, tokenEnd: 1 }, category: 'idiom', anchorText: 'kick the bucket', explanationJa: '' }] };
    const fetchImpl = vi.fn(async () => openAiCompletion(reply));
    const cues = await annotatePassage({ OPENAI_API_KEY: 'sk-real-key' }, { sentences, level: 'B1' }, fetchImpl as unknown as typeof fetch);
    expect(cues).toEqual([]);
  });

  it('degrades to no cues on a truncated (max_tokens) reply', async () => {
    const fetchImpl = vi.fn(async () => openAiCompletion({ noticeCues: [] }, 'length'));
    const cues = await annotatePassage({ OPENAI_API_KEY: 'sk-real-key' }, { sentences, level: 'B1' }, fetchImpl as unknown as typeof fetch);
    expect(cues).toEqual([]);
  });

  it('returns no cues for an empty passage without calling the model', async () => {
    const fetchImpl = vi.fn();
    const cues = await annotatePassage({ OPENAI_API_KEY: 'sk-real-key' }, { sentences: [], level: 'B1' }, fetchImpl as unknown as typeof fetch);
    expect(cues).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
