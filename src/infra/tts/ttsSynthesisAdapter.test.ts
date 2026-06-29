import { describe, it, expect } from 'vitest';
import { TtsSynthesisAdapter } from './ttsSynthesisAdapter';
import type { TtsBackend, TtsSynthesisResult, TtsWordMark } from './ttsSynthesisAdapter';
import { tokenizer } from '../../domain/tokenizer/joinService';
import type { IndexedPassage, PassageOutput } from '../../types/domain';

function indexed(): IndexedPassage {
  const passage: PassageOutput = {
    meta: { title: 't', theme: 'travel', level: 'B1', newCount: 0, reviewCount: 0, approxWords: 4 },
    sentences: [{ tokens: ['She', 'stayed', 'resilient', '.'], translationJa: '' }],
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [],
  };
  return tokenizer.index('p1', passage);
}

/** Build word-type speech marks (byte ranges + times) for the alphanumeric tokens. */
function marksFor(idx: IndexedPassage): TtsWordMark[] {
  return idx.tokens
    .filter((t) => /[a-zA-Z0-9]/.test(t.text))
    .map((t, i) => ({ start: t.byteStart, end: t.byteEnd, timeMs: i * 300 }));
}

function backend(result: TtsSynthesisResult, clip = 'https://cdn/clip.mp3'): TtsBackend {
  return {
    synthesize: async () => result,
    wordClipUrl: async () => clip,
  };
}

describe('TtsSynthesisAdapter.synthesize', () => {
  it('resolves marks to tokenIds and returns a token-resolved TimingMap', async () => {
    const idx = indexed();
    const result: TtsSynthesisResult = {
      audioUrl: 'https://cdn/p1.mp3',
      format: 'audio/mpeg',
      durationMs: 1200,
      engine: 'polly',
      marks: marksFor(idx),
    };
    const adapter = new TtsSynthesisAdapter(backend(result));
    const { asset, timing } = await adapter.synthesize(idx, 'joanna');

    expect(asset).toMatchObject({ passageId: 'p1', voiceId: 'joanna', audioUrl: 'https://cdn/p1.mp3', durationMs: 1200 });
    // one mark per alphanumeric token (punctuation excluded).
    expect(timing.marks).toHaveLength(3);
    expect(timing.marks.map((m) => m.tokenId)).toEqual(['p1:0:0', 'p1:0:1', 'p1:0:2']);
    // ordered by start time (binary-searchable) and the last mark ends at the duration.
    expect(timing.marks.map((m) => m.startMs)).toEqual([0, 300, 600]);
    expect(timing.marks[2]!.endMs).toBe(1200);
  });

  it('rejects a mark set that does not cover every word token', async () => {
    const idx = indexed();
    const partial = marksFor(idx).slice(0, 2); // drops "resilient"
    const adapter = new TtsSynthesisAdapter(
      backend({ audioUrl: 'u', format: 'audio/mpeg', durationMs: 900, engine: 'polly', marks: partial }),
    );
    await expect(adapter.synthesize(idx, 'joanna')).rejects.toMatchObject({ kind: 'coverage_mismatch' });
  });

  it('rejects a mark whose byte range resolves to no token', async () => {
    const idx = indexed();
    const marks = marksFor(idx);
    marks.push({ start: 9_000, end: 9_010, timeMs: 1_000 }); // out of range
    const adapter = new TtsSynthesisAdapter(
      backend({ audioUrl: 'u', format: 'audio/mpeg', durationMs: 1_200, engine: 'polly', marks }),
    );
    await expect(adapter.synthesize(idx, 'joanna')).rejects.toMatchObject({ kind: 'mark_unresolved' });
  });
});

describe('TtsSynthesisAdapter.wordClipUrl', () => {
  it('delegates to the backend', async () => {
    const adapter = new TtsSynthesisAdapter(
      backend({ audioUrl: 'u', format: 'audio/mpeg', durationMs: 0, engine: 'polly', marks: [] }, 'https://cdn/word.mp3'),
    );
    expect(await adapter.wordClipUrl('w1', 'joanna')).toBe('https://cdn/word.mp3');
  });
});
