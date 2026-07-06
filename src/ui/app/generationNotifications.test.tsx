// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { GenerationCompletionBridge, GenerationIndicator } from './generationNotifications';
import { generationProgressStore } from '../../state/stores/generationProgressStore';
import { toastStore } from '../../state/stores/toastStore';

function LocationProbe(): React.ReactElement {
  const loc = useLocation();
  return <div data-testid="pathname">{loc.pathname}</div>;
}

function Harness({ initial }: { initial: string }): React.ReactElement {
  return (
    <MemoryRouter initialEntries={[initial]}>
      <GenerationCompletionBridge />
      <GenerationIndicator />
      <Routes>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  generationProgressStore.getState().reset();
  toastStore.getState().clear();
});
afterEach(() => {
  vi.useRealTimers();
  generationProgressStore.getState().reset();
  toastStore.getState().clear();
});

describe('GenerationIndicator', () => {
  it('is hidden when idle and shown while a run is active', () => {
    const { queryByTestId, getByTestId } = render(<Harness initial="/" />);
    expect(queryByTestId('generation-indicator')).toBeNull();
    act(() => {
      generationProgressStore.getState().start(0);
    });
    expect(getByTestId('generation-indicator').textContent).toContain('生成中');
    act(() => {
      generationProgressStore.getState().finish('p1', '/p/p1');
    });
    // Once settled (or reset by the bridge), the indicator disappears again.
    expect(queryByTestId('generation-indicator')).toBeNull();
  });
});

describe('GenerationCompletionBridge', () => {
  it('navigates straight into the reader when the learner is still on Home', () => {
    const { getByTestId } = render(<Harness initial="/" />);
    act(() => {
      generationProgressStore.getState().start(0);
    });
    act(() => {
      generationProgressStore.getState().finish('p_abc', '/p/p_abc');
    });
    expect(getByTestId('pathname').textContent).toBe('/p/p_abc');
    // The store is settled back to idle after handling.
    expect(generationProgressStore.getState().phase).toBe('idle');
  });

  it('does not navigate off another screen — it shows an "開く" toast instead', () => {
    const { getByTestId } = render(<Harness initial="/library" />);
    act(() => {
      generationProgressStore.getState().start(0);
    });
    act(() => {
      generationProgressStore.getState().finish('p_xyz', '/p/p_xyz');
    });
    expect(getByTestId('pathname').textContent).toBe('/library'); // stayed put
    const toast = toastStore.getState().toasts[0]!;
    expect(toast.message).toContain('文章ができました');
    expect(toast.action?.label).toBe('開く');
    // Clicking the action navigates into the reader.
    act(() => toast.action!.onAction());
    expect(getByTestId('pathname').textContent).toBe('/p/p_xyz');
  });

  it('surfaces an error toast when a run fails off Home', () => {
    render(<Harness initial="/review" />);
    act(() => {
      generationProgressStore.getState().start(0);
    });
    act(() => {
      generationProgressStore.getState().fail('生成に失敗しました');
    });
    const toast = toastStore.getState().toasts[0]!;
    expect(toast.tone).toBe('error');
    expect(toast.message).toBe('生成に失敗しました');
  });

  it('leaves an error on Home for the SetupScreen panel (no toast)', () => {
    render(<Harness initial="/" />);
    act(() => {
      generationProgressStore.getState().start(0);
    });
    act(() => {
      generationProgressStore.getState().fail('タイムアウトしました');
    });
    expect(toastStore.getState().toasts).toHaveLength(0);
    // Kept in the error phase so the panel can show it + 再試行.
    expect(generationProgressStore.getState().phase).toBe('error');
  });

  it('ignores a terminal state left over from before it mounted (runId guard)', () => {
    // A prior run already finished before this bridge mounts.
    act(() => {
      generationProgressStore.getState().start(0);
      generationProgressStore.getState().finish('stale', '/p/stale');
    });
    const { getByTestId } = render(<Harness initial="/" />);
    // The bridge must NOT navigate to the stale result.
    expect(getByTestId('pathname').textContent).toBe('/');
  });
});
