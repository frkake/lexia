import { describe, it, expect, vi } from 'vitest';
import { ProviderError, generatePassage, getWordData, suggestWords, annotatePassage, planStory, type Env } from './providers';
import type { GenerationRequest } from '../../src/types/domain';

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
      core: { meaningsJa: ['回復力のある'], examples: [], collocations: ['remain resilient'], synonymNuances: [] },
      more: {
        etymology: { prefix: null, root: 'salire', suffix: null },
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
    expect(res.more).toEqual({ etymology: { root: 'salire' }, wordFamily: ['resilience'] });
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
