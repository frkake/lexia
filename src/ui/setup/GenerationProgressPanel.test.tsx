// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { GenerationProgressPanel } from './GenerationProgressPanel';

afterEach(() => {
  vi.useRealTimers();
});

describe('<GenerationProgressPanel/>', () => {
  it('renders nothing when idle', () => {
    const { queryByTestId } = render(<GenerationProgressPanel phase="idle" startedAt={null} />);
    expect(queryByTestId('generation-progress')).toBeNull();
  });

  it('names the active phase and its step position', () => {
    const { getByTestId, getByText } = render(
      <GenerationProgressPanel phase="passage" startedAt={0} now={() => 0} />,
    );
    const panel = getByTestId('generation-progress');
    expect(panel.getAttribute('data-phase')).toBe('passage');
    expect(getByText('本文を生成しています')).toBeTruthy();
    expect(getByText('2 / 4')).toBeTruthy();
  });

  it('ticks the elapsed counter every second', () => {
    vi.useFakeTimers();
    let clock = 10_000;
    const { getByText } = render(<GenerationProgressPanel phase="passage" startedAt={10_000} now={() => clock} />);
    expect(getByText(/経過 0 秒/)).toBeTruthy();
    act(() => {
      clock = 13_000;
      vi.advanceTimersByTime(3_000);
    });
    expect(getByText(/経過 3 秒/)).toBeTruthy();
  });

  it('fires onCancel from the cancel button', () => {
    const onCancel = vi.fn();
    const { getByTestId } = render(
      <GenerationProgressPanel phase="words" startedAt={0} onCancel={onCancel} now={() => 0} />,
    );
    fireEvent.click(getByTestId('cancel-generation'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows the error and a retry button in the error phase', () => {
    const onRetry = vi.fn();
    const { getByTestId, getByRole } = render(
      <GenerationProgressPanel phase="error" startedAt={null} error="生成に時間がかかりすぎたため中断しました。" onRetry={onRetry} />,
    );
    expect(getByTestId('generation-progress').getAttribute('data-phase')).toBe('error');
    expect(getByRole('alert').textContent).toContain('時間がかかりすぎた');
    fireEvent.click(getByTestId('retry-generation'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
