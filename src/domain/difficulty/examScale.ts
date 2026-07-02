/**
 * L1 — examScale: pure, side-effect-free mapping between standardized exam criteria
 * (英検 / TOEIC / TOEFL / IELTS) and the internal CEFR pivot (Requirement 9). Generation and
 * validation keep running on `Cefr`; only the setup/display layer speaks exam scales.
 *
 * The conversion table mirrors research.md ("CEFR ⇄ 標準試験の対応表"). TOEIC L&R and 英検 do not
 * measure C2, so those cells are reported as `n/a` (9.2/9.3). Depends on domain types only.
 */

import type { Cefr, ExamCriterion, ExamKind } from '../../types/domain';

const CEFR_ORDER: Cefr[] = ['A2', 'B1', 'B2', 'C1', 'C2'];
const CEFR_RANK: Record<Cefr, number> = { A2: 0, B1: 1, B2: 2, C1: 3, C2: 4 };

/** UI conversion row: for a given CEFR, the display band for each exam ('n/a' = out of range). */
export interface ExamDisplay {
  cefr: Cefr;
  eiken: string;
  toeic: string;
  toefl: string;
  ielts: string;
}

export interface ExamScale {
  /** Map an exam criterion to the internal CEFR pivot (clamps out-of-range to nearest, never throws). */
  examToCefr(criterion: ExamCriterion): Cefr;
  /** The conversion row for a CEFR level (all exams, with 'n/a' where unmeasured). */
  cefrToExam(cefr: Cefr): ExamDisplay;
  /** Selectable options for an exam kind, ascending by CEFR (picker source). */
  optionsFor(kind: ExamKind): ExamCriterion[];
}

/** Display conversion table, keyed by CEFR (research.md). */
const DISPLAY: Record<Cefr, ExamDisplay> = {
  A2: { cefr: 'A2', eiken: '準2級', toeic: '225–549', toefl: '<42', ielts: '3.0–3.5' },
  B1: { cefr: 'B1', eiken: '2級', toeic: '550–784', toefl: '42–71', ielts: '4.0–5.0' },
  B2: { cefr: 'B2', eiken: '準1級', toeic: '785–944', toefl: '72–94', ielts: '5.5–6.5' },
  C1: { cefr: 'C1', eiken: '1級', toeic: '945+', toefl: '95–113', ielts: '7.0–8.0' },
  C2: { cefr: 'C2', eiken: 'n/a', toeic: 'n/a', toefl: '114–120', ielts: '8.5–9.0' },
};

/** Picker options per exam. `value` is the exam-native label; each maps to `cefr` via examToCefr. */
const OPTIONS: Record<ExamKind, { value: string; cefr: Cefr }[]> = {
  // 英検 and TOEIC do not measure C2 — omit those options (9.2).
  eiken: [
    { value: '準2', cefr: 'A2' },
    { value: '2', cefr: 'B1' },
    { value: '準1', cefr: 'B2' },
    { value: '1', cefr: 'C1' },
  ],
  toeic: [
    { value: '400', cefr: 'A2' },
    { value: '600', cefr: 'B1' },
    { value: '800', cefr: 'B2' },
    { value: '960', cefr: 'C1' },
  ],
  toefl: [
    { value: '30', cefr: 'A2' },
    { value: '50', cefr: 'B1' },
    { value: '80', cefr: 'B2' },
    { value: '100', cefr: 'C1' },
    { value: '117', cefr: 'C2' },
  ],
  ielts: [
    { value: '3.0', cefr: 'A2' },
    { value: '4.5', cefr: 'B1' },
    { value: '6.0', cefr: 'B2' },
    { value: '7.5', cefr: 'C1' },
    { value: '9.0', cefr: 'C2' },
  ],
};

/** Numeric-threshold bands (ascending). The first band whose `max` covers the score wins. */
interface Band {
  max: number;
  cefr: Cefr;
}
const TOEIC_BANDS: Band[] = [
  { max: 549, cefr: 'A2' },
  { max: 784, cefr: 'B1' },
  { max: 944, cefr: 'B2' },
  { max: Infinity, cefr: 'C1' },
];
const TOEFL_BANDS: Band[] = [
  { max: 41, cefr: 'A2' },
  { max: 71, cefr: 'B1' },
  { max: 94, cefr: 'B2' },
  { max: 113, cefr: 'C1' },
  { max: Infinity, cefr: 'C2' },
];
const IELTS_BANDS: Band[] = [
  { max: 3.5, cefr: 'A2' },
  { max: 5.0, cefr: 'B1' },
  { max: 6.5, cefr: 'B2' },
  { max: 8.0, cefr: 'C1' },
  { max: Infinity, cefr: 'C2' },
];

/** 英検 grade labels → CEFR (fixed; not a numeric scale). */
const EIKEN_TO_CEFR: Record<string, Cefr> = {
  '準2': 'A2',
  '2': 'B1',
  '準1': 'B2',
  '1': 'C1',
};

function bandLookup(bands: Band[], score: number): Cefr {
  for (const b of bands) if (score <= b.max) return b.cefr;
  return bands[bands.length - 1]!.cefr;
}

function examToCefr(criterion: ExamCriterion): Cefr {
  if (criterion.kind === 'eiken') {
    return EIKEN_TO_CEFR[criterion.value.trim()] ?? 'B1'; // unknown grade → mid-scale default
  }
  const score = Number.parseFloat(criterion.value);
  if (!Number.isFinite(score)) return 'B1';
  if (criterion.kind === 'toeic') return bandLookup(TOEIC_BANDS, score);
  if (criterion.kind === 'toefl') return bandLookup(TOEFL_BANDS, score);
  return bandLookup(IELTS_BANDS, score); // ielts
}

function cefrToExam(cefr: Cefr): ExamDisplay {
  return DISPLAY[cefr];
}

function optionsFor(kind: ExamKind): ExamCriterion[] {
  return [...OPTIONS[kind]]
    .sort((a, b) => CEFR_RANK[a.cefr] - CEFR_RANK[b.cefr])
    .map((o) => ({ kind, value: o.value }));
}

export const examScale: ExamScale = { examToCefr, cefrToExam, optionsFor };

/** Reverse pivot: pick a representative exam criterion for a CEFR (used by v1→v2 migration seed). */
export function cefrToDefaultExam(cefr: Cefr, kind: ExamKind = 'eiken'): ExamCriterion {
  const opts = OPTIONS[kind];
  const exact = opts.find((o) => o.cefr === cefr);
  if (exact) return { kind, value: exact.value };
  // C2 has no 英検/TOEIC option — fall back to the highest available for that exam.
  const highest = [...opts].sort((a, b) => CEFR_RANK[b.cefr] - CEFR_RANK[a.cefr])[0]!;
  return { kind, value: highest.value };
}

/** Exposed for reuse by the picker UI (ascending CEFR order). */
export { CEFR_ORDER };
