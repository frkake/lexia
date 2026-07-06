/**
 * L1 — target-word resolution (A-1-1). Pure merge logic split out of the HomeRoute so the
 * "manual words + auto-selected words" combine rule is unit-testable and the route wiring stays a
 * thin async shell (risk R1: keep the routes.tsx conflict surface small).
 *
 * Semantics after the prefill removal: `targetWordIds` on a SetupConfig means the learner's MANUAL
 * additions only. Auto-selected words are resolved at generation time and never persisted. These
 * helpers own how the two lists combine into the final woven-in set.
 */

/** Case-insensitive union that preserves the first-seen spelling and the input order. */
export function mergeWordIds(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const group of groups) {
    for (const raw of group) {
      const word = raw.trim();
      const key = word.toLowerCase();
      if (!word || seen.has(key)) continue;
      seen.add(key);
      merged.push(word);
    }
  }
  return merged;
}

/**
 * Combine the learner's manual words with the auto-suggested backfill into the final target list.
 * Manual words always come first and are never dropped (even beyond `plan`); suggested words then
 * fill the remaining slots up to `plan`. `plan` is the `targetWordPlanFor` total (A-1-3).
 */
export function resolveTargetWordSelection(manual: string[], suggested: string[], plan: number): string[] {
  const manualIds = mergeWordIds(manual);
  const merged = mergeWordIds(manualIds, suggested);
  return merged.slice(0, Math.max(plan, manualIds.length));
}
