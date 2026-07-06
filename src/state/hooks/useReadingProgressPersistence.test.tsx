// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useReadingProgressPersistence } from './useReadingProgressPersistence';
import { createSessionStore, type SessionStore } from '../stores/sessionStore';
import { tokenizer } from '../../domain/tokenizer/joinService';
import type { ProgressRepository } from '../../types/ports';
import type { IndexedPassage, PassageOutput, UserId } from '../../types/domain';

const U = 'u1' as UserId;

function indexedPassage(): IndexedPassage {
  const source: PassageOutput = {
    meta: { title: 'Story', intent: 'travel', level: 'B1', newCount: 0, reviewCount: 0, approxWords: 10 },
    sentences: Array.from({ length: 5 }, (_, i) => ({ tokens: ['Sentence', String(i), '.'], translationJa: '' })),
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [],
  };
  return tokenizer.index('p1', source);
}

function fakeProgress(): { repo: ProgressRepository; upsert: ReturnType<typeof vi.fn> } {
  const upsert = vi.fn().mockResolvedValue(undefined);
  const repo = {
    upsert,
    get: vi.fn().mockResolvedValue(undefined),
    byStatus: vi.fn().mockResolvedValue([]),
  } as unknown as ProgressRepository;
  return { repo, upsert };
}

function Harness({ session, repo, debounceMs }: { session: SessionStore; repo: ProgressRepository; debounceMs?: number }) {
  useReadingProgressPersistence(session, repo, U, { debounceMs });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

describe('useReadingProgressPersistence', () => {
  it('debounces position writes and persists the latest snapshot after the window', () => {
    const session = createSessionStore();
    const { repo, upsert } = fakeProgress();
    session.getState().startPassage(indexedPassage(), 1_000);
    render(<Harness session={session} repo={repo} debounceMs={3_000} />);

    act(() => session.getState().updateProgress(2));
    expect(upsert).not.toHaveBeenCalled(); // still within the debounce window

    act(() => vi.advanceTimersByTime(3_000));
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ passageId: 'p1', sentenceIndex: 2, lastOpenedAt: 1_000 }),
    );
  });

  it('coalesces rapid scrolls into one write', () => {
    const session = createSessionStore();
    const { repo, upsert } = fakeProgress();
    session.getState().startPassage(indexedPassage(), 1_000);
    render(<Harness session={session} repo={repo} debounceMs={3_000} />);

    act(() => {
      session.getState().updateProgress(1);
      session.getState().updateProgress(2);
      session.getState().updateProgress(3);
    });
    act(() => vi.advanceTimersByTime(3_000));
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ sentenceIndex: 3 }));
  });

  it('flushes immediately when the tab is hidden (visibilitychange)', () => {
    const session = createSessionStore();
    const { repo, upsert } = fakeProgress();
    session.getState().startPassage(indexedPassage(), 1_000);
    render(<Harness session={session} repo={repo} debounceMs={3_000} />);

    act(() => session.getState().updateProgress(4));
    expect(upsert).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(upsert).toHaveBeenCalledTimes(1); // written before the debounce timer elapsed
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ sentenceIndex: 4 }));
  });

  it('flushes on pagehide (tab close)', () => {
    const session = createSessionStore();
    const { repo, upsert } = fakeProgress();
    session.getState().startPassage(indexedPassage(), 1_000);
    render(<Harness session={session} repo={repo} debounceMs={3_000} />);

    act(() => session.getState().updateProgress(2));
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('flushes the pending write on unmount', () => {
    const session = createSessionStore();
    const { repo, upsert } = fakeProgress();
    session.getState().startPassage(indexedPassage(), 1_000);
    const { unmount } = render(<Harness session={session} repo={repo} debounceMs={3_000} />);

    act(() => session.getState().updateProgress(2));
    act(() => unmount());
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('does not write when there is no active passage', () => {
    const session = createSessionStore();
    const { repo, upsert } = fakeProgress();
    render(<Harness session={session} repo={repo} debounceMs={3_000} />);

    act(() => session.getState().updateProgress(1)); // no passage → toReadingProgress is null
    act(() => vi.advanceTimersByTime(3_000));
    expect(upsert).not.toHaveBeenCalled();
  });
});
