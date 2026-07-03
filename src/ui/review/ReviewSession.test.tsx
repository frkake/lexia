// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { ReviewSession, formatInterval, type ReviewItem } from './ReviewSession';
import { MINUTE_MS, DAY_MS } from '../../domain/srs/parameters';
import type { Rating, UserId, WordSchedulingState } from '../../types/domain';

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

describe('<ReviewSession/>', () => {
  it('shows the progress counter and the new-context sentence with the target highlighted (9.1/9.2)', () => {
    const { getByText, getByTestId } = renderSession();
    expect(getByText('1 / 2')).toBeTruthy();
    expect(getByTestId('review-target').textContent).toBe('mitigate');
    expect(getByText(/The new policy was designed to/)).toBeTruthy();
  });

  it('hides the answer until it is revealed (9.3)', () => {
    const { getByText, queryByTestId, getByTestId } = renderSession();
    expect(queryByTestId('review-answer')).toBeNull();
    fireEvent.click(getByText('解答を見る'));
    const answer = within(getByTestId('review-answer'));
    expect(answer.getByText('和らげる・軽減する')).toBeTruthy();
    expect(answer.getByText('mitigate the risk')).toBeTruthy();
    expect(getByTestId('review-answer').textContent).toContain('alleviate');
  });

  it('labels each difficulty button with the simulated next interval (9.4)', () => {
    const { getByTestId } = renderSession();
    expect(within(getByTestId('rate-1')).getByText('10分')).toBeTruthy(); // Unknown/Again ladder
    expect(getByTestId('rate-1').textContent).toContain('知らなかった');
    expect(within(getByTestId('rate-2')).getByText('1日')).toBeTruthy(); // Hard ladder
    expect(getByTestId('rate-3').textContent).toContain('普通');
    expect(getByTestId('rate-4').textContent).toContain('簡単');
  });

  it('shows mastery progress dots and the remaining-reps estimate (9.6)', () => {
    const { getByTestId } = renderSession();
    const progress = within(getByTestId('review-progress'));
    expect(progress.getAllByTestId('mastery-dot').length).toBe(5);
    expect(getByTestId('review-progress').textContent).toMatch(/あと\d+回で定着/);
  });

  it('reschedules via onRate and advances to the next word (9.5)', () => {
    const onRate = vi.fn<(w: string, r: Rating, s: WordSchedulingState) => void>();
    const { getByTestId, getByText } = renderSession({ onRate });
    fireEvent.click(getByTestId('rate-3')); // 普通 = Good
    expect(onRate).toHaveBeenCalledTimes(1);
    const [wordId, rating, simulated] = onRate.mock.calls[0]!;
    expect(wordId).toBe('mitigate');
    expect(rating).toBe(3);
    expect(simulated.dueAt).toBeGreaterThan(NOW); // rescheduled into the future
    expect(getByText('2 / 2')).toBeTruthy(); // advanced
  });

  it('signals completion when the queue is exhausted', () => {
    const onComplete = vi.fn();
    const { getByTestId, getByText } = render(
      <ReviewSession queue={[item('mitigate')]} now={NOW} onComplete={onComplete} />,
    );
    fireEvent.click(getByTestId('rate-3'));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(getByText(/復習が完了/)).toBeTruthy();
  });
});
