/**
 * L4 — ModalOverlay: the shared accessible dialog primitive (design judgement D6). Every
 * overlay (word detail ×2, story setup, the D-5 home overlay) migrates onto this instead of
 * hand-rolling focus. Mounting the component opens the dialog; unmounting it closes it.
 *
 * Provides: `role="dialog"` + `aria-modal`, initial focus into the panel (first focusable,
 * else the panel itself), a self-contained Tab focus-trap (no external dependency), Escape /
 * backdrop-click close, `document.body` scroll-lock while open, and focus return to the
 * opener on unmount. Rendered through a portal to `document.body` so it escapes ancestor
 * stacking/overflow contexts.
 */

import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { colors, radius, shadow } from '../theme/tokens';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface ModalOverlayProps {
  onClose(): void;
  /** id of the visible heading that names the dialog (aria-labelledby). */
  labelledBy?: string;
  /** Accessible name when there is no visible heading to reference. */
  label?: string;
  /** id of descriptive content (aria-describedby). */
  describedBy?: string;
  /** Element to focus on open; defaults to the first focusable, else the panel. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Close when the backdrop (outside the panel) is clicked. Default true. */
  closeOnBackdrop?: boolean;
  /** Close on the Escape key. Default true. */
  closeOnEsc?: boolean;
  /** Extra style merged onto the centred panel. */
  panelStyle?: CSSProperties;
  panelClassName?: string;
  testId?: string;
  children: ReactNode;
}

/** Focusable descendants, excluding hidden / aria-hidden ones (jsdom-safe: no layout probe). */
function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
  );
}

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))',
  background: 'rgba(16, 21, 28, 0.44)',
};

const panelBaseStyle: CSSProperties = {
  position: 'relative',
  maxWidth: 'min(560px, 100%)',
  maxHeight: '100%',
  overflowY: 'auto',
  background: colors.surfaceCard,
  borderRadius: radius.card,
  boxShadow: shadow.card,
  outline: 'none',
};

export function ModalOverlay({
  onClose,
  labelledBy,
  label,
  describedBy,
  initialFocusRef,
  closeOnBackdrop = true,
  closeOnEsc = true,
  panelStyle,
  panelClassName,
  testId = 'modal-panel',
  children,
}: ModalOverlayProps): React.ReactElement {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  // Save the opener, move focus in, and lock body scroll on open; restore all on close.
  useEffect(() => {
    openerRef.current = document.activeElement;
    const panel = panelRef.current;
    const initial = initialFocusRef?.current ?? (panel ? focusableWithin(panel)[0] : null) ?? panel;
    initial?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = prevOverflow;
      const opener = openerRef.current;
      if (opener instanceof HTMLElement) opener.focus();
    };
    // Open/close is mount/unmount; do not re-run on prop identity changes.
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      if (!closeOnEsc) return;
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = focusableWithin(panel);
    if (focusables.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || active === panel || !panel.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const onBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (closeOnBackdrop && e.target === e.currentTarget) onClose();
  };

  return createPortal(
    <div
      style={backdropStyle}
      data-testid="modal-backdrop"
      onMouseDown={onBackdropMouseDown}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={label}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={panelClassName}
        style={{ ...panelBaseStyle, ...panelStyle }}
        data-testid={testId}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
