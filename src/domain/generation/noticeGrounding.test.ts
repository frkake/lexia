import { describe, it, expect } from 'vitest';
import { isCueGrounded } from './noticeGrounding';

describe('isCueGrounded', () => {
  it('grounds a cue by category via the canonical WordData path', () => {
    expect(isCueGrounded('connotation', { connotation: 'positive' })).toBe(true);
    expect(isCueGrounded('register', { register: 'business' })).toBe(true);
    expect(isCueGrounded('collocation', { core: { collocations: ['make a deal'] } })).toBe(true);
    expect(isCueGrounded('common_error', { more: { commonErrors: ['agenda vs schedule'] } })).toBe(true);
    expect(isCueGrounded('memory_tip', { memoryTips: [{ kind: 'contrast', tipJa: 'buy と比べる。' }] })).toBe(true);
    expect(isCueGrounded('metaphor', { more: { metaphor: 'つかむ比喩' } })).toBe(true);
  });

  it('is NOT grounded when the category attribute is absent or empty', () => {
    expect(isCueGrounded('common_error', { more: { commonErrors: [] } })).toBe(false);
    expect(isCueGrounded('word_family', {})).toBe(false);
    expect(isCueGrounded('register', undefined)).toBe(false);
  });

  it('treats location-only categories as never attribute-grounded (the annotation pass asserts them)', () => {
    expect(isCueGrounded('idiom', { more: { idioms: ['bite the bullet'] } })).toBe(false);
    expect(isCueGrounded('phrasal_verb', {})).toBe(false);
    expect(isCueGrounded('sentence_structure', { more: { grammarPatterns: ['Although ..., ...'] } })).toBe(false);
  });
});
