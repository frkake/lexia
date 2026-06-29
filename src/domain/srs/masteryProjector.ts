/**
 * L1 — MasteryProjector: derives the 4-stage mastery from FSRS state and provides
 * the 4→3 density downcast that drives generated-annotation density (design.md
 * "MasteryProjector", Flow 2). The stage is a projection, not an independent score:
 *   - promotion fires ONLY on explicit review success (grade ≥ 3) past a stability
 *     threshold; reading-time (passage) recall never promotes;
 *   - demotion is automatic when stability (or the lapse count) no longer supports
 *     the current stage.
 */

import type { MasteryStage, MasteryDensity, Rating, WordSchedulingState } from '../../types/domain';
import { S_CONSOLIDATE, S_MASTER } from './parameters';

/** What triggered this projection. */
export type MasteryEvent = { kind: 'review'; rating: Rating } | { kind: 'passage' } | { kind: 'none' };

export interface MasteryProjector {
  deriveMastery(state: WordSchedulingState, event: MasteryEvent): MasteryStage;
  toDensity(stage: MasteryStage): MasteryDensity;
}

const MAX_LAPSES_FOR_MASTERY = 3;

const ORDER: Record<MasteryStage, number> = { New: 0, Learning: 1, Consolidating: 2, Mastered: 3 };
const higher = (a: MasteryStage, b: MasteryStage): MasteryStage => (ORDER[a] >= ORDER[b] ? a : b);
const lower = (a: MasteryStage, b: MasteryStage): MasteryStage => (ORDER[a] <= ORDER[b] ? a : b);

/** The highest stage the current stability + lapse count can justify. */
function stageCeiling(stability: number, lapses: number): MasteryStage {
  if (stability > S_MASTER && lapses < MAX_LAPSES_FOR_MASTERY) return 'Mastered';
  if (stability > S_CONSOLIDATE) return 'Consolidating';
  return 'Learning';
}

const DENSITY: Record<MasteryStage, MasteryDensity> = {
  New: 'new',
  Learning: 'review',
  Consolidating: 'known',
  Mastered: 'known',
};

export const masteryProjector: MasteryProjector = {
  deriveMastery(state, event) {
    if (state.stability === undefined) return 'New';

    // A learned word is at least Learning (first rating moves New → Learning).
    const base: MasteryStage = state.mastery === 'New' ? 'Learning' : state.mastery;
    const ceiling = stageCeiling(state.stability, state.lapses);
    const explicitSuccess = event.kind === 'review' && event.rating >= 3;

    // Explicit success may promote up to the ceiling but never demotes;
    // any other event may demote to the ceiling but never promotes.
    return explicitSuccess ? higher(base, ceiling) : lower(base, ceiling);
  },

  toDensity(stage) {
    return DENSITY[stage];
  },
};
