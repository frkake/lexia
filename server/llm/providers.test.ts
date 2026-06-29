import { describe, it, expect, vi } from 'vitest';
import { ProviderError, generatePassage, getWordData, type Env } from './providers';
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
});
