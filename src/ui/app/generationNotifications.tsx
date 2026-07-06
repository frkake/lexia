/**
 * L4 — generation notifications (D-7): the two always-mounted pieces that make an in-flight passage
 * generation visible from ANY screen, mounted once in AppShell (outside the router Outlet) so they
 * survive navigating away from Home while the pipeline keeps running.
 *
 *   - GenerationIndicator: a small spinner + 「生成中…」 at the right of the TopNav while a run is active.
 *   - GenerationCompletionBridge: watches the store settle and decides navigate-vs-toast:
 *       · on success, if the learner is still on Home it navigates straight into the reader;
 *         otherwise it shows a 「文章ができました — 開く」 toast (no forced navigation);
 *       · on failure, if the learner left Home it surfaces an error toast (on Home the SetupScreen
 *         panel already shows it + 再試行, so the bridge leaves that state for the panel).
 *     `runId` guards it to fire exactly once per run — and to ignore a terminal state it did not
 *     itself start (e.g. one left over between tests / from a prior visit).
 */

import { useEffect, useRef, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { generationProgressStore, useGenerationProgressStore } from '../../state/stores/generationProgressStore';
import { showToast } from '../../state/stores/toastStore';
import { colors, fonts } from '../theme/tokens';

/** Spinner + 「生成中…」shown in the header while a generation runs. Renders nothing when idle. */
export function GenerationIndicator(): React.ReactElement | null {
  const active = useGenerationProgressStore(
    (s) => s.phase === 'words' || s.phase === 'passage' || s.phase === 'repair' || s.phase === 'annotate',
  );
  if (!active) return null;
  return (
    <div data-testid="generation-indicator" style={indicatorStyle} aria-live="polite">
      <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden style={{ flex: 'none' }}>
        <circle cx="7.5" cy="7.5" r="6" fill="none" stroke={colors.primaryBorder} strokeWidth="2" />
        <path d="M7.5 1.5 a6 6 0 0 1 6 6" fill="none" stroke={colors.primary} strokeWidth="2" strokeLinecap="round">
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 7.5 7.5"
            to="360 7.5 7.5"
            dur="0.9s"
            repeatCount="indefinite"
          />
        </path>
      </svg>
      <span>生成中…</span>
    </div>
  );
}

/** Renders nothing; runs the settle → navigate/toast side effect. Mount once in AppShell. */
export function GenerationCompletionBridge(): null {
  const navigate = useNavigate();
  const location = useLocation();
  const phase = useGenerationProgressStore((s) => s.phase);
  const resultPath = useGenerationProgressStore((s) => s.resultPath);
  const error = useGenerationProgressStore((s) => s.error);
  const runId = useGenerationProgressStore((s) => s.runId);

  // Keep the live pathname in a ref so the settle effect reads the CURRENT screen (not the one at the
  // render that queued the run — the learner may have navigated away mid-generation).
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;

  // The run whose terminal state has already been handled. Initialised to the mount-time run so a
  // leftover done/error (same runId) is treated as already-handled and never mis-fires.
  const handledRunId = useRef(runId);

  useEffect(() => {
    if (runId === handledRunId.current) return; // already handled, or nothing new since mount
    const onHome = pathnameRef.current === '/';

    if (phase === 'done' && resultPath) {
      handledRunId.current = runId;
      if (onHome) {
        navigate(resultPath);
      } else {
        showToast({
          message: '文章ができました',
          tone: 'success',
          durationMs: 10_000,
          action: { label: '開く', onAction: () => navigate(resultPath) },
        });
      }
      generationProgressStore.getState().reset();
    } else if (phase === 'error') {
      handledRunId.current = runId;
      // On Home the SetupScreen panel owns the error (message + 再試行); elsewhere surface a toast and
      // clear the store so a later Home visit starts clean.
      if (!onHome && error) {
        showToast({ message: error, tone: 'error', durationMs: 8_000 });
        generationProgressStore.getState().reset();
      }
    }
  }, [phase, resultPath, error, runId, navigate]);

  return null;
}

const indicatorStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  fontFamily: fonts.ui,
  fontSize: 13,
  fontWeight: 600,
  color: colors.primaryDeep,
};
