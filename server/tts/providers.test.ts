import { describe, it, expect, vi } from 'vitest';
import {
  applySceneEffectToWav,
  azureAudioOffsetToMs,
  parsePollyMarks,
  synthesizeSpeech,
  synthesizeWordClip,
  utf16RangeToUtf8ByteRange,
  voiceCatalogResponse,
} from './providers';

// Azure branch stub so provider routing can be exercised without network/credentials;
// yields one word mark and a minimal 24 kHz/16-bit/mono WAV.
vi.mock('microsoft-cognitiveservices-speech-sdk', () => {
  class SpeechConfig {
    static fromSubscription() {
      return new SpeechConfig();
    }
    speechSynthesisVoiceName = '';
    speechSynthesisOutputFormat = 0;
  }
  class SpeechSynthesizer {
    wordBoundary: ((sender: unknown, event: unknown) => void) | undefined;
    speakTextAsync(text: string, ok: (result: { audioData: ArrayBuffer }) => void) {
      this.wordBoundary?.(this, { audioOffset: 0, textOffset: 0, wordLength: text.length });
      const data = Buffer.alloc(480); // 240 samples = 10 ms
      const header = Buffer.alloc(44);
      header.write('RIFF', 0);
      header.writeUInt32LE(36 + data.length, 4);
      header.write('WAVE', 8);
      header.write('fmt ', 12);
      header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20);
      header.writeUInt16LE(1, 22);
      header.writeUInt32LE(24_000, 24);
      header.writeUInt32LE(48_000, 28);
      header.writeUInt16LE(2, 32);
      header.writeUInt16LE(16, 34);
      header.write('data', 36);
      header.writeUInt32LE(data.length, 40);
      const wavBuffer = Buffer.concat([header, data]);
      ok({ audioData: wavBuffer.buffer.slice(wavBuffer.byteOffset, wavBuffer.byteOffset + wavBuffer.length) as ArrayBuffer });
    }
    close() {}
  }
  return { SpeechConfig, SpeechSynthesizer, SpeechSynthesisOutputFormat: { Riff24Khz16BitMonoPcm: 1 } };
});

function wav(samples: number[]): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, i) => data.writeInt16LE(sample, i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24_000, 24);
  header.writeUInt32LE(48_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

describe('server TTS providers', () => {
  it('converts Azure UTF-16 text offsets to UTF-8 byte ranges', () => {
    // "é" is one UTF-16 code unit but two UTF-8 bytes.
    expect(utf16RangeToUtf8ByteRange('café deal', 5, 4, 10)).toEqual({ start: 16, end: 20 });
  });

  it('converts Azure 100ns audio offsets to milliseconds', () => {
    expect(azureAudioOffsetToMs(12_300_000)).toBe(1230);
  });

  it('normalizes Polly word speech marks with base byte and time offsets', () => {
    const marks = parsePollyMarks(
      '{"time":0,"type":"word","start":0,"end":4,"value":"City"}\n{"time":300,"type":"word","start":5,"end":10,"value":"lights"}\n',
      20,
      1000,
    );
    expect(marks).toEqual([
      { start: 20, end: 24, timeMs: 1000 },
      { start: 25, end: 30, timeMs: 1300 },
    ]);
  });

  it('exposes the required accent voices through the catalog route payload', () => {
    const accents = new Set(voiceCatalogResponse({}).voices.map((v) => v.accent));
    expect([...accents].sort()).toEqual(['au', 'gb', 'in', 'us']);
  });

  it('reports per-voice availability from the env (no provider ⇒ nothing available)', () => {
    const openaiOnly = voiceCatalogResponse({ OPENAI_API_KEY: 'sk-test' });
    expect(openaiOnly.providers).toEqual({ azure: false, polly: false, openai: true });
    for (const voice of openaiOnly.voices) {
      expect(voice.available).toBe(voice.provider === 'openai');
    }
    const nothing = voiceCatalogResponse({});
    expect(nothing.voices.every((v) => !v.available)).toBe(true);
  });

  it('applies deterministic scene texture only when ambient noise is requested', () => {
    const source = wav([0, 0, 0, 0]);
    expect(applySceneEffectToWav(source, { sceneKind: 'street_interview', noiseLevel: 'none' })).toBe(source);
    const textured = applySceneEffectToWav(source, { sceneKind: 'street_interview', noiseLevel: 'medium' });
    expect(textured.equals(source)).toBe(false);
    expect(textured.toString('ascii', 0, 4)).toBe('RIFF');
    expect(textured.length).toBe(source.length);
  });

  it('gives tv_broadcast the radio_news broadcast texture and casual_conversation the quiet fallback', () => {
    const source = wav(new Array(16).fill(0));
    const tv = applySceneEffectToWav(source, { sceneKind: 'tv_broadcast', noiseLevel: 'medium' });
    expect(tv.equals(applySceneEffectToWav(source, { sceneKind: 'radio_news', noiseLevel: 'medium' }))).toBe(true);
    expect(tv.equals(source)).toBe(false);
    const casual = applySceneEffectToWav(source, { sceneKind: 'casual_conversation', noiseLevel: 'medium' });
    expect(casual.equals(applySceneEffectToWav(source, { sceneKind: 'podcast_dialogue', noiseLevel: 'medium' }))).toBe(true);
    expect(casual.equals(source)).toBe(false);
  });
});

/** 240 zero samples = 10 ms at 24 kHz. */
const tenMsWav = () => wav(new Array(240).fill(0));

function openAiFetch() {
  return vi.fn<typeof fetch>(async () => new Response(tenMsWav()));
}

function sentBody(fetchMock: ReturnType<typeof openAiFetch>, call = 0): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[call]![1]!.body as string) as Record<string, unknown>;
}

describe('OpenAI TTS provider', () => {
  it('rejects an Azure voice as voice_unavailable when only OPENAI_API_KEY is configured (no fallback)', async () => {
    // The old behavior silently swapped the requested Azure voice for an OpenAI one. Availability
    // is now strict: the caller is told this voice cannot be generated and by which env vars.
    const fetchMock = openAiFetch();
    await expect(
      synthesizeSpeech({ OPENAI_API_KEY: 'sk-test' }, { text: 'Hello there', voiceId: 'azure-us-jenny' }, fetchMock),
    ).rejects.toMatchObject({ status: 503, code: 'voice_unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('synthesizes an OpenAI voice directly when OPENAI_API_KEY is configured', async () => {
    const fetchMock = openAiFetch();
    const result = await synthesizeSpeech({ OPENAI_API_KEY: 'sk-test' }, { text: 'Hello there', voiceId: 'openai-us-nova' }, fetchMock);

    expect(result).toMatchObject({ engine: 'openai', format: 'audio/wav', durationMs: 10, marks: [] });
    expect(result.audioUrl.startsWith('data:audio/wav;base64,')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/audio/speech');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    expect(sentBody(fetchMock)).toMatchObject({ model: 'gpt-4o-mini-tts', voice: 'nova', input: 'Hello there', response_format: 'wav' });
  });

  it('keeps Azure first when both Azure and OpenAI are configured', async () => {
    const fetchMock = openAiFetch();
    const env = { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'eastus', OPENAI_API_KEY: 'sk-test' };
    const result = await synthesizeSpeech(env, { text: 'Hello', voiceId: 'azure-us-jenny' }, fetchMock);

    expect(result.engine).toBe('azure');
    expect(result.marks).toEqual([{ start: 0, end: 5, timeMs: 0 }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends accent + scene instructions for the gpt-4o TTS family only', async () => {
    const withInstructions = openAiFetch();
    await synthesizeSpeech(
      { OPENAI_API_KEY: 'sk-test' },
      { text: 'Hello', voiceId: 'openai-gb-fable', scene: { sceneKind: 'radio_news', noiseLevel: 'none' } },
      withInstructions,
    );
    const instructions = sentBody(withInstructions).instructions as string;
    expect(instructions).toMatch(/British English/);
    expect(instructions).toMatch(/radio news anchor/);

    const withoutInstructions = openAiFetch();
    await synthesizeSpeech(
      { OPENAI_API_KEY: 'sk-test', OPENAI_TTS_MODEL: 'tts-1' },
      { text: 'Hello', voiceId: 'openai-gb-fable', scene: { sceneKind: 'radio_news', noiseLevel: 'none' } },
      withoutInstructions,
    );
    expect(sentBody(withoutInstructions)).toMatchObject({ model: 'tts-1' });
    expect(sentBody(withoutInstructions).instructions).toBeUndefined();
  });

  it('renders each speaker segment with its own OpenAI voice and concatenates the WAVs', async () => {
    const fetchMock = openAiFetch();
    const result = await synthesizeSpeech(
      { OPENAI_API_KEY: 'sk-test' },
      {
        text: 'Hello. Hi.',
        voiceId: 'openai-us-nova',
        segments: [
          { text: 'Hello.', byteStart: 0, voiceId: 'openai-us-nova', speakerId: 'interviewer' },
          { text: 'Hi.', byteStart: 7, voiceId: 'openai-us-onyx', speakerId: 'guest_1' },
        ],
        scene: { sceneKind: 'podcast_dialogue', noiseLevel: 'low' },
      },
      fetchMock,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(fetchMock, 0).voice).toBe('nova');
    expect(sentBody(fetchMock, 1).voice).toBe('onyx');
    expect(result).toMatchObject({ engine: 'openai', durationMs: 20, marks: [] });
  });

  it('synthesizes word clips with the requested OpenAI voice (no cross-provider remap)', async () => {
    const fetchMock = openAiFetch();
    const { url } = await synthesizeWordClip({ OPENAI_API_KEY: 'sk-test' }, 'deal', 'openai-us-nova', fetchMock);

    expect(url.startsWith('data:audio/wav;base64,')).toBe(true);
    expect(sentBody(fetchMock)).toMatchObject({ input: 'deal', voice: 'nova' });
  });

  it('rejects a word clip for a voice whose provider is not configured', async () => {
    const fetchMock = openAiFetch();
    await expect(synthesizeWordClip({ OPENAI_API_KEY: 'sk-test' }, 'deal', 'azure-us-jenny', fetchMock)).rejects.toMatchObject({
      status: 503,
      code: 'voice_unavailable',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps upstream OpenAI failures to machine-readable provider errors', async () => {
    const denied = vi.fn<typeof fetch>(async () => new Response('denied', { status: 401 }));
    await expect(synthesizeSpeech({ OPENAI_API_KEY: 'sk-test' }, { text: 'Hi', voiceId: 'openai-us-nova' }, denied)).rejects.toMatchObject({
      status: 503,
      code: 'upstream_auth',
    });

    const throttled = vi.fn<typeof fetch>(async () => new Response('slow down', { status: 429 }));
    await expect(synthesizeSpeech({ OPENAI_API_KEY: 'sk-test' }, { text: 'Hi', voiceId: 'openai-us-nova' }, throttled)).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
    });
  });

  it('names OPENAI_API_KEY as the third option when nothing is configured', async () => {
    await expect(synthesizeSpeech({}, { text: 'Hi', voiceId: 'azure-us-jenny' })).rejects.toThrow(/OPENAI_API_KEY/);
  });
});
