/**
 * L3 — contentQueries: TanStack Query hooks for the adjacent Content capability
 * (design.md "QueryHooks", 3.1/8.1). `useGeneratePassage` wires the
 * GenerationOrchestrator and `useWordData` the ContentGateway, getting caching,
 * request de-duplication (by query key), retry and SWR for free. The query functions
 * and key factory are exported pure so the wiring is testable without React; failures
 * are thrown so TanStack Query can retry / surface them.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { GenerationOrchestrator } from '../../domain/generation/generationOrchestrator';
import type { ContentGateway } from '../../types/ports';
import type { GenerationRequest, IndexedPassage, WordData } from '../../types/domain';

const STALE_WORD_MS = 5 * 60_000;

/** Deterministic key for a generation request (identical requests de-duplicate). */
function requestKey(req: GenerationRequest): string {
  return JSON.stringify({
    level: req.level,
    themes: req.themes,
    newWordRatio: req.newWordRatio,
    length: req.length,
    words: req.targetWords.map((w) => w.wordId).slice().sort(),
  });
}

export const contentKeys = {
  word: (wordId: string) => ['content', 'word', wordId] as const,
  passage: (req: GenerationRequest) => ['content', 'passage', requestKey(req)] as const,
};

/** Fetch adjacent word data (rejects with the gateway's typed error on failure). */
export function fetchWordData(gateway: ContentGateway, wordId: string): Promise<WordData> {
  return gateway.getWordData(wordId);
}

/** Run the generate→validate→repair pipeline, throwing the error so retry can fire. */
export async function generatePassageQuery(
  orchestrator: GenerationOrchestrator,
  req: GenerationRequest,
): Promise<IndexedPassage> {
  const result = await orchestrator.generate(req);
  if (result.ok) return result.value;
  throw result.error;
}

export function useWordData(gateway: ContentGateway, wordId: string | null): UseQueryResult<WordData> {
  return useQuery({
    queryKey: contentKeys.word(wordId ?? ''),
    queryFn: () => fetchWordData(gateway, wordId!),
    enabled: !!wordId,
    staleTime: STALE_WORD_MS,
  });
}

export interface UseGeneratePassageOptions {
  enabled?: boolean;
}

export function useGeneratePassage(
  orchestrator: GenerationOrchestrator,
  req: GenerationRequest,
  options: UseGeneratePassageOptions = {},
): UseQueryResult<IndexedPassage> {
  return useQuery({
    queryKey: contentKeys.passage(req),
    queryFn: () => generatePassageQuery(orchestrator, req),
    enabled: options.enabled ?? false, // generation is explicit (gated by the Setup action)
    retry: 2,
    staleTime: Infinity, // a generated passage is stable; don't refetch it
  });
}
