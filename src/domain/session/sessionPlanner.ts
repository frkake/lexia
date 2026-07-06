/**
 * L1 — SessionPlanner: turns the learner's scheduling state and Setup conditions
 * into (a) a prioritized candidate-word list for the SetupScreen and (b) a
 * GenerationRequest for the orchestrator; it also produces the ordered review queue
 * (design.md "SessionPlanner", Flow 1). Pure orchestration over an injected
 * SchedulingRepository port — no React / Dexie / network import (dependency
 * inversion: the port interface lives in L0).
 */

import { masteryProjector } from '../srs/masteryProjector';
import { isDueForReview } from '../srs/dueState';
import { SESSION_REVIEW_LIMIT } from '../srs/parameters';
import { levelPresetForExamTarget, readabilityForCefr } from '../difficulty/levelPreset';
import { examScale } from '../difficulty/examScale';
import type { SchedulingRepository } from '../../types/ports';
import type {
  UserId,
  WordSchedulingState,
  SetupConfig,
  GenerationRequest,
  GenerationTargetWord,
  StoryContext,
  WordData,
  Cefr,
  ReadabilityLevel,
} from '../../types/domain';

export interface SessionPlanner {
  /**
   * Auto-select words to weave in: due words first (soonest first), then the
   * weakest-stability words, deduped and capped at `limit`.
   */
  selectCandidates(
    repo: SchedulingRepository,
    userId: UserId,
    now: number,
    limit: number,
  ): Promise<WordSchedulingState[]>;
  /** Ordered queue of due words for a review session (due-soonest first). */
  planReviewQueue(
    repo: SchedulingRepository,
    userId: UserId,
    now: number,
  ): Promise<WordSchedulingState[]>;
  /** Assemble the generation request from Setup conditions + target words. */
  buildRequest(
    setup: SetupConfig,
    states: WordSchedulingState[],
    wordData?: Record<string, WordData>,
    storyContext?: StoryContext,
  ): GenerationRequest;
}

export { readabilityForCefr };

export function resolveVocabularyLevel(setup: SetupConfig): Cefr {
  return setup.advancedDifficulty?.vocabularyLevel ?? levelPresetForExamTarget(setup.examTarget).vocabularyLevel;
}

export function resolveReadabilityLevel(setup: SetupConfig): ReadabilityLevel {
  return setup.advancedDifficulty?.readabilityLevel ?? levelPresetForExamTarget(setup.examTarget).readabilityLevel;
}

async function selectCandidates(
  repo: SchedulingRepository,
  userId: UserId,
  now: number,
  limit: number,
): Promise<WordSchedulingState[]> {
  const [due, weak] = await Promise.all([
    repo.dueBefore(userId, now),
    repo.lowStability(userId, limit),
  ]);
  // Due words take priority (already due-soonest first); fill the rest with the
  // weakest words not already chosen.
  const ordered: WordSchedulingState[] = [];
  const seen = new Set<string>();
  for (const s of [...due, ...weak]) {
    if (seen.has(s.wordId)) continue;
    seen.add(s.wordId);
    ordered.push(s);
    if (ordered.length >= limit) break;
  }
  return ordered;
}

async function planReviewQueue(
  repo: SchedulingRepository,
  userId: UserId,
  now: number,
): Promise<WordSchedulingState[]> {
  // C-5b: the review queue is exactly the words `isDueForReview` accepts (learned + dueAt elapsed),
  // due-soonest first, capped at SESSION_REVIEW_LIMIT (load design; policy principle 7). Freshly
  // seeded New words (stability undefined) are gated out here just as they are in the dashboard
  // count, so "今日の復習 N 語" and the session's card total can only differ by this cap.
  const due = await repo.dueBefore(userId, now);
  return due
    .filter((s) => isDueForReview(s, now))
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, SESSION_REVIEW_LIMIT);
}

function buildRequest(
  setup: SetupConfig,
  states: WordSchedulingState[],
  wordData?: Record<string, WordData>,
  storyContext?: StoryContext,
): GenerationRequest {
  const byWord = new Map(states.map((s) => [s.wordId, s]));
  const excluded = new Set(setup.excludedWordIds);

  const targetWords: GenerationTargetWord[] = [];
  const seen = new Set<string>();
  for (const wordId of setup.targetWordIds) {
    if (excluded.has(wordId) || seen.has(wordId)) continue;
    seen.add(wordId);

    const state = byWord.get(wordId);
    const masteryDensity = state
      ? masteryProjector.toDensity(masteryProjector.deriveMastery(state, { kind: 'none' }))
      : 'new';
    const data = wordData?.[wordId];
    targetWords.push({
      wordId,
      surface: data?.headword ?? wordId,
      masteryDensity,
      ...(data ? { attributes: data as unknown as Record<string, unknown> } : {}),
    });
  }

  // Sub-band + exam label for the passage prompt (A-3-1): keeps the coarse CEFR pivot but lets the
  // prompt distinguish e.g. "TOEIC 900" (upper B2) from "TOEIC 800" (mid B2).
  const { subBand, examLabel } = examScale.examToDifficultyTarget(setup.examTarget);

  return {
    // Resolve the exam-based difficulty to the internal CEFR pivot (generation/validation use CEFR).
    level: resolveVocabularyLevel(setup),
    intent: setup.intent,
    newWordRatio: setup.newWordRatio,
    wordTarget: setup.wordTarget,
    contentType: setup.contentType,
    readabilityLevel: resolveReadabilityLevel(setup),
    levelDetail: { subBand, examLabel },
    targetWords,
    ...(storyContext ? { storyContext } : {}),
    ...(setup.contentType === 'listening_scene' && setup.listeningOptions ? { listeningOptions: setup.listeningOptions } : {}),
  };
}

export const sessionPlanner: SessionPlanner = {
  selectCandidates,
  planReviewQueue,
  buildRequest,
};
