import { describe, it, expect } from 'vitest';
import {
  applySceneEffectToWav,
  azureAudioOffsetToMs,
  parsePollyMarks,
  utf16RangeToUtf8ByteRange,
  voiceCatalogResponse,
} from './providers';

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
    const accents = new Set(voiceCatalogResponse().voices.map((v) => v.accent));
    expect([...accents].sort()).toEqual(['au', 'gb', 'in', 'us']);
  });

  it('applies deterministic scene texture only when ambient noise is requested', () => {
    const source = wav([0, 0, 0, 0]);
    expect(applySceneEffectToWav(source, { sceneKind: 'street_interview', noiseLevel: 'none' })).toBe(source);
    const textured = applySceneEffectToWav(source, { sceneKind: 'street_interview', noiseLevel: 'medium' });
    expect(textured.equals(source)).toBe(false);
    expect(textured.toString('ascii', 0, 4)).toBe('RIFF');
    expect(textured.length).toBe(source.length);
  });
});
