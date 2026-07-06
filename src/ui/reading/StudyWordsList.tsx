/**
 * L4 — study-word helper. The reading right-rail list component that once lived here was dead
 * code (its affordances were superseded by ReadingGuideRail) and was removed in F-9. This module
 * now hosts only the shared `StudyWord` shape and `studyWordLabel`, consumed by ReadingGuideRail /
 * ReadingScreen / routes to render base-form study-word labels. The filename is kept so the
 * concurrently-edited routes container needs no import change.
 */

import type { MasteryStage } from '../../types/domain';

export interface StudyWord {
  wordId: string;
  /** Preferred right-rail display label. Callers should keep this as the base-form lemma. */
  surface: string;
  stage?: MasteryStage;
  meaningJa?: string;
  collocation?: string;
  register?: string;
  connotation?: string;
  frequency?: number;
  memoryTipJa?: string;
  /** Times this word has reappeared across passages (drives the consolidation note). */
  reappearCount?: number;
}

function isSimpleInflectionOf(surface: string, lemma: string): boolean {
  const s = surface.toLowerCase();
  const l = lemma.toLowerCase();
  return s === l || s === `${l}s` || s === `${l}es` || (l.endsWith('y') && s === `${l.slice(0, -1)}ies`);
}

export function studyWordLabel(word: Pick<StudyWord, 'wordId' | 'surface'>): string {
  const surface = word.surface.trim();
  const lemma = word.wordId.trim();
  if (!surface) return lemma;
  if (lemma && isSimpleInflectionOf(surface, lemma)) return lemma;
  return surface;
}
