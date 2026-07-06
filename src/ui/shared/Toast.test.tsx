// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { ToastViewport } from './Toast';
import { toastStore } from '../../state/stores/toastStore';

beforeEach(() => {
  toastStore.getState().clear();
});
afterEach(() => {
  vi.useRealTimers();
  toastStore.getState().clear();
});

describe('<ToastViewport/>', () => {
  it('renders a persistent live region even with no toasts', () => {
    const { getByTestId, queryAllByTestId } = render(<ToastViewport />);
    expect(getByTestId('toast-viewport').getAttribute('aria-live')).toBe('polite');
    expect(queryAllByTestId('toast')).toHaveLength(0);
  });

  it('shows a queued toast message', () => {
    const { getByText } = render(<ToastViewport />);
    act(() => {
      toastStore.getState().show({ message: 'negotiation を記録しました' });
    });
    expect(getByText('negotiation を記録しました')).toBeTruthy();
  });

  it('uses role=alert for errors and role=status otherwise', () => {
    const { getAllByTestId } = render(<ToastViewport />);
    act(() => {
      toastStore.getState().show({ message: 'e', tone: 'error' });
      toastStore.getState().show({ message: 's', tone: 'success' });
    });
    const items = getAllByTestId('toast');
    expect(items[0]!.getAttribute('role')).toBe('alert');
    expect(items[1]!.getAttribute('role')).toBe('status');
  });

  it('runs the action then dismisses the toast', () => {
    const onAction = vi.fn();
    const { getByText, queryByTestId } = render(<ToastViewport />);
    act(() => {
      toastStore.getState().show({ message: '記録しました', durationMs: 0, action: { label: '取り消す', onAction } });
    });
    fireEvent.click(getByText('取り消す'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(queryByTestId('toast')).toBeNull();
    expect(toastStore.getState().toasts).toHaveLength(0);
  });

  it('dismisses via the close button without running any action', () => {
    const onAction = vi.fn();
    const { getByLabelText, queryByTestId } = render(<ToastViewport />);
    act(() => {
      toastStore.getState().show({ message: 'x', durationMs: 0, action: { label: '取り消す', onAction } });
    });
    fireEvent.click(getByLabelText('閉じる'));
    expect(onAction).not.toHaveBeenCalled();
    expect(queryByTestId('toast')).toBeNull();
  });

  it('auto-dismisses after durationMs', () => {
    vi.useFakeTimers();
    const { queryByTestId } = render(<ToastViewport />);
    act(() => {
      toastStore.getState().show({ message: 'temp', durationMs: 5000 });
    });
    expect(queryByTestId('toast')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(queryByTestId('toast')).toBeNull();
  });

  it('keeps a durationMs=0 toast until dismissed', () => {
    vi.useFakeTimers();
    const { queryByTestId } = render(<ToastViewport />);
    act(() => {
      toastStore.getState().show({ message: 'sticky', durationMs: 0 });
    });
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(queryByTestId('toast')).not.toBeNull();
  });
});
