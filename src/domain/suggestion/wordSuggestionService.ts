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

import type { ContentGateway, SchedulingRepository, SuggestionCacheRepository } from '../../types/ports';
import { masteryProjector } from '../srs/masteryProjector';
import { isDueForReview } from '../srs/dueState';
import { startOfLocalDay } from '../srs/dayBoundary';
import { DAILY_NEW_WORD_LIMIT, DAY_MS } from '../srs/parameters';
import type { CandidateReason, CandidateWord, Cefr, SuggestionInput, SuggestionResult, WordSchedulingState } from '../../types/domain';

/** How long a cached suggestion-LLM proposal pool stays fresh before a background refetch (E-3(c)). */
export const SUGGESTION_PROPOSAL_TTL_MS = DAY_MS;

export interface WordSuggestionService {
  suggest(input: SuggestionInput, scheduling: SchedulingRepository): Promise<SuggestionResult>;
  /** Re-apply ABC order + case-insensitive dedupe to an edited selection (Requirement 5.4). */
  normalizeSelection(wordIds: string[]): string[];
}

export interface WordSuggestionServiceOptions {
  /** External CEFR band lookup for legacy scheduling rows that do not yet store `level`. */
  cefrOf?: (wordId: string) => Cefr | undefined;
  /**
   * Shared cache for suggestion-LLM proposal pools (E-3(c)). When supplied, the new-word proposals
   * for a `${level}|${intent}` key are reused across the setup preview and generation-time
   * auto-selection so the suggestion LLM is hit at most once per TTL. Absent ⇒ every call fetches (the
   * pre-cache behaviour, kept for lightweight fakes/tests).
   */
  proposalCache?: SuggestionCacheRepository;
}

/** Case-insensitive ABC comparator (LLM lemmas are lowercase; user additions may not be). */
const abc = (a: string, b: string): number => a.toLowerCase().localeCompare(b.toLowerCase());
const abcCandidate = (a: CandidateWord, b: CandidateWord): number => abc(a.wordId, b.wordId);
const CEFR_RANK: Record<Cefr, number> = { A2: 0, B1: 1, B2: 2, C1: 3, C2: 4 };

/**
 * Resolve the review/new slot split (A-1-3). Prefers the explicit `plan`; falls back — for one
 * release — to the legacy `desiredNewCount`, which was a *total* cap filled review-first, so it
 * maps onto `reviewSlots = total, newSlots = 0` (the review→new spill below then fills any gap).
 */
function resolvePlan(input: SuggestionInput): { reviewSlots: number; newSlots: number } {
  if (input.plan) {
    return {
      reviewSlots: Math.max(0, Math.round(input.plan.reviewSlots)),
      newSlots: Math.max(0, Math.round(input.plan.newSlots)),
    };
  }
  const total = Math.min(input.count, Math.max(0, input.desiredNewCount ?? input.count));
  return { reviewSlots: total, newSlots: 0 };
}

function keyOf(wordId: string): string {
  return wordId.trim().toLowerCase();
}

/**
 * How many of a cached proposal pool are still usable after the live exclusion / already-selected
 * filter. A cache hit only short-circuits the LLM when it can still fill the requested new slots; an
 * insufficient pool (e.g. its words are now excluded) falls through to a fresh fetch (E-3(c)).
 */
function usableProposalCount(proposals: string[], excluded: Set<string>, selected: Map<string, CandidateWord>): number {
  const seen = new Set<string>();
  let usable = 0;
  for (const raw of proposals) {
    const lemma = keyOf(raw);
    if (!lemma || seen.has(lemma) || excluded.has(lemma) || selected.has(lemma)) continue;
    seen.add(lemma);
    usable += 1;
  }
  return usable;
}

function scheduledLevel(state: WordSchedulingState, options: WordSuggestionServiceOptions): Cefr | undefined {
  return state.level ?? options.cefrOf?.(keyOf(state.wordId));
}

/** True when `actual` sits inside the target..target-1 CEFR window (at level or one step easier). */
function bandFits(target: Cefr, actual: Cefr): boolean {
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

/** Best-effort cache read: a cache failure must never break suggestion, so it degrades to a miss. */
async function readProposalCache(
  cache: SuggestionCacheRepository | undefined,
  userId: SuggestionInput['userId'],
  key: string,
): Promise<{ proposals: string[]; updatedAt: string } | undefined> {
  if (!cache) return undefined;
  try {
    return await cache.get(userId, key);
  } catch {
    return undefined;
  }
}

/** Best-effort cache write: failures are swallowed (the fresh proposals were already returned). */
async function writeProposalCache(
  cache: SuggestionCacheRepository | undefined,
  userId: SuggestionInput['userId'],
  key: string,
  entry: { proposals: string[]; updatedAt: string },
): Promise<void> {
  if (!cache) return;
  try {
    await cache.put(userId, key, entry);
  } catch {
    // ignore — caching is a best-effort optimization.
  }
}

export function createWordSuggestionService(
  gateway: ContentGateway,
  options: WordSuggestionServiceOptions = {},
): WordSuggestionService {
  async function suggest(input: SuggestionInput, scheduling: SchedulingRepository): Promise<SuggestionResult> {
    // Two-slot plan (A-1-3): fill `reviewSlots` from due/weak vocabulary and `newSlots` from fresh
    // LLM proposals; a shortfall in either slot spills into the other so `total` is filled whenever
    // material exists (no ratio-0 / candidate-empty passage).
    let { reviewSlots, newSlots } = resolvePlan(input);
    const total = Math.min(input.count, reviewSlots + newSlots);
    if (reviewSlots + newSlots > total) {
      reviewSlots = Math.min(reviewSlots, total);
      newSlots = total - reviewSlots;
    }

    // Daily new-word cap (C-5b): the newWordRatio slider is free, but the number of genuinely NEW
    // words introduced per day is hard-capped at DAILY_NEW_WORD_LIMIT minus today's seeds so a
    // review backlog can't be compounded by fresh vocabulary. The cap bounds BOTH the ratio's
    // newSlots and any review→new spill; the capped-out slots fall back to review words below, so
    // `total` (and the passage length) is preserved and the generation stays review-centered. The
    // cap never reduces review slots. Absent `countSeededSince` ⇒ no cap (lightweight fakes/tests).
    const requestedNewSlots = newSlots;
    // The cap window opens at the learner's LOCAL midnight (shared `startOfLocalDay`, the same rule
    // the dashboard buckets by, F-4) — not UTC midnight — so a non-UTC learner's daily new-word budget
    // resets in step with the dashboard's local day.
    const newWordCap = scheduling.countSeededSince
      ? Math.max(
          0,
          DAILY_NEW_WORD_LIMIT -
            (await scheduling.countSeededSince(input.userId, startOfLocalDay(input.now, input.tzOffsetMinutes))),
        )
      : Number.POSITIVE_INFINITY;
    newSlots = Math.min(newSlots, newWordCap);

    const excluded = new Set(input.excludedWordIds.map(keyOf).filter(Boolean));
    const selected = new Map<string, CandidateWord>();

    // ── Build the ordered review pool (due first, then weak), level-filtered & deduped. ──
    const reviewPool: CandidateWord[] = [];
    const pooled = new Set<string>();
    const pushReview = (state: WordSchedulingState, reason: CandidateReason): void => {
      const key = keyOf(state.wordId);
      if (!key || excluded.has(key) || pooled.has(key)) return;
      // C-5d: a word the learner declared known (「もう覚えた」) never re-surfaces as a re-weaving
      // candidate, whether it arrived via the due or the low-stability pool.
      if (state.suspended) return;
      // A-1-2/A-1-3 combo: a freshly-seeded word (New, never reviewed) whose `dueAt` has NOT yet
      // elapsed must not occupy a review slot. Per design decision D1 the re-weaving criterion is
      // "dueAt elapsed" (not stability), so once its dueAt passes it legitimately re-surfaces here
      // even while stability is still undefined; `lowStability` already skips undefined-stability
      // rows, so this guard only fends off a not-yet-due seed sneaking in.
      if (state.stability === undefined && state.reps === 0 && state.dueAt > input.now) return;
      const level = scheduledLevel(state, options);
      // Band filter (C-5b / issue 8): never SILENTLY drop a re-weaving scheduled word for its band.
      // A due word (isDueForReview) bypasses the filter entirely — the core loop re-encounters it in
      // context regardless of level — and an unknown-level word is kept too; only a not-yet-due word
      // whose KNOWN band sits outside the target..target-1 window is held back.
      if (level !== undefined && !isDueForReview(state, input.now) && !bandFits(input.level, level)) return;
      pooled.add(key);
      reviewPool.push({
        wordId: state.wordId,
        surface: state.wordId,
        level,
        reason,
        stage: masteryProjector.deriveMastery(state, { kind: 'none' }),
      });
    };

    const [due, weak] = await Promise.all([
      scheduling.dueBefore(input.userId, input.now),
      scheduling.lowStability(input.userId, Math.max(1, total) * 3),
    ]);
    for (const state of due) pushReview(state, 'due');
    for (const state of weak) pushReview(state, 'weak');

    // ── Fill the review slots; the unfilled remainder spills into the new budget. ──
    const reviewTaken = reviewPool.slice(0, reviewSlots);
    for (const candidate of reviewTaken) selected.set(keyOf(candidate.wordId), candidate);
    const reviewShortfall = reviewSlots - reviewTaken.length;
    // Review→new spill is itself bounded by the daily new-word cap, so a review shortfall can never
    // introduce more new words than the day's budget allows.
    const newWanted = Math.min(newSlots + reviewShortfall, newWordCap);

    // ── Fill the new slots from the LLM, up to the (spill-adjusted) new budget. ──
    // Cache-first (E-3(c)): the raw LLM proposal pool for a `${level}|${intent}` key is shared between
    // the setup preview and generation-time auto-selection. The SRS merge above stays live, so only
    // the expensive, slowly-changing proposal set is cached; a fresh (<TTL) pool that still has enough
    // usable words after the live exclusion filter serves the LLM without a network call. A changed
    // exclusion list is honoured immediately at merge time — the invalidation is behavioural, not
    // key-based — and a pool that no longer has enough usable words falls through to a refetch.
    const proposalKey = `${input.level}|${input.intent}`;
    let gatewayUnavailable = false;
    let proposed: string[] = [];
    if (newWanted > 0) {
      const cached = await readProposalCache(options.proposalCache, input.userId, proposalKey);
      const fresh =
        !input.refresh && cached !== undefined && input.now - Date.parse(cached.updatedAt) < SUGGESTION_PROPOSAL_TTL_MS;
      if (fresh && usableProposalCount(cached!.proposals, excluded, selected) >= newWanted) {
        proposed = cached!.proposals;
      } else if (gateway.suggestWords) {
        try {
          proposed = await gateway.suggestWords({
            level: input.level,
            intent: input.intent,
            count: newWanted,
            exclude: [...excluded, ...selected.keys()],
          });
          await writeProposalCache(options.proposalCache, input.userId, proposalKey, {
            proposals: proposed,
            updatedAt: new Date(input.now).toISOString(),
          });
        } catch {
          // stale-if-error: reuse whatever pool we have (even past TTL) before declaring the gateway
          // down, so a transient outage doesn't blank the review-supplemented candidate list.
          if (cached !== undefined) {
            proposed = cached.proposals;
          } else {
            proposed = [];
            gatewayUnavailable = true;
          }
        }
      } else if (cached !== undefined) {
        // No live suggestion gateway, but a cached pool exists — serve it.
        proposed = cached.proposals;
      } else {
        gatewayUnavailable = true;
      }
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
    let newFilled = 0;
    for (let i = 0; i < lemmas.length && newFilled < newWanted; i += 1) {
      if (introduced[i] !== undefined) continue;
      const wordId = lemmas[i]!;
      selected.set(wordId, { wordId, surface: wordId, level: input.level, reason: 'new' });
      newFilled += 1;
    }

    // ── Any budget left unfilled by new words — whether from a proposal shortfall OR the daily
    // new-word cap — spills back into extra review words (up to `total`), keeping the passage
    // review-centered rather than short. ──
    for (const candidate of reviewPool.slice(reviewSlots)) {
      if (selected.size >= total) break;
      const key = keyOf(candidate.wordId);
      if (selected.has(key)) continue;
      selected.set(key, candidate);
    }

    const candidates = [...selected.values()].sort(abcCandidate);
    const result: SuggestionResult = { candidates };
    // Surface the daily cap only when it actually reduced the new-word slots the ratio asked for
    // (`remaining` 0 ⇒ exhausted → review-only passage). The UI turns this into a notice.
    if (newWordCap < requestedNewSlots) {
      result.newWordClamp = { remaining: newWordCap };
    }
    if (candidates.length < total) {
      result.shortfall = {
        requested: total,
        available: candidates.length,
        reason: gatewayUnavailable ? 'gateway_unavailable' : 'exhausted',
      };
    }
    return result;
  }

  return { suggest, normalizeSelection };
}
