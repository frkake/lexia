import { describe, it, expect, vi } from 'vitest';
import { ProviderError, generatePassage, getWordData, suggestWords, type Env } from './providers';
import type { GenerationRequest } from '../../src/types/domain';

const req: GenerationRequest = {
  level: 'B1',
  themes: ['会議'],
  newWordRatio: 0.3,
  length: 'short',
  targetWords: [],
};

const samplePassage = {
  meta: { title: 't', theme: '会議', level: 'B1', newCount: 0, reviewCount: 0, approxWords: 11 },
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

  it('re-anchors mis-indexed spans and cleans notice cues against the supplied attributes', async () => {
    const reqWithTargets: GenerationRequest = {
      level: 'B1',
      themes: ['会議'],
      newWordRatio: 0.3,
      length: 'short',
      targetWords: [
        {
          wordId: 'agenda',
          surface: 'agenda',
          masteryDensity: 'new',
          attributes: { connotation: 'neutral', more: { commonErrors: ['agenda vs schedule'] } },
        },
      ],
    };
    const passage = {
      meta: { title: 't', theme: '会議', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 9 },
      sentences: [{ tokens: ['We', 'set', 'an', 'agenda', 'for', 'the', 'team', 'meeting', '.'], translationJa: '' }],
      // Wrong indices: "agenda" declared at [0,1) ("We"); collocation declared at [5,9).
      targetSpans: [{ sentenceIndex: 0, tokenStart: 0, tokenEnd: 1, wordId: 'agenda', surface: 'agenda', masteryDensity: 'new' }],
      collocationSpans: [{ sentenceIndex: 0, tokenStart: 5, tokenEnd: 9, headWordId: 'agenda', collocationId: 'set an agenda' }],
      noticeCues: [
        // Grounded (more.commonErrors) but the model MIS-INDEXED the span ([0,1)="We") and used a
        // non-canonical sourceAttribute. anchorText "an agenda" (tokens [2,4)) is the source of truth.
        { index: 0, span: { sentenceIndex: 0, tokenStart: 0, tokenEnd: 1 }, category: 'common_error', wordId: 'agenda', sourceAttribute: 'commonErrors', anchorText: 'an agenda', explanationJa: '' },
        // Ungrounded: no register attribute supplied → must be dropped.
        { index: 1, span: { sentenceIndex: 0, tokenStart: 0, tokenEnd: 1 }, category: 'register', wordId: 'agenda', sourceAttribute: 'attributes.register', anchorText: 'agenda', explanationJa: '' },
      ],
    };
    const fetchImpl = vi.fn(async () => openAiCompletion(passage));
    const env: Env = { OPENAI_API_KEY: 'sk-real-key' };
    const res = await generatePassage(env, reqWithTargets, fetchImpl as unknown as typeof fetch);

    expect(res.passage.targetSpans[0]).toMatchObject({ tokenStart: 3, tokenEnd: 4 }); // "agenda"
    expect(res.passage.collocationSpans[0]).toMatchObject({ tokenStart: 1, tokenEnd: 4 }); // "set an agenda"
    expect(res.passage.noticeCues.some((c) => c.category === 'register')).toBe(false); // ungrounded → dropped
    const c0 = res.passage.noticeCues.find((c) => c.category === 'common_error')!;
    expect(c0.sourceAttribute).toBe('more.commonErrors'); // canonicalized
    // Span RE-DERIVED from anchorText "an agenda" ([2,4)) — NOT the model's [0,1), and NOT the
    // target word "agenda" alone ([3,4)). This is the badge ↔ explanation correspondence fix.
    expect(c0.span).toMatchObject({ sentenceIndex: 0, tokenStart: 2, tokenEnd: 4 });
  });

  it('re-anchors a repeated expression to the occurrence nearest the model\'s declared index', async () => {
    const reqT: GenerationRequest = {
      level: 'B1',
      themes: ['x'],
      newWordRatio: 0.3,
      length: 'short',
      targetWords: [{ wordId: 'plant', surface: 'plant', masteryDensity: 'new', attributes: { connotation: 'neutral' } }],
    };
    const passage = {
      meta: { title: 't', theme: 'x', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 6 },
      sentences: [{ tokens: ['The', 'plant', 'will', 'plant', 'seeds', '.'], translationJa: '' }],
      targetSpans: [{ sentenceIndex: 0, tokenStart: 3, tokenEnd: 4, wordId: 'plant', surface: 'plant', masteryDensity: 'new' }],
      collocationSpans: [],
      noticeCues: [
        // "plant" appears twice; the cue is about the SECOND one (declared tokenStart:3).
        { index: 1, span: { sentenceIndex: 0, tokenStart: 3, tokenEnd: 4 }, category: 'connotation', wordId: 'plant', sourceAttribute: 'connotation', anchorText: 'plant', explanationJa: '' },
      ],
    };
    const fetchImpl = vi.fn(async () => openAiCompletion(passage));
    const res = await generatePassage({ OPENAI_API_KEY: 'sk-real-key' }, reqT, fetchImpl as unknown as typeof fetch);
    // Must land on the second "plant" ([3,4)), not drift to the first ([1,2)).
    expect(res.passage.noticeCues[0]!.span).toMatchObject({ sentenceIndex: 0, tokenStart: 3, tokenEnd: 4 });
  });

  it('renumbers surviving notice cues to contiguous unique indices (1..N)', async () => {
    const reqT: GenerationRequest = {
      level: 'B1',
      themes: ['x'],
      newWordRatio: 0.3,
      length: 'short',
      targetWords: [{ wordId: 'plant', surface: 'plant', masteryDensity: 'new', attributes: { connotation: 'neutral', register: 'neutral' } }],
    };
    const passage = {
      meta: { title: 't', theme: 'x', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 4 },
      sentences: [{ tokens: ['A', 'green', 'plant', 'grows', '.'], translationJa: '' }],
      targetSpans: [{ sentenceIndex: 0, tokenStart: 2, tokenEnd: 3, wordId: 'plant', surface: 'plant', masteryDensity: 'new' }],
      collocationSpans: [],
      noticeCues: [
        // Both grounded, but the model emitted DUPLICATE indices (0, 0).
        { index: 0, span: { sentenceIndex: 0, tokenStart: 2, tokenEnd: 3 }, category: 'connotation', wordId: 'plant', sourceAttribute: 'connotation', anchorText: 'plant', explanationJa: '' },
        { index: 0, span: { sentenceIndex: 0, tokenStart: 2, tokenEnd: 3 }, category: 'register', wordId: 'plant', sourceAttribute: 'register', anchorText: 'plant', explanationJa: '' },
      ],
    };
    const fetchImpl = vi.fn(async () => openAiCompletion(passage));
    const res = await generatePassage({ OPENAI_API_KEY: 'sk-real-key' }, reqT, fetchImpl as unknown as typeof fetch);
    expect(res.passage.noticeCues.map((c) => c.index)).toEqual([1, 2]);
  });

  it('unwraps a {meta, passage:{sentences}} shape and backfills missing meta from the request', async () => {
    const wrapped = {
      meta: { newCount: 0, reviewCount: 0, approxWords: 11 }, // no title/theme/level
      passage: { sentences: samplePassage.sentences },
    };
    const fetchImpl = vi.fn(async () => openAiCompletion(wrapped));
    const env: Env = { OPENAI_API_KEY: 'sk-real-key' };
    const res = await generatePassage(env, req, fetchImpl as unknown as typeof fetch);
    expect(res.passage.sentences[0]!.tokens).toContain('team');
    expect(res.passage.meta.theme).toBe('会議'); // backfilled from request
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
      { level: 'B1', themes: ['会議'], count: 3, exclude: ['Stakeholder'] },
      fetchImpl as unknown as typeof fetch,
    );
    expect(words).toEqual(['agenda', 'consensus', 'defer']);
  });

  it('tolerates a non-array reply and returns an empty list', async () => {
    const fetchImpl = vi.fn(async () => openAiCompletion({ words: null }));
    const env: Env = { OPENAI_API_KEY: 'sk-real-key' };
    const words = await suggestWords(env, { level: 'B1', themes: ['x'], count: 5 }, fetchImpl as unknown as typeof fetch);
    expect(words).toEqual([]);
  });
});
