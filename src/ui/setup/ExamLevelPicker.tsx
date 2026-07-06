/**
 * L4 — ExamLevelPicker (Requirement 9.1/9.2). Selects difficulty by a standardized exam scale
 * (英検 / TOEIC / TOEFL / IELTS) and shows the approximate cross-exam conversion for the chosen
 * level. Purely presentational: the parent owns the `ExamCriterion` and maps it to CEFR at
 * generation time via `examScale`.
 */

import { type CSSProperties } from 'react';
import { colors, fonts, radius } from '../theme/tokens';
import { examScale, cefrToDefaultExam } from '../../domain/difficulty/examScale';
import type { ExamCriterion, ExamKind } from '../../types/domain';

export interface ExamLevelPickerProps {
  value: ExamCriterion;
  onChange: (criterion: ExamCriterion) => void;
}

const KIND_LABELS: Record<ExamKind, string> = {
  eiken: '英検',
  toeic: 'TOEIC',
  toefl: 'TOEFL',
  ielts: 'IELTS',
};

const KINDS: ExamKind[] = ['eiken', 'toeic', 'toefl', 'ielts'];

/**
 * A-3-1: direct score entry for the numeric exams so a "TOEIC 900" learner can type their concrete
 * goal instead of snapping to a coarse chip. The raw string is stored on `ExamCriterion.value`; the
 * domain (`examScale.examToDifficultyTarget`) parses it into a CEFR pivot + sub-band. Ranges mirror
 * `examScale`'s NUMERIC_RANGE. 英検 uses fixed grades, so it has no numeric input.
 */
const SCORE_INPUTS: Record<Exclude<ExamKind, 'eiken'>, { min: number; max: number; step: number; placeholder: string }> = {
  toeic: { min: 10, max: 990, step: 5, placeholder: '例: 900' },
  toefl: { min: 0, max: 120, step: 1, placeholder: '例: 90' },
  ielts: { min: 0, max: 9, step: 0.5, placeholder: '例: 7.0' },
};

export function ExamLevelPicker({ value, onChange }: ExamLevelPickerProps) {
  const options = examScale.optionsFor(value.kind);
  // Conversion row for whatever CEFR the current selection resolves to.
  const display = examScale.cefrToExam(examScale.examToCefr(value));
  const scoreInput = value.kind === 'eiken' ? null : SCORE_INPUTS[value.kind];

  const switchKind = (kind: ExamKind): void => {
    if (kind === value.kind) return;
    // Keep the learner at (about) the same CEFR when switching scales.
    onChange(cefrToDefaultExam(examScale.examToCefr(value), kind));
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {KINDS.map((kind) => {
          const on = kind === value.kind;
          return (
            <button
              key={kind}
              type="button"
              data-testid={`exam-kind-${kind}`}
              aria-pressed={on}
              onClick={() => switchKind(kind)}
              style={kindStyle(on)}
            >
              {KIND_LABELS[kind]}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {options.map((opt) => {
          const on = opt.value === value.value;
          return (
            <button
              key={opt.value}
              type="button"
              data-testid={`exam-value-${opt.value}`}
              aria-pressed={on}
              onClick={() => onChange(opt)}
              style={valueStyle(on)}
            >
              {opt.value}
            </button>
          );
        })}
      </div>

      {scoreInput ? (
        <label style={scoreRowStyle}>
          <span style={scoreLabelStyle}>スコアを直接入力</span>
          <input
            type="number"
            inputMode="decimal"
            data-testid="exam-score-input"
            aria-label={`${KIND_LABELS[value.kind]} の目標スコア`}
            min={scoreInput.min}
            max={scoreInput.max}
            step={scoreInput.step}
            value={value.value}
            placeholder={scoreInput.placeholder}
            onChange={(e) => onChange({ kind: value.kind, value: e.target.value })}
            style={scoreInputStyle}
          />
          <span style={scoreHintStyle}>チップは近似値のクイック選択</span>
        </label>
      ) : null}

      <div
        data-testid="exam-conversion"
        style={{ marginTop: 10, fontFamily: fonts.ui, fontSize: 11, color: colors.faint, lineHeight: 1.6 }}
      >
        CEFR {display.cefr} 相当 — 英検 {display.eiken} · TOEIC {display.toeic} · TOEFL {display.toefl} · IELTS {display.ielts}
      </div>
    </div>
  );
}

const scoreRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  marginTop: 10,
};

const scoreLabelStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 11.5,
  color: colors.inkSoft,
};

const scoreInputStyle: CSSProperties = {
  width: 96,
  fontFamily: fonts.num,
  fontSize: 13,
  color: colors.primaryDeep,
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderControl}`,
  borderRadius: radius.control,
  padding: '7px 10px',
};

const scoreHintStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 10.5,
  color: colors.faint,
};

const kindStyle = (on: boolean): CSSProperties => ({
  fontFamily: fonts.ui,
  fontSize: 12,
  fontWeight: on ? 700 : 500,
  color: on ? '#fff' : colors.inkSoft,
  background: on ? colors.primary : '#F1F4F8',
  border: on ? '1px solid transparent' : `1px solid ${colors.borderControl}`,
  borderRadius: 16,
  padding: '6px 13px',
  cursor: 'pointer',
});

const valueStyle = (on: boolean): CSSProperties => ({
  fontFamily: fonts.num,
  fontSize: 13,
  fontWeight: on ? 700 : 500,
  color: on ? colors.primaryDeep : colors.faint,
  background: on ? colors.surfaceBlue : colors.surfaceCard,
  border: `1px solid ${on ? colors.primaryBorder : colors.borderControl}`,
  borderRadius: radius.control,
  padding: '7px 14px',
  cursor: 'pointer',
});
