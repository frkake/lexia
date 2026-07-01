/**
 * L1 — WordSuggestionService (Requirement 5). Turns the ContentGateway's raw new-vocabulary
 * proposals into the SetupScreen's initial "words to weave in" list:
 *   - drops words the learner already has scheduling state for (introduced ⇒ no duplicate learning, 5.2);
 *   - drops words the learner explicitly excluded (5.2);
 *   - de-duplicates and sorts ABC (5.3);
 *   - reports a shortfall (exhausted / gateway_unavailable) without blocking generation (5.5).
 * The word source is the server LLM (`ContentGateway.suggestWords`); this service owns only the
 * exclusion / ordering / dedupe responsibility. Pure orchestration over injected ports.
 */

import type { ContentGateway, SchedulingRepository } from '../../types/ports';
import type { CandidateWord, SuggestionInput, SuggestionResult } from '../../types/domain';

export interface WordSuggestionService {
  suggest(input: SuggestionInput, scheduling: SchedulingRepository): Promise<SuggestionResult>;
  /** Re-apply ABC order + case-insensitive dedupe to an edited selection (Requirement 5.4). */
  normalizeSelection(wordIds: string[]): string[];
}

/** Case-insensitive ABC comparator (LLM lemmas are lowercase; user additions may not be). */
const abc = (a: string, b: string): number => a.toLowerCase().localeCompare(b.toLowerCase());

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

export function createWordSuggestionService(gateway: ContentGateway): WordSuggestionService {
  async function suggest(input: SuggestionInput, scheduling: SchedulingRepository): Promise<SuggestionResult> {
    if (!gateway.suggestWords) {
      return { candidates: [], shortfall: { requested: input.count, available: 0, reason: 'gateway_unavailable' } };
    }

    const excluded = new Set(input.excludedWordIds.map((w) => w.toLowerCase()));
    let proposed: string[];
    try {
      proposed = await gateway.suggestWords({
        level: input.level,
        intent: input.intent,
        count: input.count,
        exclude: input.excludedWordIds,
      });
    } catch {
      return { candidates: [], shortfall: { requested: input.count, available: 0, reason: 'gateway_unavailable' } };
    }

    // Dedupe (case-insensitive) and drop excluded words.
    const seen = new Set<string>();
    const lemmas: string[] = [];
    for (const raw of proposed) {
      const lemma = raw.trim().toLowerCase();
      if (!lemma || seen.has(lemma) || excluded.has(lemma)) continue;
      seen.add(lemma);
      lemmas.push(lemma);
    }

    // Drop already-introduced words (those with existing scheduling state) so we never re-teach.
    const introduced = await Promise.all(lemmas.map((w) => scheduling.get(input.userId, w)));
    const fresh = lemmas.filter((_, i) => introduced[i] === undefined);

    const candidates: CandidateWord[] = fresh.sort(abc).map((wordId) => ({ wordId, surface: wordId }));

    const result: SuggestionResult = { candidates };
    if (candidates.length < input.count) {
      result.shortfall = { requested: input.count, available: candidates.length, reason: 'exhausted' };
    }
    return result;
  }

  return { suggest, normalizeSelection };
}
