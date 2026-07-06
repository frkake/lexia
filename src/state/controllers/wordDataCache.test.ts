import { describe, it, expect, vi } from 'vitest';
import { liftWordData, loadAndCacheWordData, wordDataNeedsRefresh, type WordDataCacheDeps } from './wordDataCache';
import type { CachedWordData, WordCacheMeta, WordCacheRepository } from '../../types/ports';
import type { UserId, WordData } from '../../types/domain';

const USER = 'u1' as UserId;

/** A stored cache row as the Dexie table holds it: WordData + cache metadata + namespacing userId. */
type StoredRow = CachedWordData & { userId: UserId };

/** Word data that satisfies the current contract (memory tips + Japanese synonym nuance, no etymology). */
function goodWord(wordId = 'resilient'): WordData {
  return {
    wordId,
    headword: wordId,
    ipa: '',
    pos: ['adj'],
    register: 'neutral',
    connotation: '肯定的',
    frequency: 3,
    memoryTips: [{ kind: 'image', tipJa: '跳ね返るイメージで覚える。' }],
    core: { meaningsJa: ['回復力のある'], examples: [], collocations: [], synonymNuances: ['agreement より粘り強さの含み。'] },
  };
}

/** Word data that falls short of the contract (no memory tips) — should be flagged enrichmentPending. */
function unmetWord(wordId = 'resilient'): WordData {
  const w = goodWord(wordId);
  delete w.memoryTips;
  return w;
}

/** In-memory WordCacheRepository that records every put (with metadata). */
function fakeRepo(seed?: StoredRow[]): WordCacheRepository & { puts: StoredRow[] } {
  const store = new Map<string, StoredRow>();
  const puts: StoredRow[] = [];
  for (const row of seed ?? []) store.set(`${row.userId}|${row.wordId}`, row);
  return {
    puts,
    async get(userId: UserId, wordId: string) {
      return store.get(`${userId}|${wordId}`);
    },
    async put(userId: UserId, data: WordData, meta?: WordCacheMeta) {
      const rec: StoredRow = { ...data, userId };
      if (meta?.schemaVersion !== undefined) rec.schemaVersion = meta.schemaVersion;
      if (meta?.enrichmentPending !== undefined) rec.enrichmentPending = meta.enrichmentPending;
      store.set(`${userId}|${data.wordId}`, rec);
      puts.push(rec);
    },
    async all(userId: UserId) {
      return [...store.values()].filter((r) => r.userId === userId);
    },
  };
}

function seedRow(data: WordData, meta?: WordCacheMeta): StoredRow {
  return { ...data, userId: USER, ...(meta ?? {}) };
}

function makeDeps(repo: WordCacheRepository, getWordData: (wordId: string) => Promise<WordData>): WordDataCacheDeps {
  return { userId: USER, repos: { wordCache: repo }, content: { getWordData } };
}

/** Drain pending microtasks so fire-and-forget background enrichment settles. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('wordDataNeedsRefresh', () => {
  it('passes contract-complete data and flags missing memory tips / English nuance', () => {
    expect(wordDataNeedsRefresh(goodWord())).toBe(false);
    expect(wordDataNeedsRefresh(unmetWord())).toBe(true);
    const englishNuance = { ...goodWord(), core: { ...goodWord().core, synonymNuances: ['more formal than X'] } };
    expect(wordDataNeedsRefresh(englishNuance)).toBe(true);
  });
});

describe('loadAndCacheWordData — cache-first (E-3(a))', () => {
  it('returns a current-version contract-complete cache hit without any gateway request', async () => {
    const repo = fakeRepo([seedRow(goodWord(), { schemaVersion: 2 })]);
    const getWordData = vi.fn(async () => goodWord());
    const data = await loadAndCacheWordData(makeDeps(repo, getWordData), 'resilient');
    await flush();
    expect(data.headword).toBe('resilient');
    expect(getWordData).toHaveBeenCalledTimes(0); // acceptance (a.1): 0 /api/words requests on re-open
    expect(repo.puts).toHaveLength(0);
  });

  it('re-enriches a schemaVersion-less legacy row (read as v1, below the current version)', async () => {
    const repo = fakeRepo([seedRow(goodWord())]); // no schemaVersion ⇒ treated as v1 < current (2)
    const getWordData = vi.fn(async () => goodWord());
    const data = await loadAndCacheWordData(makeDeps(repo, getWordData), 'resilient');
    expect(data.headword).toBe('resilient'); // shown from cache immediately
    await flush();
    expect(getWordData).toHaveBeenCalledTimes(1); // v1 < 2 ⇒ background lift + refresh
  });

  it('strips cache-only fields (userId / version metadata) from the returned WordData', async () => {
    const repo = fakeRepo([seedRow(goodWord(), { schemaVersion: 1, enrichmentPending: false })]);
    const data = await loadAndCacheWordData(makeDeps(repo, vi.fn(async () => goodWord())), 'resilient');
    expect('userId' in data).toBe(false);
    expect('schemaVersion' in data).toBe(false);
    expect('enrichmentPending' in data).toBe(false);
  });

  it('fetches and persists a cold-cache word, stamping the current schema version', async () => {
    const repo = fakeRepo();
    const getWordData = vi.fn(async () => goodWord());
    const data = await loadAndCacheWordData(makeDeps(repo, getWordData), 'resilient');
    await flush();
    expect(data.headword).toBe('resilient');
    expect(getWordData).toHaveBeenCalledTimes(1);
    expect(repo.puts).toHaveLength(1);
    expect(repo.puts[0]!.schemaVersion).toBe(2);
    expect(repo.puts[0]!.enrichmentPending).toBeUndefined();
  });
});

describe('loadAndCacheWordData — permanent cache-miss loop fixed (E-3(b))', () => {
  it('persists contract-incomplete data with enrichmentPending so it is not regenerated on every open', async () => {
    const repo = fakeRepo();
    const getWordData = vi.fn(async () => unmetWord());
    await loadAndCacheWordData(makeDeps(repo, getWordData), 'resilient');
    await flush();
    expect(repo.puts).toHaveLength(1);
    expect(repo.puts[0]!.enrichmentPending).toBe(true);
    expect(repo.puts[0]!.schemaVersion).toBe(2);
  });

  it('shows an enrichmentPending hit instantly and re-enriches in the background, clearing the flag', async () => {
    const repo = fakeRepo([seedRow(unmetWord(), { schemaVersion: 1, enrichmentPending: true })]);
    const getWordData = vi.fn(async () => goodWord()); // background fetch now returns complete data
    const data = await loadAndCacheWordData(makeDeps(repo, getWordData), 'resilient');
    // The returned card is the stale cached row (no memory tips) — the fresh fetch is not awaited
    // on the hot path, so the tap never blocks on the network.
    expect(data.memoryTips).toBeUndefined();
    await flush();
    // Background re-enrichment fetched once and re-put complete data with the flag cleared.
    expect(getWordData).toHaveBeenCalledTimes(1);
    const stored = await repo.get(USER, 'resilient');
    expect(stored?.memoryTips).toBeDefined();
    expect(stored?.enrichmentPending).toBeUndefined();
  });

  it('keeps showing the cached value when the background refresh fails (stale-if-error)', async () => {
    const repo = fakeRepo([seedRow(unmetWord(), { schemaVersion: 1, enrichmentPending: true })]);
    const getWordData = vi.fn(async () => {
      throw new Error('offline');
    });
    const data = await loadAndCacheWordData(makeDeps(repo, getWordData), 'resilient');
    await flush();
    expect(data.headword).toBe('resilient'); // returned without throwing
    expect(getWordData).toHaveBeenCalledTimes(1); // background attempt made, error swallowed
  });

  it('propagates the error only when the cache is cold and the gateway fails', async () => {
    const repo = fakeRepo();
    const getWordData = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(loadAndCacheWordData(makeDeps(repo, getWordData), 'resilient')).rejects.toThrow('offline');
  });
});

describe('loadAndCacheWordData — schemaVersion boundary (design decision D2)', () => {
  it('at the current version, a matching row is not re-enriched', async () => {
    const repo = fakeRepo([seedRow(goodWord(), { schemaVersion: 2 })]);
    const getWordData = vi.fn(async () => goodWord());
    await loadAndCacheWordData(makeDeps(repo, getWordData), 'resilient', 2);
    await flush();
    expect(getWordData).toHaveBeenCalledTimes(0);
  });

  it('below the target version, a v1 row displays immediately then re-enriches and is re-stamped', async () => {
    // Simulates a future C-1/2/3 bump: the loader targets version 2, the cached row is v1.
    const repo = fakeRepo([seedRow({ ...goodWord(), headword: 'old-form' }, { schemaVersion: 1 })]);
    const getWordData = vi.fn(async () => goodWord());
    const data = await loadAndCacheWordData(makeDeps(repo, getWordData), 'resilient', 2);
    expect(data.headword).toBe('old-form'); // shown from the v1 cache immediately, not the fresh fetch
    await flush();
    expect(getWordData).toHaveBeenCalledTimes(1); // background re-enrichment
    const stored = await repo.get(USER, 'resilient');
    expect(stored?.schemaVersion).toBe(2); // re-stamped to the current version
    expect(stored?.headword).toBe('resilient'); // replaced with the freshly fetched form
  });

  it('treats a schemaVersion-less row as v1 for the boundary check', async () => {
    const repo = fakeRepo([seedRow(goodWord())]); // undefined ⇒ v1
    const getWordData = vi.fn(async () => goodWord());
    await loadAndCacheWordData(makeDeps(repo, getWordData), 'resilient', 2);
    await flush();
    expect(getWordData).toHaveBeenCalledTimes(1); // v1 < 2 ⇒ background refresh
    expect((await repo.get(USER, 'resilient'))?.schemaVersion).toBe(2);
  });
});

describe('liftWordData — v1 → v2 structuring (C-1/2/3)', () => {
  it('is identity at or above the current version', () => {
    const w = goodWord();
    expect(liftWordData(w, 2)).toBe(w);
  });

  it('structures a legacy v1 row (string collocations/idioms + prefix/root etymology)', () => {
    const legacy = {
      ...goodWord(),
      core: { ...goodWord().core, collocations: ['remain resilient'] },
      more: { idioms: ['bounce back'], etymology: { root: 'salire', noteJa: '跳ね返る → 回復力' } },
    } as unknown as WordData;
    const lifted = liftWordData(legacy, 1);
    expect(lifted.core.collocations).toEqual([
      { id: 'remain-resilient', pattern: 'remain resilient', type: 'other', slotExamples: [], glossJa: '', l1Contrast: false },
    ]);
    expect(lifted.more?.idioms).toEqual([{ expression: 'bounce back', meaningJa: '', originJa: '' }]);
    expect(lifted.more?.etymology?.bridgeJa).toBe('跳ね返る → 回復力');
  });

  it('returns a legacy v1 cache hit already structured through loadAndCacheWordData', async () => {
    const legacyRow = seedRow(
      { ...goodWord(), core: { ...goodWord().core, collocations: ['remain resilient'] } } as unknown as WordData,
      { schemaVersion: 1 },
    );
    const repo = fakeRepo([legacyRow]);
    const data = await loadAndCacheWordData(makeDeps(repo, vi.fn(async () => goodWord())), 'resilient', 2);
    expect(data.core.collocations[0]).toMatchObject({ id: 'remain-resilient', pattern: 'remain resilient' });
  });
});
