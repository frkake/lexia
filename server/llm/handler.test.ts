import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApiHandler } from './handler';
import type { Env } from './providers';

// The image proxy is exercised end-to-end via providers; here we stub fetch through the env-driven
// providers by pointing IMAGE at a fake key and mocking globalThis.fetch.
function makeReq(method: string, url: string, body?: unknown): IncomingMessage {
  const readable = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  const req = readable as unknown as IncomingMessage;
  req.method = method;
  req.url = url;
  return req;
}

interface CapturedRes {
  res: ServerResponse;
  status: () => number;
  json: () => unknown;
}

function makeRes(): CapturedRes {
  let statusCode = 200;
  let payload = '';
  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(v: number) {
      statusCode = v;
    },
    headersSent: false,
    setHeader: () => {},
    end: (chunk?: string) => {
      if (typeof chunk === 'string') payload = chunk;
    },
  } as unknown as ServerResponse;
  return { res, status: () => statusCode, json: () => (payload ? JSON.parse(payload) : undefined) };
}

function run(env: Env, req: IncomingMessage, res: ServerResponse): Promise<void> {
  return new Promise((resolve) => {
    const handler = createApiHandler(() => env);
    const originalEnd = res.end.bind(res);
    (res as unknown as { end: (c?: string) => void }).end = (chunk?: string) => {
      originalEnd(chunk);
      resolve();
    };
    handler(req, res, () => resolve());
  });
}

describe('GET /api/health (F-1)', () => {
  it('reports configured=false and the provider when no key is set (never the key value)', async () => {
    const { res, status, json } = makeRes();
    await run({}, makeReq('GET', '/api/health'), res);
    expect(status()).toBe(200);
    expect(json()).toEqual({ configured: false, provider: 'openai' });
  });

  it('reports configured=true for the active provider', async () => {
    const { res, status, json } = makeRes();
    await run({ OPENAI_API_KEY: 'sk-real-key' }, makeReq('GET', '/api/health'), res);
    expect(status()).toBe(200);
    expect(json()).toEqual({ configured: true, provider: 'openai' });
  });

  it('rejects a non-GET method with 405', async () => {
    const { res, status } = makeRes();
    await run({ OPENAI_API_KEY: 'sk-real-key' }, makeReq('POST', '/api/health', {}), res);
    expect(status()).toBe(405);
  });
});

describe('error responses carry a machine-readable code (F-1)', () => {
  it('returns { error, code: not_configured } with a 503 when the key is unset', async () => {
    const { res, status, json } = makeRes();
    await run(
      {},
      makeReq('POST', '/api/passages:generate', {
        level: 'B1',
        intent: 'business',
        newWordRatio: 0.3,
        wordTarget: 200,
        contentType: 'article',
        targetWords: [],
      }),
      res,
    );
    expect(status()).toBe(503);
    const body = json() as { error: string; code: string };
    expect(body.code).toBe('not_configured');
    expect(typeof body.error).toBe('string');
  });
});

describe('POST /api/story:illustrate (Requirement 6.8)', () => {
  it('returns { illustrationUrl } for a valid CharacterIllustrationRequest', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ b64_json: 'QUJD' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchImpl);
    const { res, status, json } = makeRes();
    await run(
      { OPENAI_API_KEY: 'sk-real-key' },
      makeReq('POST', '/api/story:illustrate', {
        name: 'Aria',
        role: 'hero',
        descriptionJa: '勇敢な少女',
        genre: 'fantasy',
      }),
      res,
    );
    expect(status()).toBe(200);
    expect(json()).toEqual({ illustrationUrl: 'data:image/png;base64,QUJD' });
    vi.unstubAllGlobals();
  });

  it('rejects a malformed body with 400', async () => {
    const { res, status } = makeRes();
    await run({ OPENAI_API_KEY: 'sk-real-key' }, makeReq('POST', '/api/story:illustrate', { role: 'hero' }), res);
    expect(status()).toBe(400);
  });

  it('rejects a non-POST method with 405', async () => {
    const { res, status } = makeRes();
    await run({ OPENAI_API_KEY: 'sk-real-key' }, makeReq('GET', '/api/story:illustrate'), res);
    expect(status()).toBe(405);
  });
});

describe('POST /api/passages:illustrate', () => {
  it('returns { illustrationUrl } for a valid PassageIllustrationRequest', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ b64_json: 'U0NFTkU=' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchImpl);
    const { res, status, json } = makeRes();
    await run(
      { OPENAI_API_KEY: 'sk-real-key' },
      makeReq('POST', '/api/passages:illustrate', {
        title: 'Scene',
        intent: 'daily',
        level: 'B1',
        sentences: [{ tokens: ['A', 'map', 'glowed', '.'], translationJa: '' }],
      }),
      res,
    );
    expect(status()).toBe(200);
    expect(json()).toEqual({ illustrationUrl: 'data:image/png;base64,U0NFTkU=' });
    vi.unstubAllGlobals();
  });

  it('rejects a malformed body with 400', async () => {
    const { res, status } = makeRes();
    await run({ OPENAI_API_KEY: 'sk-real-key' }, makeReq('POST', '/api/passages:illustrate', { title: 'Scene' }), res);
    expect(status()).toBe(400);
  });

  it('rejects a non-POST method with 405', async () => {
    const { res, status } = makeRes();
    await run({ OPENAI_API_KEY: 'sk-real-key' }, makeReq('GET', '/api/passages:illustrate'), res);
    expect(status()).toBe(405);
  });
});

describe('POST /api/story:extend', () => {
  const plan = {
    storyId: 'story_1',
    contentType: 'long_story',
    genre: 'fantasy',
    titleJa: '星の物語',
    synopsisJa: '星を探す旅。',
    characters: [{ name: 'Mia', role: '主人公', descriptionJa: '好奇心旺盛な少女' }],
    chapters: [{ index: 0, headingJa: '第一章', beatJa: '旅立ち' }],
  };

  it('returns an extended storyPlan for a valid request', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  synopsisJa: '星を探す旅は続く。',
                  chapters: [{ index: 1, headingJa: '第二章', beatJa: '門を開く' }],
                }),
              },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchImpl);
    const { res, status, json } = makeRes();
    await run(
      { OPENAI_API_KEY: 'sk-real-key' },
      makeReq('POST', '/api/story:extend', { plan, nextChapterIndex: 1, priorSummaryJa: 'ミアは旅立った。' }),
      res,
    );
    expect(status()).toBe(200);
    expect((json() as { storyPlan: typeof plan }).storyPlan.chapters.map((c) => c.index)).toEqual([0, 1]);
    vi.unstubAllGlobals();
  });

  it('rejects a malformed body with 400', async () => {
    const { res, status } = makeRes();
    await run({ OPENAI_API_KEY: 'sk-real-key' }, makeReq('POST', '/api/story:extend', { nextChapterIndex: 1 }), res);
    expect(status()).toBe(400);
  });
});
