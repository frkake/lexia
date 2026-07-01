/**
 * L4 — WordTargetSlider (Requirement 7.1/7.2/7.3). A 100-word-step slider bounded by the
 * content-type's word range, with a live "≒ N pages" hint from `lengthSpec`. Presentational:
 * the parent owns the numeric `wordTarget` in its SetupConfig.
 */

import { type CSSProperties } from 'react';
import { colors, fonts } from '../theme/tokens';
import { lengthSpec } from '../../domain/generation/lengthSpec';
import type { ContentType } from '../../types/domain';

export interface WordTargetSliderProps {
  contentType: ContentType;
  value: number;
  onChange: (wordTarget: number) => void;
}

export function WordTargetSlider({ contentType, value, onChange }: WordTargetSliderProps) {
  const range = lengthSpec.wordRange(contentType);
  // Clamp the displayed value into the current range (content type may have changed).
  const clamped = Math.min(range.max, Math.max(range.min, value));
  const pages = lengthSpec.pagesFor(clamped);

  return (
    <div>
      <div style={headStyle}>
        <span style={labelStyle}>文章の長さ</span>
        <span style={valueStyle}>
          約{clamped}語 ≒ 約{pages}ページ
        </span>
      </div>
      <input
        type="range"
        aria-label="文章の長さ"
        min={range.min}
        max={range.max}
        step={range.step}
        value={clamped}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: colors.primary }}
      />
      <div style={endsStyle}>
        <span>{range.min}語</span>
        <span>{range.max}語</span>
      </div>
    </div>
  );
}

const headStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', marginBottom: 12 };
const labelStyle: CSSProperties = { fontFamily: fonts.ui, fontSize: 13, fontWeight: 600, color: colors.ink };
const valueStyle: CSSProperties = { fontFamily: fonts.ui, fontSize: 13, fontWeight: 600, color: colors.primary };
const endsStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  marginTop: 7,
  fontFamily: fonts.ui,
  fontSize: 11,
  color: colors.faint,
};
