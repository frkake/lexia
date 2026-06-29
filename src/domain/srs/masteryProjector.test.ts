import { describe, it, expect } from 'vitest';
import { masteryProjector } from './masteryProjector';
import type { UserId, WordSchedulingState } from '../../types/domain';

function st(over: Partial<WordSchedulingState> = {}): WordSchedulingState {
  return {
    userId: 'u1' as UserId,
    wordId: 'w1',
    stability: 10,
    difficulty: 5,
    reps: 5,
    lapses: 0,
    learningStep: 0,
    lastReviewAt: 0,
    dueAt: 0,
    lastSource: 'review',
    mastery: 'Learning',
    reappearCount: 0,
    ...over,
  };
}

const { deriveMastery, toDensity } = masteryProjector;

describe('MasteryProjector.deriveMastery', () => {
  it('a word without stability is New', () => {
    const s = st({ mastery: 'New' });
    delete (s as { stability?: number }).stability;
    expect(deriveMastery(s, { kind: 'none' })).toBe('New');
  });

  it('the first rating moves New → Learning', () => {
    const s = st({ mastery: 'New', stability: 2, reps: 1 });
    expect(deriveMastery(s, { kind: 'review', rating: 2 })).toBe('Learning');
    expect(deriveMastery(s, { kind: 'review', rating: 3 })).toBe('Learning');
  });

  it('Learning → Consolidating only on explicit success past S=7 (strict)', () => {
    expect(deriveMastery(st({ mastery: 'Learning', stability: 7.5 }), { kind: 'review', rating: 3 })).toBe(
      'Consolidating',
    );
    // Exactly 7 is not strictly greater → stays Learning.
    expect(deriveMastery(st({ mastery: 'Learning', stability: 7 }), { kind: 'review', rating: 3 })).toBe(
      'Learning',
    );
  });

  it('Consolidating → Mastered needs explicit success, S>30 and lapses<3', () => {
    expect(
      deriveMastery(st({ mastery: 'Consolidating', stability: 31, lapses: 1 }), { kind: 'review', rating: 4 }),
    ).toBe('Mastered');
    // lapses gate blocks mastery.
    expect(
      deriveMastery(st({ mastery: 'Consolidating', stability: 31, lapses: 3 }), { kind: 'review', rating: 3 }),
    ).toBe('Consolidating');
  });

  it('a lapse demotes Mastered → Consolidating when S falls below 30', () => {
    expect(
      deriveMastery(st({ mastery: 'Mastered', stability: 25, lapses: 1 }), { kind: 'review', rating: 1 }),
    ).toBe('Consolidating');
  });

  it('repeated lapses demote Consolidating → Learning when S falls below 7', () => {
    expect(
      deriveMastery(st({ mastery: 'Consolidating', stability: 5, lapses: 2 }), { kind: 'review', rating: 1 }),
    ).toBe('Learning');
  });

  it('passage recall never promotes the stage', () => {
    expect(deriveMastery(st({ mastery: 'Learning', stability: 20 }), { kind: 'passage' })).toBe('Learning');
  });

  it('re-projection (none) keeps a stage its stability still supports', () => {
    expect(deriveMastery(st({ mastery: 'Consolidating', stability: 10 }), { kind: 'none' })).toBe(
      'Consolidating',
    );
  });
});

describe('MasteryProjector.toDensity (4→3 downcast)', () => {
  it('maps the four stages onto the three annotation densities', () => {
    expect(toDensity('New')).toBe('new');
    expect(toDensity('Learning')).toBe('review');
    expect(toDensity('Consolidating')).toBe('known');
    expect(toDensity('Mastered')).toBe('known');
  });
});
