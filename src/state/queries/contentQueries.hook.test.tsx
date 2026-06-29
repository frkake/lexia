// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useWordData, useGeneratePassage } from './contentQueries';
import { ok, err } from '../../types/result';
import { tokenizer } from '../../domain/tokenizer/joinService';
import type { GenerationOrchestrator } from '../../domain/generation/generationOrchestrator';
import type { ContentGateway } from '../../types/ports';
import type { GenerationRequest, IndexedPassage, WordData } from '../../types/domain';

const word: WordData = {
  wordId: 'w1',
  headword: 'resilient',
  ipa: '',
  pos: ['adj'],
  register: 'neutral',
  connotation: 'positive',
  frequency: 3,
  core: { meaningsJa: ['回復力のある'], examples: [], collocations: [], synonymNuances: [] },
};

const req: GenerationRequest = {
  level: 'B1',
  themes: ['travel'],
  newWordRatio: 0.3,
  length: 'short',
  targetWords: [{ wordId: 'w1', surface: 'resilient', masteryDensity: 'new' }],
};

function indexed(): IndexedPassage {
  return tokenizer.index('p1', {
    meta: { title: 't', theme: 'travel', level: 'B1', newCount: 0, reviewCount: 0, approxWords: 2 },
    sentences: [{ tokens: ['Hello', '.'], translationJa: '' }],
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [],
  });
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useWordData', () => {
  it('fetches word data and de-duplicates identical requests via the cache', async () => {
    const getWordData = vi.fn(async () => word);
    const gateway: ContentGateway = { getWordData, generatePassage: vi.fn() };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = makeWrapper(client);

    const first = renderHook(() => useWordData(gateway, 'w1'), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(first.result.current.data?.headword).toBe('resilient');

    // A second consumer of the same key reads from cache — no extra fetch.
    const second = renderHook(() => useWordData(gateway, 'w1'), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(getWordData).toHaveBeenCalledTimes(1);
  });
});

describe('useGeneratePassage', () => {
  it('retries a failed generation and then resolves with the passage', async () => {
    let attempts = 0;
    const generate = vi.fn(async () => {
      attempts += 1;
      return attempts < 2 ? err({ kind: 'refusal' as const }) : ok(indexed());
    });
    const orchestrator: GenerationOrchestrator = { generate };
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
    const wrapper = makeWrapper(client);

    const { result } = renderHook(() => useGeneratePassage(orchestrator, req, { enabled: true }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 3_000 });
    expect(result.current.data?.passageId).toBe('p1');
    expect(generate).toHaveBeenCalledTimes(2); // one retry after the refusal
  });
});
