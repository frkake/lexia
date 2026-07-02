/**
 * L1 — SessionPlanner: turns the learner's scheduling state and Setup conditions
 * into (a) a prioritized candidate-word list for the SetupScreen and (b) a
 * GenerationRequest for the orchestrator; it also produces the ordered review queue
 * (design.md "SessionPlanner", Flow 1). Pure orchestration over an injected
 * SchedulingRepository port — no React / Dexie / network import (dependency
 * inversion: the port interface lives in L0).
 */

import { masteryProjector } from '../srs/masteryProjector';
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

export function readabilityForCefr(level: Cefr): ReadabilityLevel {
  if (level === 'A2' || level === 'B1') return 'easy';
  if (level === 'B2') return 'standard';
  return 'advanced';
}

export function resolveVocabularyLevel(setup: SetupConfig): Cefr {
  return setup.advancedDifficulty?.vocabularyLevel ?? examScale.examToCefr(setup.examTarget);
}

export function resolveReadabilityLevel(setup: SetupConfig): ReadabilityLevel {
  return setup.advancedDifficulty?.readabilityLevel ?? readabilityForCefr(examScale.examToCefr(setup.examTarget));
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

function planReviewQueue(
  repo: SchedulingRepository,
  userId: UserId,
  now: number,
): Promise<WordSchedulingState[]> {
  // dueBefore already returns due-soonest first (the review presentation order).
  return repo.dueBefore(userId, now);
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

  return {
    // Resolve the exam-based difficulty to the internal CEFR pivot (generation/validation use CEFR).
    level: resolveVocabularyLevel(setup),
    intent: setup.intent,
    newWordRatio: setup.newWordRatio,
    wordTarget: setup.wordTarget,
    contentType: setup.contentType,
    readabilityLevel: resolveReadabilityLevel(setup),
    targetWords,
    ...(storyContext ? { storyContext } : {}),
  };
}

export const sessionPlanner: SessionPlanner = {
  selectCandidates,
  planReviewQueue,
  buildRequest,
};
