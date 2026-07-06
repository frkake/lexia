// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ReviewStartGate } from './ReviewStartGate';
import type { ReviewSessionPlan } from '../../domain/session/reviewSessionPlan';

function plan(over: Partial<ReviewSessionPlan> = {}): ReviewSessionPlan {
  return {
    queue: [],
    dueTotal: 8,
    ratedToday: 0,
    dailyLimit: 60,
    dailyRemaining: 60,
    sessionSize: 8,
    upcomingCount: 0,
    empty: false,
    dailyLimitReached: false,
    ...over,
  };
}

const noop = () => {};

describe('<ReviewStartGate/>', () => {
  it('ready: shows the card count, all-due total and estimated minutes; 開始 starts', () => {
    const onStart = vi.fn();
    const { getByTestId } = render(
      <ReviewStartGate plan={plan({ sessionSize: 8, dueTotal: 20 })} dailyLimit={60} hasFilter={false} onStart={onStart} onHome={noop} onGenerate={noop} />,
    );
    expect(getByTestId('review-start-count').textContent).toContain('8');
    expect(getByTestId('review-start-count').textContent).toContain('20');
    fireEvent.click(getByTestId('review-start-button'));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('daily ceiling reached: start is disabled and tomorrow-count is shown', () => {
    const onStart = vi.fn();
    const { getByTestId } = render(
      <ReviewStartGate
        plan={plan({ dueTotal: 5, dailyRemaining: 0, sessionSize: 0, dailyLimitReached: true })}
        dailyLimit={60}
        hasFilter={false}
        onStart={onStart}
        onHome={noop}
        onGenerate={noop}
      />,
    );
    expect((getByTestId('review-start-button') as HTMLButtonElement).disabled).toBe(true);
    expect(getByTestId('review-tomorrow-count').textContent).toContain('5');
    fireEvent.click(getByTestId('review-start-button'));
    expect(onStart).not.toHaveBeenCalled();
  });

  it('empty: nudges to read + generate, and shows tomorrow count', () => {
    const onGenerate = vi.fn();
    const { getByTestId } = render(
      <ReviewStartGate
        plan={plan({ dueTotal: 0, sessionSize: 0, empty: true, upcomingCount: 4 })}
        dailyLimit={60}
        hasFilter={false}
        onStart={noop}
        onHome={noop}
        onGenerate={onGenerate}
      />,
    );
    const gate = getByTestId('review-start-gate');
    expect(gate.getAttribute('data-state')).toBe('review-empty');
    expect(gate.textContent).toContain('明日 4 語');
    fireEvent.click(getByTestId('review-generate'));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });
});
