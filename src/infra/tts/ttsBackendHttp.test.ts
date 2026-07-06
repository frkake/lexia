import { describe, it, expect, vi } from 'vitest';
import { HttpTtsBackend } from './ttsBackendHttp';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('HttpTtsBackend', () => {
  it('POSTs the passage text and returns the synthesis result', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        audioUrl: 'https://cdn/p.mp3',
        format: 'audio/mpeg',
        durationMs: 2000,
        engine: 'polly',
        marks: [{ start: 0, end: 3, timeMs: 0 }],
      }),
    );
    const backend = new HttpTtsBackend({ baseUrl: 'https://api.test', fetch: fetchMock });

    const result = await backend.synthesize('We closed the deal.', 'Joanna');

    expect(result).toMatchObject({ audioUrl: 'https://cdn/p.mp3', durationMs: 2000, engine: 'polly' });
    expect(result.marks).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.test/api/tts:synthesize');
    expect(JSON.parse(init!.body as string)).toEqual({ text: 'We closed the deal.', voiceId: 'Joanna' });
  });

  it('POSTs listening-scene segments when supplied', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        audioUrl: 'data:audio/wav;base64,AA==',
        format: 'audio/wav',
        durationMs: 1000,
        engine: 'azure',
        marks: [{ start: 0, end: 2, timeMs: 0 }],
      }),
    );
    const backend = new HttpTtsBackend({ fetch: fetchMock });

    await backend.synthesize('Hi there.', 'azure-gb-sonia', {
      segments: [{ text: 'Hi there.', byteStart: 0, voiceId: 'azure-gb-sonia', speakerId: 'host' }],
      scene: { sceneKind: 'podcast_dialogue', noiseLevel: 'low' },
    });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init!.body as string)).toEqual({
      text: 'Hi there.',
      voiceId: 'azure-gb-sonia',
      segments: [{ text: 'Hi there.', byteStart: 0, voiceId: 'azure-gb-sonia', speakerId: 'host' }],
      scene: { sceneKind: 'podcast_dialogue', noiseLevel: 'low' },
    });
  });

  it('resolves a word clip url', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ url: 'https://cdn/word.mp3' }));
    const backend = new HttpTtsBackend({ fetch: fetchMock });
    expect(await backend.wordClipUrl('deal', 'Joanna')).toBe('https://cdn/word.mp3');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/tts/word?wordId=deal&voiceId=Joanna');
  });

  it('rejects on a non-2xx status so the pipeline can degrade', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({}, 503));
    const backend = new HttpTtsBackend({ fetch: fetchMock });
    await expect(backend.synthesize('x', 'v')).rejects.toThrow(/503/);
  });
});
