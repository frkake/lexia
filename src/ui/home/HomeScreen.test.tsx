// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomeScreen } from './HomeScreen';
import type { DashboardSnapshot } from '../../domain/dashboard/dashboardProjector';

const snapshot: DashboardSnapshot = {
  dueTodayCount: 3,
  streakDays: 5,
  mastery: { total: 10, new: 4, learning: 3, consolidating: 2, mastered: 1 },
  reading: [],
  weekly: [],
  dueList: [],
  recent: [],
};

function renderHome() {
  return render(
    <MemoryRouter>
      <HomeScreen setup={{ candidates: [], onGenerate: vi.fn() }} snapshot={snapshot} now={1_000_000} />
    </MemoryRouter>,
  );
}

describe('<HomeScreen/>', () => {
  it('renders the generation form as the hero and the learning summary below', () => {
    renderHome();
    // Generation hero (embedded SetupScreen) — its primary action button.
    expect(screen.getByText('文章を生成する')).toBeTruthy();
    // Learning summary from the snapshot (DashboardScreen renders the streak chip).
    expect(screen.getByText('5日連続')).toBeTruthy();
  });

  it('omits the summary while the snapshot is loading', () => {
    render(
      <MemoryRouter>
        <HomeScreen setup={{ candidates: [], onGenerate: vi.fn() }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('文章を生成する')).toBeTruthy();
    expect(screen.queryByText('5日連続')).toBeNull();
  });
});
