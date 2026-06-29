import { describe, it, expect } from 'vitest';
import { tokenizer } from './joinService';
import type { PassageOutput, IndexedPassage, TokenId } from '../../types/domain';

function passage(): PassageOutput {
  return {
    meta: { title: 't', theme: 'x', level: 'B1', newCount: 0, reviewCount: 0, approxWords: 0 },
    sentences: [
      { tokens: ['I', "'m", 'well', '-', 'rested', '.'], translationJa: '' },
      { tokens: ['She', 'said', ',', '“', 'Hi', '”', '.'], translationJa: '' },
    ],
    targetSpans: [
      { sentenceIndex: 0, tokenStart: 2, tokenEnd: 5, wordId: 'w_rested', surface: 'well-rested', masteryDensity: 'new' },
    ],
    collocationSpans: [],
    noticeCues: [],
  };
}

const tok = (idx: IndexedPassage, id: TokenId) => idx.tokens.find((t) => t.tokenId === id)!;

describe('TokenizerJoinService.renderText', () => {
  it('joins contractions, hyphens, punctuation and quotes deterministically', () => {
    const p = passage();
    expect(tokenizer.renderText(p.sentences[0]!)).toBe("I'm well-rested.");
    expect(tokenizer.renderText(p.sentences[1]!)).toBe('She said, “Hi”.');
  });

  it('is a pure function of its input (same input → same output)', () => {
    const p = passage();
    expect(tokenizer.renderText(p.sentences[0]!)).toBe(tokenizer.renderText(p.sentences[0]!));
  });
});

describe('TokenizerJoinService.index', () => {
  it('assigns stable tokenIds and joins sentences into one render string', () => {
    const idx = tokenizer.index('p1', passage());
    expect(idx.renderText).toBe('I\'m well-rested. She said, “Hi”.');
    expect(idx.tokens[0]!.tokenId).toBe('p1:0:0');
    expect(tok(idx, 'p1:1:1').text).toBe('said');
  });

  it('coverage equals token count: every token slice matches its surface', () => {
    const p = passage();
    const idx = tokenizer.index('p1', p);
    const total = p.sentences.reduce((n, s) => n + s.tokens.length, 0);
    expect(idx.tokens).toHaveLength(total);
    for (const t of idx.tokens) {
      expect(idx.renderText.slice(t.charStart, t.charEnd)).toBe(t.text);
    }
  });

  it('computes UTF-16 and UTF-8 offsets that diverge on multibyte characters', () => {
    const idx = tokenizer.index('p1', passage());
    const quote = tok(idx, 'p1:1:3'); // “ — 1 UTF-16 unit, 3 UTF-8 bytes
    expect(quote.text).toBe('“');
    expect(quote.charEnd - quote.charStart).toBe(1);
    expect(quote.byteEnd - quote.byteStart).toBe(3);
    // After a multibyte char, byte offset runs ahead of char offset.
    const afterQuote = tok(idx, 'p1:1:4'); // Hi
    expect(afterQuote.byteStart).toBeGreaterThan(afterQuote.charStart);
  });

  it('is deterministic across calls', () => {
    expect(tokenizer.index('p1', passage())).toEqual(tokenizer.index('p1', passage()));
  });
});

describe('TokenizerJoinService.resolveMark', () => {
  it('resolves each token byte range back to exactly that token', () => {
    const idx = tokenizer.index('p1', passage());
    for (const t of idx.tokens) {
      const r = tokenizer.resolveMark(idx, { start: t.byteStart, end: t.byteEnd });
      expect(r).toEqual({ ok: true, value: t.tokenId });
    }
  });

  it('errors with multi_token when a mark spans more than one token', () => {
    const idx = tokenizer.index('p1', passage());
    const well = tok(idx, 'p1:0:2');
    const rested = tok(idx, 'p1:0:4');
    const r = tokenizer.resolveMark(idx, { start: well.byteStart, end: rested.byteEnd });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('multi_token');
  });

  it('errors with no_token when a mark lies outside every token', () => {
    const idx = tokenizer.index('p1', passage());
    const past = new TextEncoder().encode(idx.renderText).length + 5;
    const r = tokenizer.resolveMark(idx, { start: past, end: past + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('no_token');
  });
});

describe('TokenizerJoinService.hitTest', () => {
  it('returns the TargetSpan covering a token and null elsewhere', () => {
    const idx = tokenizer.index('p1', passage());
    expect(tokenizer.hitTest(idx, 'p1:0:3')?.wordId).toBe('w_rested'); // hyphen inside span
    expect(tokenizer.hitTest(idx, 'p1:0:4')?.wordId).toBe('w_rested'); // 'rested'
    expect(tokenizer.hitTest(idx, 'p1:0:0')).toBeNull(); // 'I'
    expect(tokenizer.hitTest(idx, 'p1:9:9')).toBeNull(); // unknown token
  });
});
