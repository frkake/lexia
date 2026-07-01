// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardScreen } from './DashboardScreen';
import { DAY_MS, HOUR_MS } from '../../domain/srs/parameters';
import type { DashboardSnapshot } from '../../domain/dashboard/dashboardProjector';

const TODAY = 19_900 * DAY_MS; // a UTC midnight
const NOW = TODAY + 3 * HOUR_MS;

function snapshot(): DashboardSnapshot {
  return {
    dueTodayCount: 8,
    mastery: { new: 298, learning: 384, consolidating: 347, mastered: 211, total: 1240 },
    reading: [{ passageId: 'p1', title: 'The Restless Boardroom', level: 'B2', percent: 62, sentenceIndex: 5 }],
    weekly: Array.from({ length: 7 }, (_, i) => ({ dayStartMs: TODAY - (6 - i) * DAY_MS, reviewCount: i })),
    dueList: [
      { wordId: 'mitigate', dueAt: TODAY, mastery: 'Learning' },
      { wordId: 'leverage', dueAt: TODAY + DAY_MS, mastery: 'Consolidating' },
    ],
    streakDays: 12,
    recent: [
      { passageId: 'p2', title: 'A Quiet Negotiation', intent: 'business', createdAt: NOW - DAY_MS, completed: true },
    ],
  };
}

function renderScreen(props: Partial<Parameters<typeof DashboardScreen>[0]> = {}) {
  return render(
    <MemoryRouter>
      <DashboardScreen snapshot={snapshot()} now={NOW} userName="Kenji" {...props} />
    </MemoryRouter>,
  );
}

describe('<DashboardScreen/>', () => {
  it('greets the learner with the due-today count and streak (10.1/10.6)', () => {
    const { getByText } = renderScreen();
    expect(getByText(/おはようございます、Kenji|こんにちは、Kenji|こんばんは、Kenji/)).toBeTruthy();
    expect(getByText(/8語/)).toBeTruthy();
    expect(getByText(/12日/)).toBeTruthy();
  });

  it('renders the 4-stage mastery breakdown with the total (10.2)', () => {
    const { getByTestId, getByText } = renderScreen();
    expect(within(getByTestId('mastery-bar')).getAllByTestId(/mastery-seg-/).length).toBe(4);
    expect(getByText('1,240')).toBeTruthy();
    expect(getByText('298')).toBeTruthy();
    expect(getByText('211')).toBeTruthy();
  });

  it('offers continue-reading for the in-progress passage (10.3)', () => {
    const onContinue = vi.fn();
    const { getByText } = renderScreen({ onContinue });
    expect(getByText('The Restless Boardroom')).toBeTruthy();
    expect(getByText('62%')).toBeTruthy();
    fireEvent.click(getByText('続きを読む'));
    expect(onContinue).toHaveBeenCalledWith('p1', 5);
  });

  it('charts the weekly activity with seven bars (10.4)', () => {
    const { getByTestId } = renderScreen();
    expect(within(getByTestId('weekly-bars')).getAllByTestId(/weekly-bar-/).length).toBe(7);
  });

  it('lists due words with glosses and starts review (10.5)', () => {
    const onStartReview = vi.fn();
    const { getByText } = renderScreen({ onStartReview, glosses: { mitigate: '和らげる', leverage: '活用する' } });
    expect(getByText('mitigate')).toBeTruthy();
    expect(getByText('和らげる')).toBeTruthy();
    expect(getByText('今日')).toBeTruthy(); // relative due label
    fireEvent.click(getByText('復習をはじめる'));
    expect(onStartReview).toHaveBeenCalledTimes(1);
  });

  it('shows recently read passages with completion (10.6)', () => {
    const { getByText } = renderScreen();
    expect(getByText('A Quiet Negotiation')).toBeTruthy();
    expect(getByText(/business/)).toBeTruthy();
  });
});
