import { describe, it, expect } from 'vitest';
import { findActiveTokenId } from './highlightController';
import type { WordMark } from '../../types/domain';

const marks: WordMark[] = [
  { tokenId: 't0', startMs: 0, endMs: 300 },
  { tokenId: 't1', startMs: 300, endMs: 600 },
  { tokenId: 't2', startMs: 600, endMs: 1200 },
];

describe('findActiveTokenId', () => {
  it('finds the token covering a time via binary search', () => {
    expect(findActiveTokenId(marks, 0)).toBe('t0');
    expect(findActiveTokenId(marks, 299)).toBe('t0');
    expect(findActiveTokenId(marks, 300)).toBe('t1');
    expect(findActiveTokenId(marks, 900)).toBe('t2');
  });

  it('returns null before the first mark and after the last', () => {
    expect(findActiveTokenId(marks, -5)).toBeNull();
    expect(findActiveTokenId(marks, 1200)).toBeNull();
    expect(findActiveTokenId(marks, 5_000)).toBeNull();
  });

  it('returns null inside a gap between marks', () => {
    const gapped: WordMark[] = [
      { tokenId: 'a', startMs: 0, endMs: 100 },
      { tokenId: 'b', startMs: 300, endMs: 400 },
    ];
    expect(findActiveTokenId(gapped, 200)).toBeNull();
    expect(findActiveTokenId(gapped, 350)).toBe('b');
  });

  it('handles an empty mark list', () => {
    expect(findActiveTokenId([], 100)).toBeNull();
  });
});
