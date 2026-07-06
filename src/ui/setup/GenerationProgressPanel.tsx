/**
 * L4 — GenerationProgressPanel: the in-place feedback that replaces the「文章を生成する」button while a
 * generation is running (D-7). It names the current phase (単語 → 本文 → 調整 → 注釈), shows the
 * elapsed seconds and a "通常 30〜90 秒" estimate, and offers a Cancel button. When the run fails or
 * times out it shows the error with a 再試行 button so the learner can retry without losing the form.
 * Purely presentational: phase / startedAt / handlers are injected (the store lives in the route).
 * The elapsed counter is the only stateful piece and is timer-driven here so the store stays pure.
 */

import { useEffect, useState, type CSSProperties } from 'react';
import { colors, fonts, radius } from '../theme/tokens';
import type { GenerationPhase } from '../../state/stores/generationProgressStore';
import { isGenerationActive } from '../../state/stores/generationProgressStore';

export interface GenerationProgressPanelProps {
  phase: GenerationPhase;
  /** Epoch ms the run started (for the elapsed counter). */
  startedAt: number | null;
  error?: string | null;
  onCancel?: () => void;
  onRetry?: () => void;
  /** Clock injection for tests; defaults to Date.now. */
  now?: () => number;
}

const PHASE_LABEL: Record<GenerationPhase, string> = {
  idle: '',
  words: '単語を選んでいます',
  passage: '本文を生成しています',
  repair: '本文を調整しています',
  annotate: '注釈を付けています',
  done: '文章ができました',
  error: '',
};

/** The four ordered active phases, so the panel can show a "2 / 4" step position. */
const PHASE_ORDER: GenerationPhase[] = ['words', 'passage', 'repair', 'annotate'];

export function GenerationProgressPanel({
  phase,
  startedAt,
  error = null,
  onCancel,
  onRetry,
  now = Date.now,
}: GenerationProgressPanelProps): React.ReactElement | null {
  const active = isGenerationActive(phase);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!active || startedAt == null) {
      setElapsedSec(0);
      return;
    }
    const compute = (): void => setElapsedSec(Math.max(0, Math.floor((now() - startedAt) / 1000)));
    compute();
    const timer = setInterval(compute, 1000);
    return () => clearInterval(timer);
  }, [active, startedAt, now]);

  if (phase === 'error') {
    return (
      <div data-testid="generation-progress" data-phase="error" style={errorPanelStyle}>
        <div role="alert" style={errorMessageStyle}>
          {error ?? '文章生成に失敗しました。もう一度お試しください。'}
        </div>
        {onRetry ? (
          <button type="button" data-testid="retry-generation" onClick={onRetry} style={retryButtonStyle}>
            再試行する
          </button>
        ) : null}
      </div>
    );
  }

  if (!active) return null;

  const step = PHASE_ORDER.indexOf(phase) + 1;

  return (
    <div data-testid="generation-progress" data-phase={phase} style={panelStyle} aria-live="polite" aria-busy="true">
      <div style={rowStyle}>
        <Spinner />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={phaseLabelStyle}>
            {PHASE_LABEL[phase]}
            <span style={stepStyle}>
              {step} / {PHASE_ORDER.length}
            </span>
          </div>
          <div style={metaStyle}>
            経過 {elapsedSec} 秒 · 通常 30〜90 秒ほどかかります
          </div>
        </div>
        {onCancel ? (
          <button type="button" data-testid="cancel-generation" onClick={onCancel} style={cancelButtonStyle}>
            キャンセル
          </button>
        ) : null}
      </div>
      <div style={hintStyle}>ページを離れても生成は続き、完了すると通知します。</div>
    </div>
  );
}

/** Self-contained SVG spinner (SMIL rotate) — no shared-CSS keyframe dependency. */
function Spinner(): React.ReactElement {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden style={{ flex: 'none' }}>
      <circle cx="11" cy="11" r="9" fill="none" stroke={colors.primaryBorder} strokeWidth="2.5" />
      <path d="M11 2 a9 9 0 0 1 9 9" fill="none" stroke={colors.primary} strokeWidth="2.5" strokeLinecap="round">
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 11 11"
          to="360 11 11"
          dur="0.9s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  background: colors.surfaceBlue,
  border: `1px solid ${colors.primaryBorder2}`,
  borderRadius: radius.card,
  padding: '14px 16px',
  marginTop: 6,
};

const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12 };

const phaseLabelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  fontFamily: fonts.ui,
  fontSize: 14,
  fontWeight: 600,
  color: colors.ink,
};

const stepStyle: CSSProperties = {
  fontFamily: fonts.num,
  fontSize: 11,
  fontWeight: 600,
  color: colors.primary,
  letterSpacing: '.04em',
};

const metaStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 12,
  color: colors.muted,
  marginTop: 3,
};

const hintStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 11.5,
  color: colors.faint,
};

const cancelButtonStyle: CSSProperties = {
  flex: 'none',
  fontFamily: fonts.ui,
  fontSize: 13,
  fontWeight: 600,
  color: colors.primaryDeep,
  background: colors.surfaceCard,
  border: `1px solid ${colors.primaryBorder}`,
  borderRadius: radius.control,
  padding: '8px 14px',
  cursor: 'pointer',
};

const errorPanelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  marginTop: 6,
};

const errorMessageStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 13,
  lineHeight: 1.5,
  color: colors.terracotta,
  background: '#FBF3F0',
  border: `1px solid ${colors.terracottaBorder}`,
  borderRadius: radius.control,
  padding: '11px 14px',
};

const retryButtonStyle: CSSProperties = {
  alignSelf: 'flex-start',
  fontFamily: fonts.ui,
  fontSize: 14,
  fontWeight: 600,
  color: '#fff',
  background: colors.primary,
  border: 'none',
  borderRadius: radius.control,
  padding: '10px 18px',
  cursor: 'pointer',
};
