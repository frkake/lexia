// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
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
  it('reports only the level when no setup choice is made', () => {
    const missing = setupMissing(undefined, []);
    expect(missing).toContain('レベル');
    expect(missing.some((m) => m.includes('対象単語'))).toBe(false);
  });

  it('allows generation without target words once a level is selected', () => {
    expect(setupMissing('B2', [])).toEqual([]);
  });
});

describe('<SetupScreen/>', () => {
  it('lists level options, theme pills and auto-selected candidates (2.1/2.2/2.4)', () => {
    const { getByTestId } = renderScreen({ candidates: CANDIDATES });
    expect(getByTestId('level-B2')).toBeTruthy();
    expect(getByTestId('theme-交渉')).toBeTruthy();
    expect(getByTestId('target-mitigate')).toBeTruthy();
    expect(getByTestId('target-concede')).toBeTruthy();
  });

  it('blocks generation and notifies the missing level when unmet (2.7)', () => {
    const onGenerate = vi.fn();
    const { getByText, getByRole } = renderScreen({ candidates: [], onGenerate });
    fireEvent.click(getByText('文章を生成する'));
    expect(onGenerate).not.toHaveBeenCalled();
    const alert = getByRole('alert');
    expect(alert.textContent).toContain('レベル');
    expect(alert.textContent).not.toContain('対象単語');
  });

  it('emits a valid SetupConfig even when no target words are selected', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByTestId, getByText } = renderScreen({ candidates: [], onGenerate });
    fireEvent.click(getByTestId('level-B1'));
    fireEvent.click(getByText('文章を生成する'));

    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate.mock.calls[0]![0].targetWordIds).toEqual([]);
  });

  it('emits a SetupConfig reflecting the selections when valid (2.3/2.6)', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByTestId, getByText, getByLabelText } = renderScreen({ candidates: CANDIDATES, onGenerate });

    fireEvent.click(getByTestId('level-B2'));
    fireEvent.click(getByTestId('theme-交渉'));
    fireEvent.click(getByTestId('theme-会議'));
    fireEvent.change(getByLabelText('新出単語の割合'), { target: { value: '0.5' } });
    fireEvent.click(getByText('文章を生成する'));

    expect(onGenerate).toHaveBeenCalledTimes(1);
    const cfg = onGenerate.mock.calls[0]![0];
    expect(cfg.level).toBe('B2');
    expect(cfg.themes).toEqual(expect.arrayContaining(['交渉', '会議']));
    expect(cfg.targetWordIds).toEqual(['mitigate', 'concede', 'candid']);
    expect(cfg.newWordRatio).toBeCloseTo(0.5);
    expect(cfg.length).toBe('medium');
  });

  it('excludes a tapped candidate from the target list (2.5)', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByTestId, getByText } = renderScreen({
      candidates: CANDIDATES,
      initial: { level: 'B2' },
      onGenerate,
    });
    fireEvent.click(getByTestId('target-concede')); // toggle exclude
    fireEvent.click(getByText('文章を生成する'));

    const cfg = onGenerate.mock.calls[0]![0];
    expect(cfg.targetWordIds).toEqual(['mitigate', 'candid']);
    expect(cfg.excludedWordIds).toContain('concede');
  });

  it('adds a manually entered word to the target list (2.5)', () => {
    const onGenerate = vi.fn<(s: SetupConfig) => void>();
    const { getByLabelText, getByText } = renderScreen({
      candidates: CANDIDATES,
      initial: { level: 'B2' },
      onGenerate,
    });
    fireEvent.click(getByText('＋ 追加'));
    const input = getByLabelText('追加する単語');
    fireEvent.change(input, { target: { value: 'nuance' } });
    fireEvent.submit(within(getByLabelText('単語を追加するフォーム') as HTMLElement).getByLabelText('追加する単語'));
    fireEvent.click(getByText('文章を生成する'));

    const cfg = onGenerate.mock.calls[0]![0];
    expect(cfg.targetWordIds).toContain('nuance');
  });

  it('shows generation progress and service errors', () => {
    const { getByRole, getByText } = renderScreen({
      candidates: CANDIDATES,
      initial: { level: 'B2' },
      generating: true,
      generationError: '生成サービスに接続できませんでした。',
    });
    expect(getByRole('button', { name: '生成しています…' }).getAttribute('aria-busy')).toBe('true');
    expect(getByText('生成サービスに接続できませんでした。')).toBeTruthy();
  });
});
