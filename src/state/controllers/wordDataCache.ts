/**
 * L3 — word-data cache-first loader (E-3(a)(a')(b), design decision D2).
 *
 * The single read path for a word's dictionary card. WordData is user-independent, immutable
 * content, so a stored row is returned instantly (works after a reload and offline / stale-if-error)
 * and the network is used only to fill a cold cache or to quietly re-enrich a row that predates the
 * current contract version or fell short of it. Every fetched row is persisted — the old "only cache
 * a row that already meets the contract" rule caused a permanent cache-miss loop where a word whose
 * LLM response was incomplete was regenerated on every open.
 */

import type { ContentGateway, WordCacheRepository } from '../../types/ports';
import type { UserId, WordData } from '../../types/domain';
import { WORD_DATA_SCHEMA_VERSION } from '../../infra/persistence/lexiaDb';
import { structuredWordData } from '../../domain/wordData/structuredWordData';

/** The slice of the container this loader needs (Container satisfies it structurally). */
export interface WordDataCacheDeps {
  userId: UserId;
  content: Pick<ContentGateway, 'getWordData'>;
  repos: { wordCache: WordCacheRepository };
}

function hasJapanese(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(text);
}

/**
 * Word-data contract freshness gate: memory tips exist, etymology composes into a bridgeJa, and
 * synonym nuance is written in Japanese. A row that fails this still displays, but is flagged
 * `enrichmentPending` so it is refreshed in the background instead of blocking the next open.
 */
export function wordDataNeedsRefresh(data: WordData): boolean {
  if (!data.memoryTips || data.memoryTips.length === 0) return true;
  if (data.more?.etymology && !data.more.etymology.bridgeJa) return true;
  return data.core.synonymNuances.some((note) => note.trim() && !hasJapanese(note));
}

/** Strip the cache-only fields (namespacing userId + version metadata) back to bare WordData. */
function toWordData(record: WordData): WordData {
  const copy = { ...record } as WordData & { userId?: unknown; schemaVersion?: unknown; enrichmentPending?: unknown };
  delete copy.userId;
  delete copy.schemaVersion;
  delete copy.enrichmentPending;
  return copy;
}

/**
 * Lift a row written under an older contract version up to the current one so it renders before the
 * background re-enrichment lands. v1 → v2 (C-1/2/3) structures the legacy collocations/idioms/
 * etymology/semanticNetwork so the card reads them the same as fresh data (the new-only fields stay
 * blank until re-enrichment fills them). `structuredWordData` is idempotent, so already-v2 rows pass
 * through unchanged.
 */
export function liftWordData(data: WordData, fromVersion: number): WordData {
  return fromVersion < 2 ? structuredWordData(data) : data;
}

/** Persist a fetched row, stamping the current version and flagging incomplete data for refresh. */
async function putWordData(deps: WordDataCacheDeps, data: WordData, targetVersion: number): Promise<void> {
  try {
    await deps.repos.wordCache.put(deps.userId, data, {
      schemaVersion: targetVersion,
      enrichmentPending: wordDataNeedsRefresh(data) ? true : undefined,
    });
  } catch {
    // WordData still powers the current screen; cache persistence is a best-effort fast path.
  }
}

/** Fire-and-forget refresh of a stale/outdated row; failures keep the cached value on screen. */
function enrichWordDataInBackground(deps: WordDataCacheDeps, wordId: string, targetVersion: number): void {
  void (async () => {
    try {
      const fresh = await deps.content.getWordData(wordId);
      await putWordData(deps, fresh, targetVersion);
    } catch {
      // Best-effort background refresh; the cached value already powers the screen.
    }
  })();
}

/**
 * Return a word's dictionary card, cache-first. On a cache hit the stored row is returned
 * immediately (no network on the hot path) and refreshed in the background only when it is below the
 * target contract version, was flagged `enrichmentPending`, or fails the freshness gate. On a cold
 * cache the row is fetched and persisted. `targetVersion` is injectable so a version bump can be
 * exercised in tests.
 */
export async function loadAndCacheWordData(
  deps: WordDataCacheDeps,
  wordId: string,
  targetVersion: number = WORD_DATA_SCHEMA_VERSION,
): Promise<WordData> {
  const cached = await deps.repos.wordCache.get(deps.userId, wordId);
  if (cached) {
    const version = cached.schemaVersion ?? 1;
    const data = liftWordData(toWordData(cached), version);
    if (version < targetVersion || cached.enrichmentPending || wordDataNeedsRefresh(data)) {
      enrichWordDataInBackground(deps, wordId, targetVersion);
    }
    return data;
  }
  const data = await deps.content.getWordData(wordId);
  await putWordData(deps, data, targetVersion);
  return data;
}
