import { describe, it, expect } from 'vitest';
import { isCueGrounded } from './noticeGrounding';

describe('isCueGrounded', () => {
  it('grounds a cue by category via the canonical WordData path', () => {
    expect(isCueGrounded('connotation', { connotation: 'positive' })).toBe(true);
    expect(isCueGrounded('register', { register: 'business' })).toBe(true);
    expect(isCueGrounded('collocation', { core: { collocations: ['make a deal'] } })).toBe(true);
    expect(isCueGrounded('common_error', { more: { commonErrors: ['agenda vs schedule'] } })).toBe(true);
  });

  it('is NOT grounded when the category attribute is absent or empty', () => {
    expect(isCueGrounded('common_error', { more: { commonErrors: [] } })).toBe(false);
    expect(isCueGrounded('word_family', {})).toBe(false);
    expect(isCueGrounded('register', undefined)).toBe(false);
  });
});
