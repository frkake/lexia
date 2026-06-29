/**
 * L4 — SentenceTranslation (design.md "SentenceTranslation", 5.1–5.5). The mode toggle
 * (オフ / 文ごと / 全文) persists to settingsStore; the per-sentence block honors the mode:
 * hidden when off, always shown in full, and individually revealable in per-sentence mode.
 */

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { colors, fonts, radius } from '../theme/tokens';
import { useSettingsStore, settingsStore } from '../../state/stores/settingsStore';
import type { Settings } from '../../types/domain';

type Mode = Settings['translationMode'];

const blockStyle: CSSProperties = {
  margin: '13px 0 4px',
  padding: '9px 0 9px 15px',
  borderLeft: `2px solid ${colors.primaryBorder}`,
  fontFamily: fonts.bodyJp,
  fontSize: 14,
  lineHeight: 1.75,
  color: colors.faint2,
};

function TranslationBlock({ text }: { text: string }) {
  return <div style={blockStyle}>{text}</div>;
}

export interface SentenceTranslationProps {
  text: string;
  mode: Mode;
}

export function SentenceTranslation({ text, mode }: SentenceTranslationProps) {
  const [open, setOpen] = useState(false);

  if (mode === 'off') return null;
  if (mode === 'full') return <TranslationBlock text={text} />;

  // per_sentence: an on-demand reveal toggle.
  return (
    <div style={{ margin: '11px 0 4px' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
      {open ? <TranslationBlock text={text} /> : null}
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
