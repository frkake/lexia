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
};

function renderHome() {
  return render(
    <MemoryRouter>
      <HomeScreen setup={{ candidates: [], onGenerate: vi.fn() }} snapshot={snapshot} now={1_000_000} />
    </MemoryRouter>,
  );
}

describe('<HomeScreen/>', () => {
  it('renders the generation form as the working surface and the progress ledger beside it', () => {
    renderHome();
    // Generation hero (embedded SetupScreen) — its primary action button.
    expect(screen.getByText('文章を生成する')).toBeTruthy();
    // Masthead stat cluster carries the day's figures (streak lives here now, not in a chip).
    expect(screen.getByText('学習の継続')).toBeTruthy();
    // Progress ledger (embedded DashboardScreen, rail layout) rendered from the snapshot.
    expect(screen.getByText('学習の状況')).toBeTruthy();
    expect(screen.getByText('復習が必要な単語')).toBeTruthy();
  });

  it('omits the stat cluster and ledger while the snapshot is loading', () => {
    render(
      <MemoryRouter>
        <HomeScreen setup={{ candidates: [], onGenerate: vi.fn() }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('文章を生成する')).toBeTruthy();
    expect(screen.queryByText('学習の継続')).toBeNull();
    expect(screen.queryByText('学習の状況')).toBeNull();
  });
});
