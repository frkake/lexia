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
import { ToastViewport } from './ui/shared/Toast';
import { ModalOverlay } from './ui/shared/ModalOverlay';
import * as fx from './gallery.fixtures';
import { resolveFeatureFlags } from './ui/app/featureFlags';
import { settingsStore } from './state/stores/settingsStore';
import { toastStore } from './state/stores/toastStore';
import { colors, fonts } from './ui/theme/tokens';
// F-7: load the same self-hosted fonts as the app so visual baselines render
// the intended typography (Newsreader serif body, IBM Plex Sans UI, Noto JP).
import '@fontsource-variable/newsreader/index.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource-variable/noto-sans-jp/index.css';
import '@fontsource-variable/noto-serif-jp/index.css';
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
    case 'toast': {
      // D-8 shared toast surface: an Undo toast (same mechanism as the rating-Undo) + an error.
      toastStore.getState().clear();
      toastStore.getState().show({
        message: 'negotiation を記録しました',
        tone: 'success',
        durationMs: 0,
        action: { label: '取り消す', onAction: () => {} },
      });
      toastStore.getState().show({ message: '生成に失敗しました。時間をおいて再試行してください。', tone: 'error', durationMs: 0 });
      return (
        <div style={{ minHeight: '100vh', background: colors.surfacePage }}>
          <ToastViewport />
        </div>
      );
    }
    case 'modal':
      // D-8 shared accessible dialog primitive.
      return (
        <div style={{ minHeight: '100vh', background: colors.surfacePage }}>
          <ModalOverlay onClose={() => {}} label="サンプルダイアログ">
            <div style={{ padding: 24, width: 'min(420px, 90vw)' }}>
              <div style={{ fontFamily: fonts.serifJp, fontSize: 20, color: colors.ink, marginBottom: 12 }}>
                プランを破棄しますか？
              </div>
              <div style={{ fontFamily: fonts.bodyJp, fontSize: 14, color: colors.muted, marginBottom: 20 }}>
                生成済みのプランと進行中のイラストが失われます。
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button">キャンセル</button>
                <button type="button">破棄する</button>
              </div>
            </div>
          </ModalOverlay>
        </div>
      );
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
