import { describe, it, expect } from 'vitest';
import { HttpContentGateway } from './contentGatewayHttp';
import type { GenerationRequest, PassageOutput, WordData } from '../../types/domain';

const req: GenerationRequest = {
  level: 'B1',
  intent: 'travel',
  newWordRatio: 0.3,
  wordTarget: 200,
  contentType: 'article',
  targetWords: [{ wordId: 'w1', surface: 'resilient', masteryDensity: 'new' }],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function gatewayWith(fetchImpl: typeof fetch): HttpContentGateway {
  return new HttpContentGateway({ baseUrl: 'https://api.test', fetch: fetchImpl });
}

const samplePassage: PassageOutput = {
  meta: { title: 't', intent: 'travel', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 5 },
  sentences: [{ tokens: ['She', 'stayed', 'resilient', '.'], translationJa: '' }],
  targetSpans: [],
  collocationSpans: [],
  noticeCues: [],
};

describe('HttpContentGateway.generatePassage', () => {
  it('posts to /api/passages:generate and maps stop_reason to stopReason', async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    const gw = gatewayWith(async (url, init) => {
      captured = { url: String(url), init };
      return jsonResponse(200, { passage: samplePassage, stop_reason: 'end_turn' });
    });
    const res = await gw.generatePassage(req);
    expect(captured!.url).toBe('https://api.test/api/passages:generate');
    expect(captured!.init?.method).toBe('POST');
    expect(res.stopReason).toBe('end_turn');
    expect(res.passage.sentences[0]!.tokens).toContain('resilient');
  });

  it('normalizes 422 to a validation error', async () => {
    const gw = gatewayWith(async () => jsonResponse(422, { error: 'invalid' }));
    await expect(gw.generatePassage(req)).rejects.toMatchObject({ kind: 'validation', status: 422 });
  });

  it('normalizes 429 to a rate_limited error', async () => {
    const gw = gatewayWith(async () => jsonResponse(429, {}));
    await expect(gw.generatePassage(req)).rejects.toMatchObject({ kind: 'rate_limited' });
  });

  it('normalizes 503 to an unavailable error', async () => {
    const gw = gatewayWith(async () => jsonResponse(503, {}));
    await expect(gw.generatePassage(req)).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('normalizes a thrown fetch into a network error', async () => {
    const gw = gatewayWith(async () => {
      throw new Error('offline');
    });
    await expect(gw.generatePassage(req)).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('HttpContentGateway AbortSignal threading (D-7)', () => {
  it('always passes an AbortSignal to fetch, distinct from the caller signal (composed with a timeout)', async () => {
    const caller = new AbortController();
    let seen: AbortSignal | null | undefined;
    const gw = gatewayWith(async (_url, init) => {
      seen = init?.signal;
      return jsonResponse(200, { passage: samplePassage, stop_reason: 'end_turn' });
    });
    await gw.generatePassage(req, caller.signal);
    expect(seen).toBeInstanceOf(AbortSignal);
    // The signal handed to fetch is the composed one (caller ⊕ timeout), never the raw caller signal.
    expect(seen).not.toBe(caller.signal);
  });

  it('composes a request that aborts when the caller cancels, surfacing an aborted error', async () => {
    const caller = new AbortController();
    const gw = gatewayWith(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const s = init?.signal;
          if (s?.aborted) return reject(s.reason);
          s?.addEventListener('abort', () => reject(s.reason));
        }),
    );
    const pending = gw.generatePassage(req, caller.signal);
    caller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('maps a TimeoutError rejection to the timeout kind', async () => {
    const gw = gatewayWith(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    await expect(gw.generatePassage(req)).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('threads the caller signal through the annotation pass too', async () => {
    const caller = new AbortController();
    let seen: AbortSignal | null | undefined;
    const gw = gatewayWith(async (_url, init) => {
      seen = init?.signal;
      return jsonResponse(200, { noticeCues: [] });
    });
    await gw.annotatePassage({ sentences: samplePassage.sentences, level: 'B1' }, caller.signal);
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen).not.toBe(caller.signal);
  });
});

describe('HttpContentGateway error-body interpretation (F-1)', () => {
  it('maps a not_configured code to the not_configured kind, surfacing the server message', async () => {
    const gw = gatewayWith(async () =>
      jsonResponse(503, { error: 'Generation API not configured: OPENAI_API_KEY is missing. Set it in .env.', code: 'not_configured' }),
    );
    await expect(gw.generatePassage(req)).rejects.toMatchObject({
      kind: 'not_configured',
      status: 503,
      message: expect.stringContaining('OPENAI_API_KEY'),
    });
  });

  it('falls back to the status kind when the body has no code, keeping the error detail', async () => {
    const gw = gatewayWith(async () => jsonResponse(503, { error: 'upstream boom' }));
    await expect(gw.generatePassage(req)).rejects.toMatchObject({ kind: 'unavailable', message: 'upstream boom' });
  });

  it('falls back to the status kind and a generic message for a non-JSON body', async () => {
    const gw = gatewayWith(async () => new Response('<html>503</html>', { status: 503 }));
    await expect(gw.generatePassage(req)).rejects.toMatchObject({ kind: 'unavailable', message: 'request failed (503)' });
  });

  it('maps a rate_limited code to the rate_limited kind', async () => {
    const gw = gatewayWith(async () => jsonResponse(429, { error: 'slow down', code: 'rate_limited' }));
    await expect(gw.generatePassage(req)).rejects.toMatchObject({ kind: 'rate_limited' });
  });
});

describe('HttpContentGateway.checkHealth (F-1)', () => {
  it('GETs /api/health and normalizes the payload', async () => {
    let url = '';
    const gw = gatewayWith(async (u) => {
      url = String(u);
      return jsonResponse(200, { configured: false, provider: 'anthropic' });
    });
    const health = await gw.checkHealth();
    expect(url).toBe('https://api.test/api/health');
    expect(health).toEqual({ configured: false, provider: 'anthropic' });
  });
});

describe('HttpContentGateway.getWordData', () => {
  it('gets /api/words/{wordId} and returns WordData', async () => {
    const word: WordData = {
      wordId: 'w1',
      headword: 'resilient',
      ipa: '/rɪˈzɪljənt/',
      pos: ['adj'],
      register: 'neutral',
      connotation: 'positive',
      frequency: 3,
      core: { meaningsJa: ['回復力のある'], examples: [], collocations: [], synonymNuances: [] },
    };
    let url = '';
    const gw = gatewayWith(async (u) => {
      url = String(u);
      return jsonResponse(200, word);
    });
    const got = await gw.getWordData('w1');
    expect(url).toBe('https://api.test/api/words/w1');
    expect(got.headword).toBe('resilient');
  });

  it('normalizes 404 to a not_found error', async () => {
    const gw = gatewayWith(async () => jsonResponse(404, {}));
    await expect(gw.getWordData('missing')).rejects.toMatchObject({ kind: 'not_found', status: 404 });
  });
});

describe('HttpContentGateway.suggestWords', () => {
  it('posts to /api/words:suggest and returns the proposed lemmas', async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    const gw = gatewayWith(async (url, init) => {
      captured = { url: String(url), init };
      return jsonResponse(200, { words: ['agenda', 'consensus'] });
    });
    const words = await gw.suggestWords({ level: 'B1', intent: 'business', count: 2 });
    expect(captured!.url).toBe('https://api.test/api/words:suggest');
    expect(captured!.init?.method).toBe('POST');
    expect(words).toEqual(['agenda', 'consensus']);
  });

  it('returns an empty list when the reply has no words array', async () => {
    const gw = gatewayWith(async () => jsonResponse(200, {}));
    expect(await gw.suggestWords({ level: 'B1', intent: 'business', count: 3 })).toEqual([]);
  });
});

describe('HttpContentGateway.annotatePassage', () => {
  it('posts the sentences + level + body-mark spans to /api/passages:annotate and returns the cues', async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    const cue = { index: 1, span: { sentenceIndex: 0, tokenStart: 0, tokenEnd: 1 }, category: 'idiom' as const, anchorText: 'She', explanationJa: '' };
    const gw = gatewayWith(async (url, init) => {
      captured = { url: String(url), init };
      return jsonResponse(200, { noticeCues: [cue] });
    });
    const collocationSpans = [{ sentenceIndex: 0, tokenStart: 1, tokenEnd: 3, headWordId: 'w1', collocationId: 'c1' }];
    const targetSpans = [{ sentenceIndex: 0, tokenStart: 2, tokenEnd: 3, wordId: 'w1', surface: 'resilient', masteryDensity: 'new' as const }];
    const result = await gw.annotatePassage({ sentences: samplePassage.sentences, level: 'B1', collocationSpans, targetSpans });
    expect(captured!.url).toBe('https://api.test/api/passages:annotate');
    expect(captured!.init?.method).toBe('POST');
    // The required-coverage spans must reach the proxy so the rail can cover every body mark.
    expect(JSON.parse(String(captured!.init?.body))).toMatchObject({ level: 'B1', collocationSpans, targetSpans });
    expect(result.noticeCues).toEqual([cue]);
  });

  it('surfaces the annotationStatus from the proxy so the reader can flag a failed pass (F-6)', async () => {
    const gw = gatewayWith(async () => jsonResponse(200, { noticeCues: [], annotationStatus: 'failed' }));
    const result = await gw.annotatePassage({ sentences: samplePassage.sentences, level: 'B1' });
    expect(result).toEqual({ noticeCues: [], status: 'failed', sentenceNotes: [] });
  });

  it('surfaces sentenceNotes from the proxy so the reader can render syntax panels (C-4)', async () => {
    const note = { sentenceIndex: 0, patternNameJa: '倒置', structureJa: '', readingJa: '', chunks: [] };
    const gw = gatewayWith(async () => jsonResponse(200, { noticeCues: [], annotationStatus: 'complete', sentenceNotes: [note] }));
    const result = await gw.annotatePassage({ sentences: samplePassage.sentences, level: 'C1' });
    expect(result.sentenceNotes).toEqual([note]);
  });

  it('defaults to a complete status with empty lists when the reply omits the fields', async () => {
    const gw = gatewayWith(async () => jsonResponse(200, {}));
    expect(await gw.annotatePassage({ sentences: samplePassage.sentences, level: 'B1' })).toEqual({
      noticeCues: [],
      status: 'complete',
      sentenceNotes: [],
    });
  });
});

describe('HttpContentGateway.illustratePassage', () => {
  it('posts passage context to /api/passages:illustrate and returns the data URL', async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    const gw = gatewayWith(async (url, init) => {
      captured = { url: String(url), init };
      return jsonResponse(200, { illustrationUrl: 'data:image/png;base64,SCENE' });
    });
    const result = await gw.illustratePassage({
      title: samplePassage.meta.title,
      intent: samplePassage.meta.intent,
      level: samplePassage.meta.level,
      sentences: samplePassage.sentences,
    });
    expect(captured!.url).toBe('https://api.test/api/passages:illustrate');
    expect(captured!.init?.method).toBe('POST');
    expect(JSON.parse(String(captured!.init?.body))).toMatchObject({ title: 't', intent: 'travel', level: 'B1' });
    expect(result).toBe('data:image/png;base64,SCENE');
  });

  it('rejects when the response omits illustrationUrl', async () => {
    const gw = gatewayWith(async () => jsonResponse(200, {}));
    await expect(
      gw.illustratePassage({
        title: samplePassage.meta.title,
        intent: samplePassage.meta.intent,
        level: samplePassage.meta.level,
        sentences: samplePassage.sentences,
      }),
    ).rejects.toMatchObject({ kind: 'network' });
  });
});
