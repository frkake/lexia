/**
 * L4 — SentenceTranslation (design.md "SentenceTranslation", 3.1–3.4 / 4.1–4.4). The mode
 * toggle (オフ / 文ごと / 全文) persists to settingsStore; the per-sentence block honors the mode:
 * hidden when off, always shown in full, and individually revealable in per-sentence mode.
 *
 * `placement` chooses where the translation sits: 'block' (legacy, directly below the English
 * sentence) or 'aside' (the right cell of the sentence-unit grid, Requirement 3.1). The narrow
 * fallback (reflow below the sentence) is layout/CSS-driven; the component just flags its
 * placement via `data-placement` so the layout can switch. New-element emphasis (Requirement 4)
 * underlines the `translationSpans` slices of the text.
 */

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { colors, fonts, radius } from '../theme/tokens';
import { useSettingsStore, settingsStore } from '../../state/stores/settingsStore';
import type { Settings, TranslationSpan } from '../../types/domain';

type Mode = Settings['translationMode'];

/** Where the translation renders: legacy below-the-sentence block, or the grid's right cell. */
export type TranslationPlacement = 'block' | 'aside';

const blockStyle: CSSProperties = {
  margin: '13px 0 4px',
  padding: '9px 0 9px 15px',
  borderLeft: `2px solid ${colors.primaryBorder}`,
  fontFamily: fonts.bodyJp,
  fontSize: 14,
  lineHeight: 1.75,
  color: colors.faint2,
};

/** Right-cell variant: no left rule / top margin so it aligns with the English cell baseline. */
const asideStyle: CSSProperties = {
  margin: 0,
  padding: 0,
  fontFamily: fonts.bodyJp,
  fontSize: 14,
  lineHeight: 1.75,
  color: colors.faint2,
};

/**
 * Render `translationJa` with the new-element slices underlined (Requirement 4). Only `isNew`
 * spans get emphasis (4.4); multiple spans are each emphasized individually (4.3). Spans are
 * sorted and clamped to the text bounds, and any that overlap an already-emitted emphasis are
 * skipped so a bad span never corrupts the surrounding text.
 */
function renderWithSpans(text: string, spans?: TranslationSpan[]): ReactNode {
  const news = (spans ?? [])
    .filter((s) => s.isNew && s.charStart >= 0 && s.charEnd <= text.length && s.charStart < s.charEnd)
    .sort((a, b) => a.charStart - b.charStart);
  if (news.length === 0) return text;

  const out: ReactNode[] = [];
  let cursor = 0;
  news.forEach((span, i) => {
    if (span.charStart < cursor) return; // skip overlap with an already-emitted emphasis
    if (span.charStart > cursor) out.push(text.slice(cursor, span.charStart));
    out.push(
      <span
        key={`ts-${i}`}
        data-translation-new="true"
        style={{ borderBottom: `1.5px solid ${colors.primary}`, fontWeight: 600 }}
      >
        {text.slice(span.charStart, span.charEnd)}
      </span>,
    );
    cursor = span.charEnd;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

function TranslationBlock({
  text,
  placement,
  spans,
}: {
  text: string;
  placement: TranslationPlacement;
  spans?: TranslationSpan[];
}) {
  return (
    <div data-testid="sentence-translation" data-placement={placement} style={placement === 'aside' ? asideStyle : blockStyle}>
      {renderWithSpans(text, spans)}
    </div>
  );
}

export interface SentenceTranslationProps {
  text: string;
  mode: Mode;
  /** 'block' (legacy, below the sentence) or 'aside' (grid right cell, 3.1). Default 'block'. */
  placement?: TranslationPlacement;
  /** New-element emphasis spans into `text` (Requirement 4). */
  spans?: TranslationSpan[];
  /**
   * F-9: controlled reveal state for per-sentence mode. When `open` is supplied the caller owns the
   * open/close (e.g. ReadingScreen's session-level "すべて開く / すべて閉じる" toolbar) via `onToggle`;
   * when omitted the block self-manages its reveal locally (legacy behavior).
   */
  open?: boolean;
  onToggle?: () => void;
}

export function SentenceTranslation({ text, mode, placement = 'block', spans, open: openProp, onToggle }: SentenceTranslationProps) {
  const [openLocal, setOpenLocal] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openLocal;
  const toggle = (): void => {
    if (controlled) onToggle?.();
    else setOpenLocal((v) => !v);
  };

  if (mode === 'off') return null;
  if (mode === 'full') return <TranslationBlock text={text} placement={placement} spans={spans} />;

  // per_sentence: an on-demand reveal toggle.
  return (
    <div style={{ margin: placement === 'aside' ? 0 : '11px 0 4px' }}>
      <button
        type="button"
        onClick={toggle}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: fonts.ui,
          fontSize: 12,
          color: colors.primary,
          background: colors.surfaceBlue,
          border: `1px solid ${colors.primaryBorder2}`,
          borderRadius: radius.control - 1,
          padding: '5px 12px',
          cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 13, lineHeight: 1 }}>{open ? '−' : '＋'}</span>
        {open ? 'この文の和訳を隠す' : 'この文の和訳を表示'}
      </button>
      {open ? <TranslationBlock text={text} placement={placement} spans={spans} /> : null}
    </div>
  );
}

const MODES: { value: Mode; label: string }[] = [
  { value: 'off', label: 'オフ' },
  { value: 'per_sentence', label: '文ごと' },
  { value: 'full', label: '全文' },
];

export function TranslationModeToggle() {
  const mode = useSettingsStore((s) => s.translationMode);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <span style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>和訳</span>
      <div style={{ display: 'flex', border: `1px solid ${colors.borderControl}`, borderRadius: radius.control, overflow: 'hidden' }}>
        {MODES.map((m) => {
          const activeMode = m.value === mode;
          return (
            <button
              key={m.value}
              type="button"
              aria-pressed={activeMode}
              onClick={() => settingsStore.getState().setTranslationMode(m.value)}
              style={{
                fontFamily: fonts.ui,
                fontSize: 12,
                fontWeight: activeMode ? 600 : 400,
                color: activeMode ? '#fff' : colors.muted,
                background: activeMode ? colors.primary : 'transparent',
                border: 'none',
                padding: '5px 11px',
                cursor: 'pointer',
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
