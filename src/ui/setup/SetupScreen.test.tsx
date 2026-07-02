// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SetupScreen, setupMissing, type CandidateWord } from './SetupScreen';
import type { SetupConfig } from '../../types/domain';

const CANDIDATES: CandidateWord[] = [
  { wordId: 'mitigate', surface: 'mitigate' },
  { wordId: 'concede', surface: 'concede' },
  { wordId: 'candid', surface: 'candid' },
];

function renderScreen(props: Parameters<typeof SetupScreen>[0] = {}) {
  return render(<SetupScreen {...props} />);
}

describe('setupMissing()', () => {
  it('reports nothing missing once an exam target is provided (target words optional)', () => {
    expect(setupMissing({ kind: 'eiken', value: '準1' }, [])).toEqual([]);
  });

  it('reports the level as missing when no exam target is chosen', () => {
    const missing = setupMissing(undefined, []);
    expect(missing).toContain('レベル');
    expect(missing.some((m) => m.includes('対象単語'))).toBe(false);
  });
});

describe('<SetupScreen/> (overhauled: intent / exam / word target / content type)', () => {
  it('replaces theme tags with a single-select learning intent (8.1/8.2)', () => {
    const { getByTestId, queryByTestId } = renderScreen({ candidates: CANDIDATES });
    // Old fine-grained theme tag UI is gone.
    expect(queryByTestId('theme-交渉')).toBeNull();
    // Learning intents are offered.
    expect(getByTestId('intent-business')).toBeTruthy();
    expect(getByTestId('intent-daily')).toBeTruthy();
    expect(getByTestId('intent-toeic')).toBeTruthy();
  });

  it('offers the exam-based difficulty picker and the content-type selector (9.1/6.1)', () => {
    const { getByTestId } = renderScreen({ candidates: CANDIDATES });
    expect(getByTestId('exam-kind-eiken')).toBeTruthy();
    expect(getByTestId('content-type-article')).toBeTruthy();
    expect(getByTestId('content-type-short_story')).toBeTruthy();
    expect(getByTestId('content-type-long_story')).toBeTruthy();
  });

  it('single-selects the learning intent (only one active at a time, 8.2)', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByTestId, getByText } = renderScreen({ candidates: [], onGenerate });
    fireEvent.click(getByTestId('exam-value-2')); // choose a level so generation is allowed
    fireEvent.click(getByTestId('intent-toeic'));
    fireEvent.click(getByTestId('intent-academic'));
    fireEvent.click(getByText('文章を生成する'));
    expect(onGenerate.mock.calls[0]![0].intent).toBe('academic');
  });

  it('emits a SetupConfig with examTarget / intent / wordTarget / contentType (8/9/7/6)', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByTestId, getByText, getByLabelText } = renderScreen({ candidates: CANDIDATES, onGenerate });

    fireEvent.click(getByTestId('exam-kind-toeic'));
    fireEvent.click(getByTestId('exam-value-800'));
    fireEvent.click(getByTestId('intent-business'));
    fireEvent.change(getByLabelText('新出単語の割合'), { target: { value: '0.5' } });
    fireEvent.change(getByLabelText('文章の長さ'), { target: { value: '700' } });
    fireEvent.click(getByText('文章を生成する'));

    expect(onGenerate).toHaveBeenCalledTimes(1);
    const cfg = onGenerate.mock.calls[0]![0];
    expect(cfg.examTarget).toEqual({ kind: 'toeic', value: '800' });
    expect(cfg.intent).toBe('business');
    expect(cfg.newWordRatio).toBeCloseTo(0.5);
    expect(cfg.wordTarget).toBe(700);
    expect(cfg.contentType).toBe('article');
    expect(cfg.advancedDifficulty).toBeUndefined();
    expect(cfg.targetWordIds).toEqual(['mitigate', 'concede', 'candid']);
    // Legacy fields removed.
    expect((cfg as { themes?: unknown }).themes).toBeUndefined();
    expect((cfg as { length?: unknown }).length).toBeUndefined();
  });

  it('offers advanced overrides for vocabulary level and sentence-structure readability', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByTestId, getByText } = renderScreen({ candidates: [], onGenerate });
    fireEvent.click(getByTestId('exam-value-2'));
    fireEvent.change(getByTestId('advanced-vocabulary-level'), { target: { value: 'C1' } });
    fireEvent.change(getByTestId('advanced-readability-level'), { target: { value: 'easy' } });
    fireEvent.click(getByText('文章を生成する'));
    expect(onGenerate.mock.calls[0]![0].advancedDifficulty).toEqual({
      vocabularyLevel: 'C1',
      readabilityLevel: 'easy',
    });
  });

  it('reveals genre + homage inputs only when a story content type is chosen (6.4)', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByTestId, queryByTestId, getByText, getByLabelText } = renderScreen({
      candidates: [],
      onGenerate,
    });
    fireEvent.click(getByTestId('exam-value-2')); // choose a level so generation is allowed
    // Article: no genre picker.
    expect(queryByTestId('genre-fantasy')).toBeNull();
    fireEvent.click(getByTestId('content-type-short_story'));
    // Story: genre options appear (fantasy / sci-fi / mystery at minimum).
    expect(getByTestId('genre-fantasy')).toBeTruthy();
    expect(getByTestId('genre-sci_fi')).toBeTruthy();
    expect(getByTestId('genre-mystery')).toBeTruthy();
    fireEvent.click(getByTestId('genre-mystery'));
    fireEvent.change(getByLabelText('オマージュ作品（任意）'), { target: { value: 'Sherlock Holmes' } });
    fireEvent.click(getByText('文章を生成する'));
    const cfg = onGenerate.mock.calls[0]![0];
    expect(cfg.contentType).toBe('short_story');
    expect(cfg.storyOptions).toEqual({ genre: 'mystery', homageTitle: 'Sherlock Holmes' });
  });

  it('clamps the emitted word target into the selected story range (7.3)', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByTestId, getByText } = renderScreen({
      candidates: [],
      initial: { examTarget: { kind: 'eiken', value: '2' }, wordTarget: 400, contentType: 'article' },
      onGenerate,
    });
    fireEvent.click(getByTestId('content-type-long_story'));
    fireEvent.click(getByText('文章を生成する'));
    const cfg = onGenerate.mock.calls[0]![0];
    expect(cfg.contentType).toBe('long_story');
    expect(cfg.wordTarget).toBe(800);
  });

  it('excludes a tapped candidate from the target list', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByTestId, getByText } = renderScreen({
      candidates: CANDIDATES,
      initial: { examTarget: { kind: 'eiken', value: '準1' } },
      onGenerate,
    });
    fireEvent.click(getByTestId('target-concede')); // toggle exclude
    fireEvent.click(getByText('文章を生成する'));
    const cfg = onGenerate.mock.calls[0]![0];
    expect(cfg.targetWordIds).toEqual(['mitigate', 'candid']);
    expect(cfg.excludedWordIds).toContain('concede');
  });

  it('seeds selections from the initial config', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByText } = renderScreen({
      candidates: CANDIDATES,
      initial: { examTarget: { kind: 'eiken', value: '1' }, intent: 'travel', wordTarget: 600, contentType: 'article' },
      onGenerate,
    });
    fireEvent.click(getByText('文章を生成する'));
    const cfg = onGenerate.mock.calls[0]![0];
    expect(cfg.examTarget).toEqual({ kind: 'eiken', value: '1' });
    expect(cfg.intent).toBe('travel');
    expect(cfg.wordTarget).toBe(600);
  });

  it('shows generation progress and service errors', () => {
    const { getByRole, getByText } = renderScreen({
      candidates: CANDIDATES,
      generating: true,
      generationError: '生成サービスに接続できませんでした。',
    });
    expect(getByRole('button', { name: '生成しています…' }).getAttribute('aria-busy')).toBe('true');
    expect(getByText('生成サービスに接続できませんでした。')).toBeTruthy();
  });
});
