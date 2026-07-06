/**
 * L1 — continuing-chapter vocabulary aggregation (A-1-4). A long-story「続きを生成」reused the first
 * chapter's woven words on every chapter, so the learner never met new vocabulary as the story
 * advanced. Each chapter now re-selects its words at generation time; to keep the selection fresh,
 * the words already introduced in earlier chapters are fed to the suggestion service as exclusions —
 * EXCEPT words that are currently review-due, which we deliberately let reappear (spaced repetition
 * across chapters is desirable). Pure so the aggregate/filter rule is unit-testable away from the
 * route wiring (risk R1: keep routes.tsx thin).
 */

import type { PassageOutput, WordSchedulingState } from '../../types/domain';
import { isDueForReview } from '../srs/dueState';

/** Minimal shape needed from a stored chapter: its woven target-span word ids. */
export interface ChapterVocabularySource {
  passage: Pick<PassageOutput, 'targetSpans'>;
}

/** Case-insensitive key so 'Ancient' and 'ancient' collapse to one word (matches mergeWordIds). */
function keyOf(wordId: string): string {
  return wordId.trim().toLowerCase();
}

/** Every unique target-span wordId already woven into `chapters`, in first-seen order. */
export function collectChapterTargetWordIds(chapters: readonly ChapterVocabularySource[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const chapter of chapters) {
    for (const span of chapter.passage.targetSpans) {
      const key = keyOf(span.wordId);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      ids.push(span.wordId);
    }
  }
  return ids;
}

/**
 * Words to keep OUT of the next chapter's auto-selection (A-1-4): every word already woven into an
 * earlier chapter, MINUS words that are review-due now (`isDueForReview`). A review-due word is
 * dropped from the avoid set so the suggestion service may re-weave it (its scheduling state pulls it
 * into the review pool); a freshly-introduced New word — no scheduling state, or seeded-but-not-yet-
 * due — stays avoided so the next chapter teaches genuinely new vocabulary.
 *
 * `chapterWordIds` is the pre-collected list (see `collectChapterTargetWordIds`); `schedulingByWordId`
 * is keyed case-insensitively and need only contain the currently-due words (a missing entry is
 * treated as「not due」→ avoided).
 */
export function avoidWordIdsForNextChapter(
  chapterWordIds: readonly string[],
  schedulingByWordId: ReadonlyMap<string, WordSchedulingState>,
  now: number,
): string[] {
  return chapterWordIds.filter((wordId) => {
    const state = schedulingByWordId.get(keyOf(wordId));
    return !(state && isDueForReview(state, now));
  });
}
