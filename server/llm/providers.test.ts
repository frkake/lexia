import { describe, it, expect, vi } from 'vitest';
import {
  ProviderError,
  generatePassage,
  getWordData,
  suggestWords,
  annotatePassage,
  planAnnotationChunks,
  salvageCues,
  planStory,
  extendStoryPlan,
  healthStatus,
  illustrateCharacter,
  illustratePassage,
  resolveImageProfile,
  describeImageConfig,
  requireImageKey,
  type Env,
} from './providers';
import type { CharacterIllustrationRequest, GenerationRequest, PassageIllustrationRequest } from '../../src/types/domain';

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

  it('carries paragraphIndex through and re-anchors expressionSpans by their surface (B-1/F-8②)', async () => {
    const passage = {
      meta: { title: 't', intent: 'business', level: 'B1', newCount: 0, reviewCount: 0, approxWords: 12 },
      sentences: [
        { tokens: ['We', 'need', 'to', 'come', 'up', 'with', 'a', 'plan', '.'], translationJa: '', paragraphIndex: 0 },
        { tokens: ['In', 'the', 'long', 'run', ',', 'it', 'pays', 'off', '.'], translationJa: '', paragraphIndex: 1 },
      ],
      targetSpans: [],
      collocationSpans: [],
      noticeCues: [],
      // The model miscounts the indices; the server relocates each by its verbatim surface.
      expressionSpans: [
        { span: { sentenceIndex: 0, tokenStart: 0, tokenEnd: 0 }, surface: 'come up with', category: 'phrasal_verb', meaningJa: '思いつく' },
        { span: { sentenceIndex: 1, tokenStart: 9, tokenEnd: 9 }, surface: 'in the long run', category: 'idiom', meaningJa: '長い目で見れば' },
      ],
    };
    const fetchImpl = vi.fn(async () => openAiCompletion(passage));
    const res = await generatePassage({ OPENAI_API_KEY: 'sk-real-key' }, req, fetchImpl as unknown as typeof fetch);
    expect(res.passage.sentences[0]!.paragraphIndex).toBe(0);
    expect(res.passage.sentences[1]!.paragraphIndex).toBe(1);
    expect(res.passage.expressionSpans).toEqual([
      { span: { sentenceIndex: 0, tokenStart: 3, tokenEnd: 6 }, surface: 'come up with', category: 'phrasal_verb', meaningJa: '思いつく' },
      { span: { sentenceIndex: 1, tokenStart: 0, tokenEnd: 4 }, surface: 'in the long run', category: 'idiom', meaningJa: '長い目で見れば' },
    ]);
  });

  it('carries syntaxSpans through, dropping unknown patterns / out-of-range sentences / empty anchors (B-3)', async () => {
    const passage = {
      meta: { title: 't', intent: 'business', level: 'C1', newCount: 0, reviewCount: 0, approxWords: 10 },
      sentences: [
        { tokens: ['Not', 'only', 'did', 'the', 'team', 'win', ',', 'but', 'they', 'thrived', '.'], translationJa: '' },
      ],
      targetSpans: [],
      collocationSpans: [],
      noticeCues: [],
      expressionSpans: [],
      syntaxSpans: [
        { sentenceIndex: 0, pattern: 'inversion', anchorText: 'Not only did the team win', noteJa: '倒置。' },
        { sentenceIndex: 0, pattern: 'bogus_pattern', anchorText: 'the team', noteJa: '' }, // unknown pattern
        { sentenceIndex: 5, pattern: 'cleft', anchorText: 'out of range', noteJa: '' }, // sentenceIndex OOB
        { sentenceIndex: 0, pattern: 'participial', anchorText: '   ', noteJa: '' }, // empty anchor
      ],
    };
    const fetchImpl = vi.fn(async () => openAiCompletion(passage));
    const res = await generatePassage({ OPENAI_API_KEY: 'sk-real-key' }, req, fetchImpl as unknown as typeof fetch);
    expect(res.passage.syntaxSpans).toEqual([
      { sentenceIndex: 0, pattern: 'inversion', anchorText: 'Not only did the team win', noteJa: '倒置。' },
    ]);
  });

  it('always attaches syntaxSpans (possibly empty) so the validator gates run on new-pipeline passages (B-3)', async () => {
    const fetchImpl = vi.fn(async () => openAiCompletion(samplePassage));
    const res = await generatePassage({ OPENAI_API_KEY: 'sk-real-key' }, req, fetchImpl as unknown as typeof fetch);
    expect(res.passage.syntaxSpans).toEqual([]);
  });

  it('drops an expressionSpan with an unknown category or an unlocatable surface', async () => {
    const passage = {
      meta: { title: 't', intent: 'business', level: 'B1', newCount: 0, reviewCount: 0, approxWords: 5 },
      sentences: [{ tokens: ['It', 'paid', 'off', 'nicely', '.'], translationJa: '' }],
      targetSpans: [],
      collocationSpans: [],
      noticeCues: [],
      expressionSpans: [
        { span: { sentenceIndex: 0, tokenStart: 0, tokenEnd: 0 }, surface: 'paid off', category: 'nonsense', meaningJa: '' },
        { span: { sentenceIndex: 0, tokenStart: 0, tokenEnd: 0 }, surface: 'kick the bucket', category: 'idiom', meaningJa: '' },
      ],
    };
    const fetchImpl = vi.fn(async () => openAiCompletion(passage));
    const res = await generatePassage({ OPENAI_API_KEY: 'sk-real-key' }, req, fetchImpl as unknown as typeof fetch);
    expect(res.passage.expressionSpans).toEqual([]); // bad category + missing surface both dropped
  });

  it('resolves a structured collocationId via the D4 id → surface fallback when re-anchoring', async () => {
    const structuredReq: GenerationRequest = {
      ...req,
      targetWords: [
        {
          wordId: 'agenda',
          surface: 'agenda',
          masteryDensity: 'new',
          attributes: { core: { collocations: [{ id: 'set-an-agenda', text: 'set an agenda' }] } },
        },
      ],
    };
    const passage = {
      meta: { title: 't', intent: 'business', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 8 },
      sentences: [{ tokens: ['We', 'set', 'an', 'agenda', 'for', 'the', 'team', '.'], translationJa: '' }],
      targetSpans: [{ sentenceIndex: 0, tokenStart: 3, tokenEnd: 4, wordId: 'agenda', surface: 'agenda', masteryDensity: 'new' }],
      // collocationId is the kebab id; the server resolves it to "set an agenda" to locate tokens [1,4).
      collocationSpans: [{ sentenceIndex: 0, tokenStart: 8, tokenEnd: 9, headWordId: 'agenda', collocationId: 'set-an-agenda' }],
      noticeCues: [],
    };
    const fetchImpl = vi.fn(async () => openAiCompletion(passage));
    const res = await generatePassage({ OPENAI_API_KEY: 'sk-real-key' }, structuredReq, fetchImpl as unknown as typeof fetch);
    expect(res.passage.collocationSpans[0]).toMatchObject({ tokenStart: 1, tokenEnd: 4, collocationId: 'set-an-agenda' });
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

  it('keeps request-owned intent and level authoritative when the model returns drifted meta', async () => {
    const drifted = {
      ...samplePassage,
      meta: { ...samplePassage.meta, intent: 'academic', level: 'C2' },
    };
    const fetchImpl = vi.fn(async () => openAiCompletion(drifted));
    const res = await generatePassage({ OPENAI_API_KEY: 'sk-real-key' }, req, fetchImpl as unknown as typeof fetch);
    expect(res.passage.meta.intent).toBe('business');
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
    // Legacy prefix/root/suffix etymology is lifted to EtymologyV2; empty arrays/null still prune.
    expect(res.more).toEqual({
      etymology: {
        parts: [{ form: 'salire', surfaceIn: null, meaningJa: '' }],
        bridgeJa: 'ラテン語 salire は「跳ぶ」。跳ね返るイメージから回復する力へ広がった。',
        cognates: [],
      },
      wordFamily: ['resilience'],
    });
    expect(res.memoryTips).toEqual([{ kind: 'etymology', tipJa: 're- の戻るイメージで覚える。' }]);
  });

  it('lifts legacy plain-string collocations into structured CollocationEntry rows (C-3)', async () => {
    const word = {
      wordId: 'resilient',
      headword: 'resilient',
      ipa: '',
      pos: ['adj'],
      register: 'neutral',
      connotation: 'positive',
      frequency: 3,
      core: { meaningsJa: ['回復力のある'], examples: [], collocations: ['remain resilient'], synonymNuances: [] },
    };
    const fetchImpl = vi.fn(async () => openAiCompletion(word));
    const res = await getWordData({ OPENAI_API_KEY: 'sk-real-key' }, 'resilient', fetchImpl as unknown as typeof fetch);
    expect(res.core.collocations).toEqual([
      { id: 'remain-resilient', pattern: 'remain resilient', type: 'other', slotExamples: [], glossJa: '', l1Contrast: false },
    ]);
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

describe('illustrateCharacter (Requirement 6.8 — IMAGE_PROVIDER-switched character image)', () => {
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
    expect(sent.size).toBe('1024x1536');
    expect(typeof sent.prompt).toBe('string');
    // The character's role/description feed the prompt so illustrations match the plan.
    expect(sent.prompt).toContain('Aria');
    expect(sent.prompt).toContain('Full-body');
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

  it('uses a square image request for character portraits', async () => {
    let captured: { init?: RequestInit } | null = null;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      captured = { init };
      return openAiImage('QUJD');
    });
    const env: Env = { IMAGE_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-real-key' };
    await illustrateCharacter(env, { ...charReq, variant: 'portrait' }, fetchImpl as unknown as typeof fetch);

    const sent = JSON.parse(String(captured!.init?.body));
    expect(sent.size).toBe('1024x1024');
    expect(sent.prompt).toContain('Portrait bust composition');
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

describe('illustratePassage (IMAGE_PROVIDER-switched scene illustration)', () => {
  function openAiScene(b64: string): Response {
    return jsonResponse(200, { data: [{ b64_json: b64 }] });
  }

  const sceneReq: PassageIllustrationRequest = {
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
  };

  it('posts a landscape OpenAI image request and returns a PNG data URL', async () => {
    let captured: { init?: RequestInit } | null = null;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      captured = { init };
      return openAiScene('U0NFTkU=');
    });

    const dataUrl = await illustratePassage({ OPENAI_API_KEY: 'sk-real-key' }, sceneReq, fetchImpl as unknown as typeof fetch);

    const sent = JSON.parse(String(captured!.init?.body));
    expect(sent.size).toBe('1536x1024');
    expect(sent.prompt).toContain('Mia found a glowing map.');
    expect(sent.prompt).toContain('no text, letters, captions');
    expect(dataUrl).toBe('data:image/png;base64,U0NFTkU=');
  });

  it('switches to Gemini using a 16:9 aspect ratio', async () => {
    let captured: { init?: RequestInit } | null = null;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      captured = { init };
      return jsonResponse(200, { predictions: [{ bytesBase64Encoded: 'R0lG' }] });
    });

    const dataUrl = await illustratePassage(
      { IMAGE_PROVIDER: 'gemini', GEMINI_API_KEY: 'gm-key' },
      sceneReq,
      fetchImpl as unknown as typeof fetch,
    );

    const sent = JSON.parse(String(captured!.init?.body));
    expect(sent.parameters.aspectRatio).toBe('16:9');
    expect(dataUrl).toBe('data:image/png;base64,R0lG');
  });
});

describe('image provider descriptor table (E-1: openai / grok / gemini)', () => {
  const charReq: CharacterIllustrationRequest = {
    name: 'Aria',
    role: '主人公',
    descriptionJa: '勇敢な少女',
    genre: 'fantasy',
    styleHint: '幻想的な作風',
  };
  const sceneReq: PassageIllustrationRequest = {
    title: '星の少女 第一章',
    intent: 'daily',
    level: 'B1',
    sentences: [{ tokens: ['Mia', 'found', 'a', 'map', '.'], translationJa: '' }],
  };
  function imageResponse(b64: string): Response {
    return jsonResponse(200, { data: [{ b64_json: b64 }] });
  }
  type Captured = { url: string; init?: RequestInit };
  function capturing(response: () => Response): { fetchImpl: typeof fetch; calls: Captured[] } {
    const calls: Captured[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return response();
    });
    return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
  }

  it('routes to Grok (XAI_API_KEY) with a JPEG data URL and NO size/quality fields', async () => {
    const { fetchImpl, calls } = capturing(() => imageResponse('R3Jvaw=='));
    const env: Env = { IMAGE_PROVIDER: 'grok', XAI_API_KEY: 'xai-key' };

    const dataUrl = await illustrateCharacter(env, charReq, fetchImpl);

    expect(calls[0]!.url).toBe('https://api.x.ai/v1/images/generations');
    expect((calls[0]!.init!.headers as Record<string, string>).authorization).toBe('Bearer xai-key');
    const sent = JSON.parse(String(calls[0]!.init!.body));
    expect(sent.model).toBe('grok-2-image');
    expect(sent.n).toBe(1);
    expect(sent.size).toBeUndefined();
    expect(sent.quality).toBeUndefined();
    // Grok ignores `size`, so aspect is steered via a prompt suffix instead.
    expect(sent.prompt).toContain('3:4');
    expect(dataUrl).toBe('data:image/jpeg;base64,R3Jvaw==');
  });

  it('accepts the "xai" provider alias and the GROK_API_KEY key alias', async () => {
    const { fetchImpl, calls } = capturing(() => imageResponse('QQ=='));
    await illustrateCharacter({ IMAGE_PROVIDER: 'xai', GROK_API_KEY: 'grok-key' }, charReq, fetchImpl);
    expect(calls[0]!.url).toBe('https://api.x.ai/v1/images/generations');
    expect((calls[0]!.init!.headers as Record<string, string>).authorization).toBe('Bearer grok-key');
  });

  it('OpenAI default still returns a PNG data URL and includes size', async () => {
    const { fetchImpl, calls } = capturing(() => imageResponse('T3A='));
    const dataUrl = await illustrateCharacter({ OPENAI_API_KEY: 'sk-real-key' }, charReq, fetchImpl);
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/images/generations');
    const sent = JSON.parse(String(calls[0]!.init!.body));
    expect(sent.size).toBe('1024x1536');
    expect(dataUrl).toBe('data:image/png;base64,T3A=');
  });

  it('does NOT silently coerce a typo IMAGE_PROVIDER to openai — throws 503 before fetching', async () => {
    const { fetchImpl } = capturing(() => imageResponse('QQ=='));
    await expect(
      illustrateCharacter({ IMAGE_PROVIDER: 'grk', XAI_API_KEY: 'xai-key' }, charReq, fetchImpl),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('scene art defaults to the quality profile → OpenAI body carries quality: "high"', async () => {
    const { fetchImpl, calls } = capturing(() => imageResponse('U0M='));
    await illustratePassage({ OPENAI_API_KEY: 'sk-real-key' }, sceneReq, fetchImpl);
    const sent = JSON.parse(String(calls[0]!.init!.body));
    expect(sent.quality).toBe('high');
    expect(sent.size).toBe('1536x1024');
  });

  it('character art defaults to the fast profile → OpenAI body carries quality: "low"', async () => {
    const { fetchImpl, calls } = capturing(() => imageResponse('QQ=='));
    await illustrateCharacter({ OPENAI_API_KEY: 'sk-real-key' }, charReq, fetchImpl);
    expect(JSON.parse(String(calls[0]!.init!.body)).quality).toBe('low');
  });

  it('an explicit quality profile lifts character art to OpenAI quality: "high"', async () => {
    const { fetchImpl, calls } = capturing(() => imageResponse('QQ=='));
    await illustrateCharacter({ OPENAI_API_KEY: 'sk-real-key' }, charReq, fetchImpl, 'quality');
    expect(JSON.parse(String(calls[0]!.init!.body)).quality).toBe('high');
  });

  it('resolves fast vs quality profiles to different providers + models via env', async () => {
    const { fetchImpl, calls } = capturing(() =>
      // Two calls in this test; each mock reply is a valid image so both succeed.
      imageResponse('SU1H'),
    );
    const env: Env = {
      IMAGE_PROVIDER_FAST: 'grok',
      XAI_API_KEY: 'xai-key',
      IMAGE_MODEL_FAST: 'grok-2-image-1212',
      IMAGE_PROVIDER_QUALITY: 'openai',
      OPENAI_API_KEY: 'sk-real-key',
      IMAGE_MODEL_QUALITY: 'gpt-image-1',
    };

    const fastUrl = await illustrateCharacter(env, charReq, fetchImpl); // default profile = fast → grok
    expect(calls[0]!.url).toBe('https://api.x.ai/v1/images/generations');
    expect(JSON.parse(String(calls[0]!.init!.body)).model).toBe('grok-2-image-1212');
    expect(fastUrl.startsWith('data:image/jpeg;base64,')).toBe(true);

    const qualityUrl = await illustratePassage(env, sceneReq, fetchImpl); // default profile = quality → openai
    expect(calls[1]!.url).toBe('https://api.openai.com/v1/images/generations');
    expect(JSON.parse(String(calls[1]!.init!.body)).model).toBe('gpt-image-1');
    expect(qualityUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('per-profile model overrides fall back to legacy IMAGE_MODEL then the descriptor default', async () => {
    const { fetchImpl, calls } = capturing(() => imageResponse('QQ=='));
    // No IMAGE_MODEL_* set, but legacy IMAGE_MODEL is honored for backward compatibility.
    await illustrateCharacter({ OPENAI_API_KEY: 'sk-real-key', IMAGE_MODEL: 'gpt-image-1-mini' }, charReq, fetchImpl);
    expect(JSON.parse(String(calls[0]!.init!.body)).model).toBe('gpt-image-1-mini');
  });
});

describe('resolveImageProfile (E-1 handler precedence)', () => {
  it('prefers an explicit body imagePreference over the endpoint default', () => {
    expect(resolveImageProfile({ imagePreference: 'quality' }, 'fast')).toBe('quality');
    expect(resolveImageProfile({ imagePreference: 'fast' }, 'quality')).toBe('fast');
  });

  it('falls back to the endpoint use-based default when the body omits imagePreference', () => {
    expect(resolveImageProfile({}, 'fast')).toBe('fast'); // /api/story:illustrate (character)
    expect(resolveImageProfile({}, 'quality')).toBe('quality'); // /api/passages:illustrate (scene)
    expect(resolveImageProfile(null, 'quality')).toBe('quality');
    expect(resolveImageProfile(undefined, 'fast')).toBe('fast');
  });

  it('ignores an out-of-range imagePreference value', () => {
    expect(resolveImageProfile({ imagePreference: 'ultra' as never }, 'fast')).toBe('fast');
  });
});

describe('describeImageConfig (E-1 startup diagnostic)', () => {
  it('flags a typo IMAGE_PROVIDER as unknown for both profiles (no secret leak)', () => {
    const diag = describeImageConfig({ IMAGE_PROVIDER: 'grk' });
    expect(diag.map((d) => d.status)).toEqual(['unknown_provider', 'unknown_provider']);
    expect(diag[0]!.rawProvider).toBe('grk');
    expect(diag[0]!.model).toBe('');
  });

  it('reports per-profile provider, key length, and model', () => {
    const diag = describeImageConfig({
      IMAGE_PROVIDER_FAST: 'grok',
      XAI_API_KEY: 'xai-key-123',
      IMAGE_PROVIDER_QUALITY: 'openai',
      OPENAI_API_KEY: 'sk-real-key',
    });
    const fast = diag.find((d) => d.profile === 'fast')!;
    expect(fast).toMatchObject({ provider: 'grok', keyEnvName: 'XAI_API_KEY', status: 'ok', model: 'grok-2-image' });
    expect(fast.keyLength).toBe('xai-key-123'.length);
    const quality = diag.find((d) => d.profile === 'quality')!;
    expect(quality).toMatchObject({ provider: 'openai', keyEnvName: 'OPENAI_API_KEY', status: 'ok', model: 'gpt-image-1' });
  });

  it('marks a missing key for the resolved provider', () => {
    const diag = describeImageConfig({ IMAGE_PROVIDER: 'gemini' });
    expect(diag[0]!).toMatchObject({ provider: 'gemini', keyEnvName: 'GEMINI_API_KEY', status: 'missing_key' });
  });

  it('skips a placeholder first key and reports the real fall-through key (matches requireImageKey)', () => {
    // grok keyEnvNames = ['XAI_API_KEY', 'GROK_API_KEY']. requireImageKey skips the placeholder
    // XAI_API_KEY and returns the real GROK_API_KEY, so image generation works — the diagnostic
    // must report 'ok'/GROK_API_KEY, not falsely flag XAI_API_KEY as a placeholder.
    const env = {
      IMAGE_PROVIDER_FAST: 'grok',
      XAI_API_KEY: 'xai-...',
      GROK_API_KEY: 'xai-realkey123',
    };
    // The request path succeeds with the real key.
    expect(requireImageKey(env, 'grok')).toBe('xai-realkey123');
    const fast = describeImageConfig(env).find((d) => d.profile === 'fast')!;
    expect(fast).toMatchObject({ provider: 'grok', keyEnvName: 'GROK_API_KEY', status: 'ok' });
    expect(fast.keyLength).toBe('xai-realkey123'.length);
  });

  it('reports placeholder_key only when every candidate key is empty or a placeholder', () => {
    const env = { IMAGE_PROVIDER_FAST: 'grok', XAI_API_KEY: 'xai-...' };
    // The request path throws because no usable key exists.
    expect(() => requireImageKey(env, 'grok')).toThrow(/not configured/i);
    const fast = describeImageConfig(env).find((d) => d.profile === 'fast')!;
    expect(fast).toMatchObject({ provider: 'grok', keyEnvName: 'XAI_API_KEY', status: 'placeholder_key' });
    expect(fast.keyLength).toBe('xai-...'.length);
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
    const { noticeCues, status } = await annotatePassage({ OPENAI_API_KEY: 'sk-real-key' }, { sentences, level: 'B1' }, fetchImpl as unknown as typeof fetch);
    expect(status).toBe('complete');
    expect(noticeCues.map((c) => [c.category, c.index, c.span.sentenceIndex, c.span.tokenStart, c.span.tokenEnd])).toEqual([
      ['idiom', 1, 0, 3, 6], // "bite the bullet"
      ['phrasal_verb', 2, 1, 1, 3], // "paid off"
    ]);
  });

  it('drops a cue whose anchorText does not occur in the passage', async () => {
    const reply = { noticeCues: [{ span: { sentenceIndex: 0, tokenStart: 0, tokenEnd: 1 }, category: 'idiom', anchorText: 'kick the bucket', explanationJa: '' }] };
    const fetchImpl = vi.fn(async () => openAiCompletion(reply));
    const { noticeCues, status } = await annotatePassage({ OPENAI_API_KEY: 'sk-real-key' }, { sentences, level: 'B1' }, fetchImpl as unknown as typeof fetch);
    expect(noticeCues).toEqual([]);
    // The model completed; it simply hallucinated an anchor. Still a `complete` pass, not a failure.
    expect(status).toBe('complete');
  });

  it('reports failed (no silent empty) on a truncated (max_tokens) reply so the reader can recover (F-6)', async () => {
    const fetchImpl = vi.fn(async () => openAiCompletion({ noticeCues: [] }, 'length'));
    const { noticeCues, status } = await annotatePassage({ OPENAI_API_KEY: 'sk-real-key' }, { sentences, level: 'B1' }, fetchImpl as unknown as typeof fetch);
    expect(noticeCues).toEqual([]);
    expect(status).toBe('failed');
  });

  it('returns no cues for an empty passage without calling the model', async () => {
    const fetchImpl = vi.fn();
    const { noticeCues, status } = await annotatePassage({ OPENAI_API_KEY: 'sk-real-key' }, { sentences: [], level: 'B1' }, fetchImpl as unknown as typeof fetch);
    expect(noticeCues).toEqual([]);
    expect(status).toBe('complete');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ── F-6 本命: 20-sentence chunked annotation + partial recovery ────────────────
describe('planAnnotationChunks — coverage distribution + absolute-index preservation (F-6)', () => {
  const many = (n: number): { tokens: string[]; translationJa: string }[] =>
    Array.from({ length: n }, (_v, i) => ({ tokens: [`w${i}`, '.'], translationJa: '' }));

  it('keeps a short passage as a single whole-passage request (no chunk framing)', () => {
    const req = { level: 'B1' as const, sentences: many(20) };
    const chunks = planAnnotationChunks(req, 20);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(req); // same reference — behaves exactly as the un-chunked path
    expect(chunks[0]!.sentenceIndexBase).toBeUndefined();
  });

  it('splits a long passage into ≤20-sentence slices and routes each span to its slice, absolute indices intact', () => {
    const req = {
      level: 'B2' as const,
      sentences: many(25),
      targetSpans: [
        { sentenceIndex: 3, tokenStart: 0, tokenEnd: 1, wordId: 'a', surface: 'w3', masteryDensity: 'new' as const },
        { sentenceIndex: 22, tokenStart: 0, tokenEnd: 1, wordId: 'b', surface: 'w22', masteryDensity: 'review' as const },
      ],
      collocationSpans: [{ sentenceIndex: 5, tokenStart: 0, tokenEnd: 1, headWordId: 'a', collocationId: 'c5' }],
      expressionSpans: [
        { span: { sentenceIndex: 21, tokenStart: 0, tokenEnd: 1 }, surface: 'w21', category: 'idiom' as const, meaningJa: '' },
      ],
    };
    const chunks = planAnnotationChunks(req, 20);
    expect(chunks).toHaveLength(2);
    const [a, b] = chunks;

    expect(a!.sentenceIndexBase).toBe(0);
    expect(a!.sentences).toHaveLength(20);
    expect(b!.sentenceIndexBase).toBe(20);
    expect(b!.sentences).toHaveLength(5);

    // Coverage items land only in the slice that contains them, with ABSOLUTE sentenceIndex preserved.
    expect(a!.targetSpans!.map((s) => s.sentenceIndex)).toEqual([3]);
    expect(a!.collocationSpans!.map((s) => s.sentenceIndex)).toEqual([5]);
    expect(a!.expressionSpans).toEqual([]);
    expect(b!.targetSpans!.map((s) => s.sentenceIndex)).toEqual([22]); // NOT renumbered to 2
    expect(b!.expressionSpans!.map((s) => s.span.sentenceIndex)).toEqual([21]);
    expect(b!.collocationSpans).toEqual([]);
  });
});

describe('salvageCues — partial recovery from a truncated reply (F-6)', () => {
  it('recovers the complete cue objects and discards the final truncated one', () => {
    const truncated = '{"noticeCues":[{"a":1},{"b":2},{"c":';
    expect(salvageCues(truncated)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('returns every cue when the array closed cleanly', () => {
    expect(salvageCues('{"noticeCues":[{"a":1},{"b":2}]}')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('ignores braces that live inside string values', () => {
    const text = '{"noticeCues":[{"anchorText":"a {b} c","x":1},{"anchorText":"y {';
    expect(salvageCues(text)).toEqual([{ anchorText: 'a {b} c', x: 1 }]);
  });

  it('returns [] for an empty array or when the noticeCues key is absent', () => {
    expect(salvageCues('{"noticeCues":[]}')).toEqual([]);
    expect(salvageCues('not json at all')).toEqual([]);
  });
});

describe('annotatePassage — chunked merge + partial status (F-6)', () => {
  // 25 sentences → two slices ([0,20), [20,25)); "alpha" lives in slice 1, "omega" in slice 2.
  const sentences = Array.from({ length: 25 }, (_v, i) => {
    if (i === 3) return { tokens: ['the', 'alpha', 'stage', '.'], translationJa: '' };
    if (i === 22) return { tokens: ['an', 'omega', 'point', '.'], translationJa: '' };
    return { tokens: [`w${i}`, '.'], translationJa: '' };
  });
  const rawContent = (init: RequestInit | undefined): string =>
    JSON.parse(String(init!.body)).messages[1].content as string;

  it('annotates each slice in parallel and merges cues with absolute indices, renumbered in reading order', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const user = rawContent(init);
      const cue = user.includes('omega')
        ? { span: { sentenceIndex: 22, tokenStart: 0, tokenEnd: 0 }, category: 'usage', anchorText: 'omega', explanationJa: 'B' }
        : { span: { sentenceIndex: 3, tokenStart: 0, tokenEnd: 0 }, category: 'usage', anchorText: 'alpha', explanationJa: 'A' };
      return openAiCompletion({ noticeCues: [cue] });
    });
    const { noticeCues, status } = await annotatePassage(
      { OPENAI_API_KEY: 'sk-real-key' },
      { sentences, level: 'B2' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(status).toBe('complete');
    expect(noticeCues.map((c) => [c.anchorText, c.index, c.span.sentenceIndex])).toEqual([
      ['alpha', 1, 3],
      ['omega', 2, 22],
    ]);
  });

  it('reports partial and keeps the surviving slice when another slice truncates (salvaging what streamed)', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const user = rawContent(init);
      if (user.includes('omega')) {
        // Truncated reply: one complete cue (omega) then a cut-off object.
        const body = '{"noticeCues":[{"span":{"sentenceIndex":22,"tokenStart":0,"tokenEnd":0},"category":"usage","anchorText":"omega","explanationJa":"B"},{"span":{"sen';
        return jsonResponse(200, { choices: [{ message: { content: body }, finish_reason: 'length' }] });
      }
      return openAiCompletion({
        noticeCues: [{ span: { sentenceIndex: 3, tokenStart: 0, tokenEnd: 0 }, category: 'usage', anchorText: 'alpha', explanationJa: 'A' }],
      });
    });
    const { noticeCues, status } = await annotatePassage(
      { OPENAI_API_KEY: 'sk-real-key' },
      { sentences, level: 'B2' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(status).toBe('partial');
    // Both the complete slice's cue and the salvaged cue survive.
    expect(noticeCues.map((c) => c.anchorText)).toEqual(['alpha', 'omega']);
  });

  it('reports failed only when every slice yields no cues', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { choices: [{ message: { content: '{"noticeCues":[' }, finish_reason: 'length' }] }),
    );
    const { noticeCues, status } = await annotatePassage(
      { OPENAI_API_KEY: 'sk-real-key' },
      { sentences, level: 'B2' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(noticeCues).toEqual([]);
    expect(status).toBe('failed');
  });
});

// ── C-4 / C-1 annotation side: syntax notes, discontinuous spans, detailJa, long anchors ──────
describe('annotatePassage — C-4 syntax notes + discontinuous spans + C-1 detailJa', () => {
  const inversion = [
    { tokens: ['No', 'sooner', 'had', 'the', 'meeting', 'started', 'than', 'the', 'alarm', 'rang', '.'], translationJa: '' },
  ];

  it('keeps a sentence_structure cue whose anchorText spans MORE than 6 tokens (findRun cap removed)', async () => {
    const long = [
      { tokens: ['She', 'said', 'that', 'the', 'project', 'would', 'soon', 'be', 'finished', '.'], translationJa: '' },
    ];
    const reply = {
      noticeCues: [
        {
          span: { sentenceIndex: 0, tokenStart: 0, tokenEnd: 0 },
          category: 'sentence_structure',
          anchorText: 'that the project would soon be finished',
          explanationJa: '節が長い。',
        },
      ],
    };
    const fetchImpl = vi.fn(async () => openAiCompletion(reply));
    const { noticeCues } = await annotatePassage({ OPENAI_API_KEY: 'sk-real-key' }, { sentences: long, level: 'B2' }, fetchImpl as unknown as typeof fetch);
    expect(noticeCues).toHaveLength(1);
    expect([noticeCues[0]!.span.tokenStart, noticeCues[0]!.span.tokenEnd]).toEqual([2, 9]);
  });

  it('resolves a whole-sentence anchorText to the full [0, tokens.length) span', async () => {
    const one = [{ tokens: ['Although', 'bold', ',', 'it', 'failed', '.'], translationJa: '' }];
    const reply = {
      noticeCues: [
        { span: { sentenceIndex: 0, tokenStart: 0, tokenEnd: 0 }, category: 'sentence_structure', anchorText: 'Although bold, it failed.', explanationJa: '譲歩。' },
      ],
    };
    const fetchImpl = vi.fn(async () => openAiCompletion(reply));
    const { noticeCues } = await annotatePassage({ OPENAI_API_KEY: 'sk-real-key' }, { sentences: one, level: 'B2' }, fetchImpl as unknown as typeof fetch);
    expect(noticeCues).toHaveLength(1);
    expect([noticeCues[0]!.span.tokenStart, noticeCues[0]!.span.tokenEnd]).toEqual([0, 6]);
  });

  it('resolves anchorTextParts into extraSpans for a discontinuous expression, and passes detailJa through', async () => {
    const reply = {
      noticeCues: [
        {
          span: { sentenceIndex: 0, tokenStart: 0, tokenEnd: 0 },
          category: 'grammar_pattern',
          anchorText: 'No sooner',
          explanationJa: '〜するやいなや。',
          detailJa: '否定副詞句 No sooner が文頭に出て倒置が起きる。than 以下が後続の出来事。',
          anchorTextParts: ['No sooner', 'than'],
        },
      ],
    };
    const fetchImpl = vi.fn(async () => openAiCompletion(reply));
    const { noticeCues } = await annotatePassage({ OPENAI_API_KEY: 'sk-real-key' }, { sentences: inversion, level: 'C1' }, fetchImpl as unknown as typeof fetch);
    expect(noticeCues).toHaveLength(1);
    const cue = noticeCues[0]!;
    expect([cue.span.tokenStart, cue.span.tokenEnd]).toEqual([0, 2]); // "No sooner"
    expect(cue.extraSpans).toEqual([{ sentenceIndex: 0, tokenStart: 6, tokenEnd: 7 }]); // "than"
    expect(cue.detailJa).toContain('倒置');
  });

  it('keeps the cue but omits extraSpans when a discontinuous part cannot be located', async () => {
    const reply = {
      noticeCues: [
        {
          span: { sentenceIndex: 0, tokenStart: 0, tokenEnd: 0 },
          category: 'grammar_pattern',
          anchorText: 'No sooner',
          explanationJa: '〜するやいなや。',
          anchorTextParts: ['No sooner', 'whenever'], // "whenever" is not in the sentence
        },
      ],
    };
    const fetchImpl = vi.fn(async () => openAiCompletion(reply));
    const { noticeCues } = await annotatePassage({ OPENAI_API_KEY: 'sk-real-key' }, { sentences: inversion, level: 'C1' }, fetchImpl as unknown as typeof fetch);
    expect(noticeCues).toHaveLength(1);
    expect(noticeCues[0]!.extraSpans).toBeUndefined();
  });

  it('returns grounded sentenceNotes, dropping out-of-range sentences and clamping chunk token ranges', async () => {
    const reply = {
      noticeCues: [],
      sentenceNotes: [
        {
          sentenceIndex: 0,
          patternNameJa: '倒置（否定副詞句＋助動詞前置）',
          structureJa: '主語 the alarm は than 節の中。',
          readingJa: 'No sooner had the meeting started → 会議が始まるやいなや',
          chunks: [
            { tokenStart: 0, tokenEnd: 6, roleJa: '主節（倒置）' },
            { tokenStart: 6, tokenEnd: 999, roleJa: '従属節' }, // tokenEnd clamped to sentence length
          ],
        },
        { sentenceIndex: 9, patternNameJa: 'x', structureJa: '', readingJa: '', chunks: [] }, // out of range → dropped
      ],
    };
    const fetchImpl = vi.fn(async () => openAiCompletion(reply));
    const { sentenceNotes } = await annotatePassage({ OPENAI_API_KEY: 'sk-real-key' }, { sentences: inversion, level: 'C1', readabilityLevel: 'advanced' }, fetchImpl as unknown as typeof fetch);
    expect(sentenceNotes).toHaveLength(1);
    expect(sentenceNotes![0]!.sentenceIndex).toBe(0);
    expect(sentenceNotes![0]!.chunks).toEqual([
      { tokenStart: 0, tokenEnd: 6, roleJa: '主節（倒置）' },
      { tokenStart: 6, tokenEnd: 11, roleJa: '従属節' },
    ]);
  });

  it('threads readability + writer-flagged hard sentences into the annotation user message', async () => {
    let userMsg = '';
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      userMsg = JSON.parse(String(init!.body)).messages[1].content as string;
      return openAiCompletion({ noticeCues: [], sentenceNotes: [] });
    });
    await annotatePassage(
      { OPENAI_API_KEY: 'sk-real-key' },
      { sentences: inversion, level: 'C1', readabilityLevel: 'advanced', hardSentenceIndexes: [0] },
      fetchImpl as unknown as typeof fetch,
    );
    expect(userMsg).toContain('Passage readability: advanced.');
    expect(userMsg).toContain('HARD SENTENCES');
    expect(userMsg).toContain('s0');
  });
});

// ── B-5: sampling / token budget / task-specific model + health probe ─────────
describe('generation params (B-5)', () => {
  it('sends max_completion_tokens (not max_tokens) and a passage temperature to OpenAI', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      captured = init;
      return openAiCompletion(samplePassage);
    });
    await generatePassage({ OPENAI_API_KEY: 'sk-real-key' }, req, fetchImpl as unknown as typeof fetch);
    const sent = JSON.parse(String(captured!.body));
    expect(sent.max_completion_tokens).toBeGreaterThan(0);
    expect(sent.max_tokens).toBeUndefined();
    expect(sent.temperature).toBe(0.8);
  });

  it('sends max_tokens + temperature (not max_completion_tokens) to Anthropic', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      captured = init;
      return jsonResponse(200, { content: [{ type: 'text', text: JSON.stringify(samplePassage) }], stop_reason: 'end_turn' });
    });
    await generatePassage(
      { LLM_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'sk-ant-key' },
      req,
      fetchImpl as unknown as typeof fetch,
    );
    const sent = JSON.parse(String(captured!.body));
    expect(sent.max_tokens).toBeGreaterThan(0);
    expect(sent.max_completion_tokens).toBeUndefined();
    expect(sent.temperature).toBe(0.8);
  });

  it('omits temperature for reasoning-series OpenAI models (gpt-5 / o-series)', async () => {
    for (const model of ['gpt-5', 'gpt-5-mini', 'o1', 'o3-mini']) {
      let captured: RequestInit | undefined;
      const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        captured = init;
        return openAiCompletion(samplePassage);
      });
      await generatePassage(
        { OPENAI_API_KEY: 'sk-real-key', OPENAI_MODEL: model },
        req,
        fetchImpl as unknown as typeof fetch,
      );
      const sent = JSON.parse(String(captured!.body));
      expect(sent.model).toBe(model);
      expect(sent.temperature).toBeUndefined();
    }
  });

  it('uses the passage annotation/wordpack model overrides when set', async () => {
    const capture = () => {
      let captured: RequestInit | undefined;
      const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        captured = init;
        return openAiCompletion(samplePassage);
      });
      return { fetchImpl, model: () => JSON.parse(String(captured!.body)).model };
    };

    const passageCap = capture();
    await generatePassage(
      { OPENAI_API_KEY: 'sk-real-key', OPENAI_MODEL: 'base', LLM_MODEL_PASSAGE: 'passage-model' },
      req,
      passageCap.fetchImpl as unknown as typeof fetch,
    );
    expect(passageCap.model()).toBe('passage-model');

    // A task without an override env falls back to OPENAI_MODEL.
    const fallbackCap = capture();
    await generatePassage(
      { OPENAI_API_KEY: 'sk-real-key', OPENAI_MODEL: 'base' },
      req,
      fallbackCap.fetchImpl as unknown as typeof fetch,
    );
    expect(fallbackCap.model()).toBe('base');
  });

  it('sends a low temperature for the annotation pass', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      captured = init;
      return openAiCompletion({ noticeCues: [] });
    });
    await annotatePassage(
      { OPENAI_API_KEY: 'sk-real-key' },
      { sentences: [{ tokens: ['A', 'team', 'met', '.'], translationJa: '' }], level: 'B1' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(JSON.parse(String(captured!.body)).temperature).toBe(0.3);
  });

  it('throws a not_configured ProviderError when the key is missing', async () => {
    await expect(generatePassage({}, req, vi.fn() as unknown as typeof fetch)).rejects.toMatchObject({
      status: 503,
      code: 'not_configured',
    });
  });

  it('tags an upstream 429 as rate_limited and a 401 as upstream_auth', async () => {
    await expect(
      generatePassage({ OPENAI_API_KEY: 'sk-real-key' }, req, (async () => jsonResponse(429, {})) as unknown as typeof fetch),
    ).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
    await expect(
      generatePassage({ OPENAI_API_KEY: 'sk-real-key' }, req, (async () => jsonResponse(401, {})) as unknown as typeof fetch),
    ).rejects.toMatchObject({ status: 503, code: 'upstream_auth' });
  });
});

describe('healthStatus', () => {
  it('reports configured=true for a real key and the active provider', () => {
    expect(healthStatus({ OPENAI_API_KEY: 'sk-real-key' })).toEqual({ configured: true, provider: 'openai' });
    expect(healthStatus({ LLM_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'sk-ant-key' })).toEqual({
      configured: true,
      provider: 'anthropic',
    });
  });

  it('reports configured=false for a missing or placeholder key without leaking it', () => {
    expect(healthStatus({})).toEqual({ configured: false, provider: 'openai' });
    expect(healthStatus({ OPENAI_API_KEY: 'sk-...' })).toEqual({ configured: false, provider: 'openai' });
  });
});
