import { describe, it, expect } from 'vitest';
import { HttpContentGateway } from './contentGatewayHttp';
import type { GenerationRequest, WordData } from '../../types/domain';

const req: GenerationRequest = {
  level: 'B1',
  themes: ['travel'],
  newWordRatio: 0.3,
  length: 'short',
  targetWords: [{ wordId: 'w1', surface: 'resilient', masteryDensity: 'new' }],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function gatewayWith(fetchImpl: typeof fetch): HttpContentGateway {
  return new HttpContentGateway({ baseUrl: 'https://api.test', fetch: fetchImpl });
}

const samplePassage = {
  meta: { title: 't', theme: 'travel', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 5 },
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
    const words = await gw.suggestWords({ level: 'B1', themes: ['会議'], count: 2 });
    expect(captured!.url).toBe('https://api.test/api/words:suggest');
    expect(captured!.init?.method).toBe('POST');
    expect(words).toEqual(['agenda', 'consensus']);
  });

  it('returns an empty list when the reply has no words array', async () => {
    const gw = gatewayWith(async () => jsonResponse(200, {}));
    expect(await gw.suggestWords({ level: 'B1', themes: ['x'], count: 3 })).toEqual([]);
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
    const cues = await gw.annotatePassage({ sentences: samplePassage.sentences, level: 'B1', collocationSpans, targetSpans });
    expect(captured!.url).toBe('https://api.test/api/passages:annotate');
    expect(captured!.init?.method).toBe('POST');
    // The required-coverage spans must reach the proxy so the rail can cover every body mark.
    expect(JSON.parse(String(captured!.init?.body))).toMatchObject({ level: 'B1', collocationSpans, targetSpans });
    expect(cues).toEqual([cue]);
  });

  it('returns an empty list when the reply has no cues array', async () => {
    const gw = gatewayWith(async () => jsonResponse(200, {}));
    expect(await gw.annotatePassage({ sentences: samplePassage.sentences, level: 'B1' })).toEqual([]);
  });
});
