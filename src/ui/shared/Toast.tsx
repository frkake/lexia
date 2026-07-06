/**
 * L4 — ToastViewport: the single resident toast surface (mounted once in AppShell, outside
 * the router Outlet so it survives navigation). It renders the `toastStore` stack bottom-
 * centre above the docked player and owns the auto-dismiss timing (the store stays pure
 * state). Each toast may carry one action button — the same mechanism the rating-Undo toast
 * (C-5c / reviewController) uses: pressing the action runs it and dismisses the toast.
 *
 * A11y: the container is a persistent `aria-live` region so additions are announced; error
 * toasts use `role="alert"` (assertive) while success/info use `role="status"` (polite).
 */

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { toastStore, useToastStore } from '../../state/stores/toastStore';
import type { Toast, ToastTone } from '../../state/stores/toastStore';
import { colors, fonts, radius, shadow } from '../theme/tokens';

/** Accent (icon dot + action text) per tone; all clear WCAG AA on the card surface. */
const TONE_ACCENT: Record<ToastTone, string> = {
  info: colors.primary,
  success: colors.greenDeep,
  error: colors.terracottaDeep,
};

const viewportStyle: CSSProperties = {
  position: 'fixed',
  left: '50%',
  bottom: 'calc(96px + env(safe-area-inset-bottom))',
  transform: 'translateX(-50%)',
  zIndex: 1100,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  width: 'min(440px, calc(100vw - 32px))',
  // The empty region must never block the content beneath it; each toast re-enables clicks.
  pointerEvents: 'none',
};

const cardStyle: CSSProperties = {
  pointerEvents: 'auto',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  boxSizing: 'border-box',
  padding: '11px 14px',
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: radius.card,
  boxShadow: shadow.card,
  fontFamily: fonts.ui,
  fontSize: 13.5,
  lineHeight: 1.5,
  color: colors.body,
};

const messageStyle: CSSProperties = { flex: 1, minWidth: 0 };

const actionStyle: CSSProperties = {
  flex: 'none',
  border: 'none',
  background: 'transparent',
  fontFamily: fonts.ui,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  padding: '4px 6px',
  borderRadius: radius.chip,
};

const closeStyle: CSSProperties = {
  flex: 'none',
  border: 'none',
  background: 'transparent',
  color: colors.faint,
  fontSize: 18,
  lineHeight: 1,
  cursor: 'pointer',
  padding: '2px 4px',
};

function ToastItem({ toast }: { toast: Toast }): React.ReactElement {
  const [entered, setEntered] = useState(false);

  // Slide/fade in on mount (no keyframes needed — a one-shot transition).
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Auto-dismiss after durationMs (0 = sticky). The view owns the timer, not the store.
  useEffect(() => {
    if (!toast.durationMs) return;
    const timer = setTimeout(() => toastStore.getState().dismiss(toast.id), toast.durationMs);
    return () => clearTimeout(timer);
  }, [toast.id, toast.durationMs]);

  const dismiss = (): void => toastStore.getState().dismiss(toast.id);
  const runAction = (): void => {
    toast.action?.onAction();
    dismiss();
  };

  const accent = TONE_ACCENT[toast.tone];

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      data-testid="toast"
      data-tone={toast.tone}
      style={{
        ...cardStyle,
        borderLeft: `3px solid ${accent}`,
        opacity: entered ? 1 : 0,
        transform: entered ? 'translateY(0)' : 'translateY(8px)',
        transition: 'opacity .18s ease, transform .18s ease',
      }}
    >
      <span style={messageStyle}>{toast.message}</span>
      {toast.action ? (
        <button type="button" style={{ ...actionStyle, color: accent }} onClick={runAction}>
          {toast.action.label}
        </button>
      ) : null}
      <button type="button" aria-label="閉じる" style={closeStyle} onClick={dismiss}>
        ×
      </button>
    </div>
  );
}

/** The resident toast region. Render once (AppShell). */
export function ToastViewport(): React.ReactElement {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div aria-live="polite" aria-atomic="false" data-testid="toast-viewport" style={viewportStyle}>
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
