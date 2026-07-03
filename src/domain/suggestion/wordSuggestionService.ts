/**
 * L1 — WordSuggestionService (Requirement 5). Turns the ContentGateway's raw new-vocabulary
 * proposals and SRS state into the SetupScreen's "words to weave in" list:
 *   - includes due and weak scheduled words so difficult vocabulary reappears in new passages;
 *   - drops brand-new proposals the learner already has scheduling state for (no duplicate teaching, 5.2);
 *   - drops words the learner explicitly excluded (5.2);
 *   - de-duplicates and sorts ABC (5.3);
 *   - reports a shortfall (exhausted / gateway_unavailable) without blocking generation (5.5).
 * The new-word source is the server LLM (`ContentGateway.suggestWords`); this service owns the
 * SRS merge / exclusion / ordering / dedupe responsibility. Pure orchestration over injected ports.
 */

import type { ContentGateway, SchedulingRepository } from '../../types/ports';
import { masteryProjector } from '../srs/masteryProjector';
import type { CandidateReason, CandidateWord, Cefr, SuggestionInput, SuggestionResult, WordSchedulingState } from '../../types/domain';

export interface WordSuggestionService {
  suggest(input: SuggestionInput, scheduling: SchedulingRepository): Promise<SuggestionResult>;
  /** Re-apply ABC order + case-insensitive dedupe to an edited selection (Requirement 5.4). */
  normalizeSelection(wordIds: string[]): string[];
}

export interface WordSuggestionServiceOptions {
  /** External CEFR band lookup for legacy scheduling rows that do not yet store `level`. */
  cefrOf?: (wordId: string) => Cefr | undefined;
}

/** Case-insensitive ABC comparator (LLM lemmas are lowercase; user additions may not be). */
const abc = (a: string, b: string): number => a.toLowerCase().localeCompare(b.toLowerCase());
const abcCandidate = (a: CandidateWord, b: CandidateWord): number => abc(a.wordId, b.wordId);
const CEFR_RANK: Record<Cefr, number> = { A2: 0, B1: 1, B2: 2, C1: 3, C2: 4 };

function targetCount(input: SuggestionInput): number {
  const desired = input.desiredNewCount ?? input.count;
  return Math.min(input.count, Math.max(0, desired));
}

function keyOf(wordId: string): string {
  return wordId.trim().toLowerCase();
}

function scheduledLevel(state: WordSchedulingState, options: WordSuggestionServiceOptions): Cefr | undefined {
  return state.level ?? options.cefrOf?.(keyOf(state.wordId));
}

function fitsTargetLevel(target: Cefr, actual: Cefr | undefined): actual is Cefr {
  if (!actual) return false;
  const delta = CEFR_RANK[target] - CEFR_RANK[actual];
  return delta >= 0 && delta <= 1;
}

/** Dedupe case-insensitively, preserving the first-seen spelling, then sort ABC. */
function normalizeSelection(wordIds: string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const w of wordIds) {
    const key = w.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(w.trim());
  }
  return kept.sort(abc);
}

export function createWordSuggestionService(
  gateway: ContentGateway,
  options: WordSuggestionServiceOptions = {},
): WordSuggestionService {
  async function suggest(input: SuggestionInput, scheduling: SchedulingRepository): Promise<SuggestionResult> {
    const requested = targetCount(input);
    if (requested === 0) return { candidates: [] };

    const excluded = new Set(input.excludedWordIds.map(keyOf).filter(Boolean));
    const selected = new Map<string, CandidateWord>();

    const addScheduled = (state: WordSchedulingState, reason: CandidateReason): void => {
      const key = keyOf(state.wordId);
      if (!key || excluded.has(key) || selected.has(key)) return;
      const level = scheduledLevel(state, options);
      if (!fitsTargetLevel(input.level, level)) return;
      selected.set(key, {
        wordId: state.wordId,
        surface: state.wordId,
        level,
        reason,
        stage: masteryProjector.deriveMastery(state, { kind: 'none' }),
      });
    };

    const [due, weak] = await Promise.all([
      scheduling.dueBefore(input.userId, input.now),
      scheduling.lowStability(input.userId, requested * 3),
    ]);

    for (const state of due) {
      addScheduled(state, 'due');
      if (selected.size >= requested) break;
    }
    if (selected.size < requested) {
      for (const state of weak) {
        addScheduled(state, 'weak');
        if (selected.size >= requested) break;
      }
    }

    let gatewayUnavailable = false;
    let proposed: string[];
    if (selected.size < requested && gateway.suggestWords) {
      try {
        proposed = await gateway.suggestWords({
          level: input.level,
          intent: input.intent,
          count: requested - selected.size,
          exclude: [...excluded, ...selected.keys()],
        });
      } catch {
        proposed = [];
        gatewayUnavailable = true;
      }
    } else {
      proposed = [];
      gatewayUnavailable = selected.size < requested && !gateway.suggestWords;
    }

    // Dedupe fresh proposals (case-insensitive) and drop excluded / already selected words.
    const seen = new Set<string>();
    const lemmas: string[] = [];
    for (const raw of proposed) {
      const lemma = keyOf(raw);
      if (!lemma || seen.has(lemma) || excluded.has(lemma) || selected.has(lemma)) continue;
      seen.add(lemma);
      lemmas.push(lemma);
    }

    // Drop already-introduced words from the LLM's fresh proposals so we never re-teach.
    const introduced = await Promise.all(lemmas.map((w) => scheduling.get(input.userId, w)));
    for (let i = 0; i < lemmas.length && selected.size < requested; i += 1) {
      const wordId = lemmas[i]!;
      if (introduced[i] !== undefined) continue;
      selected.set(wordId, { wordId, surface: wordId, level: input.level, reason: 'new' });
    }

    const candidates = [...selected.values()].sort(abcCandidate);
    const result: SuggestionResult = { candidates };
    if (candidates.length < requested) {
      result.shortfall = {
        requested,
        available: candidates.length,
        reason: gatewayUnavailable ? 'gateway_unavailable' : 'exhausted',
      };
    }
    return result;
  }

  return { suggest, normalizeSelection };
}
