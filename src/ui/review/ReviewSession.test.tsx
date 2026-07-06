// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { ReviewSession, formatInterval, type ReviewItem } from './ReviewSession';
import { MINUTE_MS, DAY_MS } from '../../domain/srs/parameters';
import type { UserId, WordSchedulingState } from '../../types/domain';

const NOW = 1_000_000_000_000;
const USER = 'u1' as UserId;

function learningState(wordId: string): WordSchedulingState {
  return {
    userId: USER,
    wordId,
    stability: 2,
    difficulty: 5,
    reps: 2,
    lapses: 0,
    learningStep: 1,
    lastReviewAt: NOW,
    dueAt: NOW,
    lastSource: 'review',
    mastery: 'Learning',
    reappearCount: 1,
  };
}

function item(wordId: string): ReviewItem {
  return {
    state: learningState(wordId),
    headword: wordId,
    ipa: `/ˈ${wordId}/`,
    context: { before: 'The new policy was designed to ', target: wordId, after: ' the impact of rising costs.' },
    answer: {
      meaningJa: '和らげる・軽減する',
      detailJa: '悪い影響・リスク・損害を小さく抑える。',
      collocations: [`${wordId} the risk`, `${wordId} the impact`],
      register: 'フォーマル',
      synonyms: ['alleviate', 'reduce'],
    },
  };
}

function renderSession(props: Partial<Parameters<typeof ReviewSession>[0]> = {}) {
  return render(<ReviewSession queue={[item('mitigate'), item('concede')]} now={NOW} {...props} />);
}

describe('formatInterval()', () => {
  it('formats minute and day scales', () => {
    expect(formatInterval(10 * MINUTE_MS)).toBe('10分');
    expect(formatInterval(DAY_MS)).toBe('1日');
    expect(formatInterval(4 * DAY_MS)).toBe('4日');
  });
});

const disabled = (el: HTMLElement): boolean => (el as HTMLButtonElement).disabled;

describe('<ReviewSession/>', () => {
  it('shows the rated/total counter and the new-context sentence with the target highlighted', () => {
    const { getByTestId, getByText } = renderSession();
    expect(getByTestId('review-counter').textContent).toBe('0 / 2');
    expect(getByTestId('review-target').textContent).toBe('mitigate');
    expect(getByText(/The new policy was designed to/)).toBeTruthy();
  });

  it('gates rating behind reveal: buttons are disabled and rate() is a no-op until revealed', () => {
    const onRate = vi.fn();
    const { getByTestId, queryByTestId } = renderSession({ onRate });
    expect(queryByTestId('review-answer')).toBeNull();
    expect(disabled(getByTestId('rate-3'))).toBe(true);
    fireEvent.click(getByTestId('rate-3')); // disabled → ignored
    expect(onRate).not.toHaveBeenCalled();

    fireEvent.click(getByTestId('review-reveal'));
    const answer = within(getByTestId('review-answer'));
    expect(answer.getByText('和らげる・軽減する')).toBeTruthy();
    expect(disabled(getByTestId('rate-3'))).toBe(false);
  });

  it('labels each difficulty button with the simulated next interval', () => {
    const { getByTestId } = renderSession();
    expect(within(getByTestId('rate-1')).getByText('10分')).toBeTruthy(); // Unknown/Again ladder
    expect(getByTestId('rate-1').textContent).toContain('知らなかった');
    expect(within(getByTestId('rate-2')).getByText('1日')).toBeTruthy(); // Hard ladder
  });

  it('shows the "定着まであと N 回" progress text (replaces the 5-dot row)', () => {
    const { getByTestId } = renderSession();
    expect(getByTestId('review-progress').textContent).toMatch(/定着まであと\d+回|定着|習熟/);
  });

  it('reveal → rate advances and reports the prior + simulated state', () => {
    const onRate = vi.fn();
    const { getByTestId } = renderSession({ onRate });
    fireEvent.click(getByTestId('review-reveal'));
    fireEvent.click(getByTestId('rate-3')); // 普通 = Good
    expect(onRate).toHaveBeenCalledTimes(1);
    const [wordId, rating, simulated, prior] = onRate.mock.calls[0]!;
    expect(wordId).toBe('mitigate');
    expect(rating).toBe(3);
    expect(simulated.dueAt).toBeGreaterThan(NOW); // rescheduled into the future
    expect(prior.wordId).toBe('mitigate');
    expect(getByTestId('review-target').textContent).toBe('concede'); // advanced
    expect(getByTestId('review-counter').textContent).toBe('1 / 2');
  });

  it('re-inserts an Again word later in the same session (up to 2 rounds)', () => {
    const { getByTestId, getByText } = render(<ReviewSession queue={[item('mitigate')]} now={NOW} />);
    fireEvent.click(getByTestId('review-reveal'));
    fireEvent.click(getByTestId('rate-1')); // Round 1 Again → re-queued, not complete
    expect(getByTestId('review-target').textContent).toBe('mitigate');
    expect(getByTestId('review-reveal')).toBeTruthy(); // reveal reset for the re-shown card
    fireEvent.click(getByTestId('review-reveal'));
    fireEvent.click(getByTestId('rate-1')); // Round 2 Again → cap reached, complete
    expect(getByText(/復習が完了/)).toBeTruthy();
  });

  it('keeps the progress counter numerator ≤ denominator once Again re-drills are graded', () => {
    // Regression: the counter used to render `history.length / queue.length` (a FROZEN denominator).
    // Again ratings append an extra card to the internal queue and one history entry each, so after a
    // re-drilled card is graded the numerator exceeded the fixed denominator — an impossible fraction
    // like "3 / 2" was shown on screen. The denominator must track total work (rated + remaining).
    const { getByTestId } = render(<ReviewSession queue={[item('mitigate'), item('concede')]} now={NOW} />);

    // mitigate: Again (round 1 → re-queued as mitigate'); advance to concede.
    fireEvent.click(getByTestId('review-reveal'));
    fireEvent.click(getByTestId('rate-1'));
    expect(getByTestId('review-target').textContent).toBe('concede');

    // concede: Again (round 1 → re-queued as concede'); advance to mitigate'.
    fireEvent.click(getByTestId('review-reveal'));
    fireEvent.click(getByTestId('rate-1'));
    expect(getByTestId('review-target').textContent).toBe('mitigate');

    // mitigate' (round 2 → cap reached, NOT re-queued): 3 cards graded, concede' still pending, so this
    // render is non-terminal and the counter is visible. Old code showed "3 / 2" (over-count); the
    // fixed denominator is rated(3) + remaining(1) = 4.
    fireEvent.click(getByTestId('review-reveal'));
    fireEvent.click(getByTestId('rate-1'));
    expect(getByTestId('review-target').textContent).toBe('concede'); // the re-drilled concede'
    // Old (buggy) code rendered "3 / 2" here (history 3 over the frozen queue length 2). Fixed
    // denominator = rated(3) + remaining(1) = 4, so numerator ≤ denominator.
    const counter = getByTestId('review-counter').textContent ?? '';
    expect(counter).toBe('3 / 4');
    const [rated, total] = counter.split(' / ');
    expect(Number(rated)).toBeLessThanOrEqual(Number(total)); // never an impossible fraction
  });

  it('undoes the last rating: restores the card and calls onUndo (single depth)', () => {
    const onUndo = vi.fn();
    const { getByTestId } = render(
      <ReviewSession queue={[item('mitigate'), item('concede')]} now={NOW} onUndo={onUndo} />,
    );
    fireEvent.click(getByTestId('review-reveal'));
    fireEvent.click(getByTestId('rate-3')); // rate mitigate → advance to concede
    expect(getByTestId('review-target').textContent).toBe('concede');

    fireEvent.click(getByTestId('review-undo'));
    expect(onUndo).toHaveBeenCalledTimes(1);
    const [wordId, prior, ratingUndone] = onUndo.mock.calls[0]!;
    expect(wordId).toBe('mitigate');
    expect(prior.wordId).toBe('mitigate');
    expect(ratingUndone).toBe(3);
    expect(getByTestId('review-target').textContent).toBe('mitigate'); // back to the first card
    expect(getByTestId('review-answer')).toBeTruthy(); // shown revealed for re-rating
    expect(disabled(getByTestId('review-undo'))).toBe(true); // nothing left to undo
  });

  it('completion screen shows the rating breakdown and the three next actions', () => {
    const onComplete = vi.fn();
    const onHome = vi.fn();
    const { getByTestId, getByText } = render(
      <ReviewSession queue={[item('mitigate')]} now={NOW} onComplete={onComplete} onHome={onHome} />,
    );
    fireEvent.click(getByTestId('review-reveal'));
    fireEvent.click(getByTestId('rate-3'));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(getByText(/復習が完了/)).toBeTruthy();
    expect(getByTestId('complete-count-3').textContent).toContain('1');
    expect(getByTestId('action-generate')).toBeTruthy();
    fireEvent.click(getByTestId('action-home'));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('surfaces a leech word (lapses ≥ 6) on the completion screen', () => {
    const onOpenWord = vi.fn();
    const leech = item('mitigate');
    leech.state = { ...leech.state, lapses: 5 }; // one Again away from the leech threshold (6)
    const { getByTestId } = render(<ReviewSession queue={[leech]} now={NOW} onOpenWord={onOpenWord} />);
    fireEvent.click(getByTestId('review-reveal'));
    fireEvent.click(getByTestId('rate-1')); // Again → lapses 6 (leech), re-inserted
    fireEvent.click(getByTestId('review-reveal'));
    fireEvent.click(getByTestId('rate-3')); // Good → session completes
    expect(getByTestId('complete-leech')).toBeTruthy();
    fireEvent.click(getByTestId('leech-mitigate'));
    expect(onOpenWord).toHaveBeenCalledWith('mitigate');
  });

  it('reveals with Space and grades with number keys (D-8 keyboard grading)', () => {
    const onRate = vi.fn();
    const { getByTestId, queryByTestId } = renderSession({ onRate });
    expect(queryByTestId('review-answer')).toBeNull();

    // Space reveals the answer (Anki-style), same as pressing 解答を見る.
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(getByTestId('review-answer')).toBeTruthy();

    // 3 grades the card Good and advances to the next word.
    fireEvent.keyDown(document.body, { key: '3' });
    expect(onRate).toHaveBeenCalledTimes(1);
    expect(onRate.mock.calls[0]![1]).toBe(3);
    expect(getByTestId('review-target').textContent).toBe('concede');
    expect(getByTestId('review-counter').textContent).toBe('1 / 2');
  });

  it('honours the reveal gate for keyboard grading: number keys are ignored until revealed (D-8)', () => {
    const onRate = vi.fn();
    const { queryByTestId } = renderSession({ onRate });
    fireEvent.keyDown(document.body, { key: '3' }); // no answer shown yet
    expect(onRate).not.toHaveBeenCalled();
    expect(queryByTestId('review-answer')).toBeNull();
  });

  it('signals completion when the queue is exhausted', () => {
    const onComplete = vi.fn();
    const { getByTestId, getByText } = render(
      <ReviewSession queue={[item('mitigate')]} now={NOW} onComplete={onComplete} />,
    );
    fireEvent.click(getByTestId('review-reveal'));
    fireEvent.click(getByTestId('rate-3'));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(getByText(/復習が完了/)).toBeTruthy();
  });
});
