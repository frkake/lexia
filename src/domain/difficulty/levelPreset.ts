/**
 * L1 — levelPreset: the shared source of truth for the two concrete knobs behind a
 * learner-facing target level. The exam picker chooses a target; these values are the editable
 * custom settings derived from that target.
 */

import { examScale } from './examScale';
import type { AdvancedDifficulty, Cefr, ExamCriterion, ReadabilityLevel } from '../../types/domain';

export interface LevelPreset {
  vocabularyLevel: Cefr;
  readabilityLevel: ReadabilityLevel;
}

export function readabilityForCefr(level: Cefr): ReadabilityLevel {
  if (level === 'A2' || level === 'B1') return 'easy';
  if (level === 'B2') return 'standard';
  return 'advanced';
}

export function levelPresetForExamTarget(examTarget: ExamCriterion): LevelPreset {
  const vocabularyLevel = examScale.examToCefr(examTarget);
  return {
    vocabularyLevel,
    readabilityLevel: readabilityForCefr(vocabularyLevel),
  };
}

export function customAdvancedDifficultyForExamTarget(
  examTarget: ExamCriterion,
  values: LevelPreset,
): AdvancedDifficulty | undefined {
  const preset = levelPresetForExamTarget(examTarget);
  const advanced: AdvancedDifficulty = {};
  if (values.vocabularyLevel !== preset.vocabularyLevel) {
    advanced.vocabularyLevel = values.vocabularyLevel;
  }
  if (values.readabilityLevel !== preset.readabilityLevel) {
    advanced.readabilityLevel = values.readabilityLevel;
  }
  return Object.keys(advanced).length > 0 ? advanced : undefined;
}
