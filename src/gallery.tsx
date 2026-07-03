/**
 * Visual-regression gallery (task 11.4): renders one presentational screen per URL hash
 * with deterministic fixtures, so Playwright can baseline each of the 6 mock frames without
 * live data, IndexedDB seeding or network mocks. Dev/test-only entry (gallery.html); not in
 * the production bundle.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { DashboardScreen } from './ui/dashboard/DashboardScreen';
import { HomeScreen } from './ui/home/HomeScreen';
import { ReadingScreen } from './ui/reading/ReadingScreen';
import { WordDetailCard } from './ui/wordcard/WordDetailCard';
import { ReviewSession } from './ui/review/ReviewSession';
import { SetupScreen } from './ui/setup/SetupScreen';
import { WordbookScreen } from './ui/wordbook/WordbookScreen';
import * as fx from './gallery.fixtures';
import { resolveFeatureFlags } from './ui/app/featureFlags';
import { settingsStore } from './state/stores/settingsStore';
import { colors } from './ui/theme/tokens';
import './ui/theme/global.css';

function screenFor(key: string): ReactNode {
  if (key === 'reading' || key === 'reading-grid' || key === 'reading-legacy') {
    settingsStore.getState().setTranslationMode('full');
  }
  switch (key) {
    case 'dashboard':
      return <DashboardScreen snapshot={fx.dashboardSnapshot} userName="あなた" glosses={fx.dueGlosses} now={fx.FIXED_NOW} />;
    case 'home':
      return (
        <HomeScreen
          setup={{ candidates: fx.setupCandidates, initial: fx.setupInitial }}
          snapshot={fx.dashboardSnapshot}
          userName="あなた"
          now={fx.FIXED_NOW}
        />
      );
    case 'reading':
      // Production-representative reading frame: the reading-layout flag now ships ON, so the
      // baseline is the new 3-zone layout (sentence grid + right-cell translation + aligned rail).
      return <ReadingScreen passage={fx.readingPassage} newLayout={resolveFeatureFlags().newReadingLayout} />;
    case 'reading-legacy':
      // Legacy layout kept for comparison / kill-switch verification (flag forced off).
      return <ReadingScreen passage={fx.readingPassage} newLayout={false} />;
    case 'reading-grid':
      // Explicit new-layout frame (same as 'reading' while the flag is on).
      return <ReadingScreen passage={fx.readingPassage} newLayout />;
    case 'wordcard':
      return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40, background: colors.surfacePage, minHeight: '100vh' }}>
          <WordDetailCard word={fx.wordCardData} stage="Consolidating" />
        </div>
      );
    case 'review':
      return <ReviewSession queue={fx.reviewQueue} now={fx.FIXED_NOW} />;
    case 'setup':
      return <SetupScreen candidates={fx.setupCandidates} initial={fx.setupInitial} />;
    case 'wordbook':
      return <WordbookScreen words={fx.wordbookEntries} />;
    default:
      return <div data-testid="gallery-unknown">unknown: {key}</div>;
  }
}

const key = window.location.hash.replace('#', '') || 'dashboard';
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <MemoryRouter>
        <div data-testid="gallery-ready">{screenFor(key)}</div>
      </MemoryRouter>
    </StrictMode>,
  );
}
