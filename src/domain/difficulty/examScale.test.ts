import { describe, it, expect } from 'vitest';
import { examScale } from './examScale';
import type { Cefr, ExamKind } from '../../types/domain';

describe('examScale.examToCefr', () => {
  it('maps each 英検 grade to its CEFR pivot (research table)', () => {
    expect(examScale.examToCefr({ kind: 'eiken', value: '準2' })).toBe('A2');
    expect(examScale.examToCefr({ kind: 'eiken', value: '2' })).toBe('B1');
    expect(examScale.examToCefr({ kind: 'eiken', value: '準1' })).toBe('B2');
    expect(examScale.examToCefr({ kind: 'eiken', value: '1' })).toBe('C1');
  });

  it('maps a TOEIC score to its CEFR band', () => {
    expect(examScale.examToCefr({ kind: 'toeic', value: '400' })).toBe('A2');
    expect(examScale.examToCefr({ kind: 'toeic', value: '600' })).toBe('B1');
    expect(examScale.examToCefr({ kind: 'toeic', value: '800' })).toBe('B2');
    expect(examScale.examToCefr({ kind: 'toeic', value: '960' })).toBe('C1');
  });

  it('maps a TOEFL iBT total to its CEFR band including C2', () => {
    expect(examScale.examToCefr({ kind: 'toefl', value: '30' })).toBe('A2');
    expect(examScale.examToCefr({ kind: 'toefl', value: '50' })).toBe('B1');
    expect(examScale.examToCefr({ kind: 'toefl', value: '80' })).toBe('B2');
    expect(examScale.examToCefr({ kind: 'toefl', value: '100' })).toBe('C1');
    expect(examScale.examToCefr({ kind: 'toefl', value: '117' })).toBe('C2');
  });

  it('maps an IELTS band to its CEFR band including C2', () => {
    expect(examScale.examToCefr({ kind: 'ielts', value: '3.0' })).toBe('A2');
    expect(examScale.examToCefr({ kind: 'ielts', value: '4.5' })).toBe('B1');
    expect(examScale.examToCefr({ kind: 'ielts', value: '6.0' })).toBe('B2');
    expect(examScale.examToCefr({ kind: 'ielts', value: '7.5' })).toBe('C1');
    expect(examScale.examToCefr({ kind: 'ielts', value: '9.0' })).toBe('C2');
  });

  it('clamps an out-of-range value to the nearest CEFR (never throws)', () => {
    expect(examScale.examToCefr({ kind: 'toeic', value: '10' })).toBe('A2');
    expect(examScale.examToCefr({ kind: 'toeic', value: '9999' })).toBe('C1');
    expect(examScale.examToCefr({ kind: 'toefl', value: '999' })).toBe('C2');
    expect(examScale.examToCefr({ kind: 'eiken', value: 'garbage' })).toBe('B1');
  });
});

describe('examScale.cefrToExam', () => {
  it('returns the full conversion row for B2 (all measured)', () => {
    const row = examScale.cefrToExam('B2');
    expect(row).toEqual({ cefr: 'B2', eiken: '準1級', toeic: '785–944', toefl: '72–94', ielts: '5.5–6.5' });
  });

  it('marks TOEIC L&R and 英検 as n/a at C2 (out of measurement range)', () => {
    const row = examScale.cefrToExam('C2');
    expect(row.eiken).toBe('n/a');
    expect(row.toeic).toBe('n/a');
    expect(row.toefl).toBe('114–120');
    expect(row.ielts).toBe('8.5–9.0');
  });

  it('covers every CEFR level with a matching cefr field', () => {
    const levels: Cefr[] = ['A2', 'B1', 'B2', 'C1', 'C2'];
    for (const l of levels) expect(examScale.cefrToExam(l).cefr).toBe(l);
  });
});

describe('examScale.optionsFor', () => {
  it('returns options in ascending CEFR order that each map back to that CEFR', () => {
    const kinds: ExamKind[] = ['eiken', 'toeic', 'toefl', 'ielts'];
    for (const kind of kinds) {
      const opts = examScale.optionsFor(kind);
      expect(opts.length).toBeGreaterThan(0);
      const cefrs = opts.map((o) => examScale.examToCefr(o));
      const rank: Record<Cefr, number> = { A2: 0, B1: 1, B2: 2, C1: 3, C2: 4 };
      const ranks = cefrs.map((c) => rank[c]);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      opts.forEach((o) => expect(o.kind).toBe(kind));
    }
  });

  it('omits C2 for 英検 and TOEIC (they do not measure it) but includes it for TOEFL and IELTS', () => {
    expect(examScale.optionsFor('eiken').map((o) => examScale.examToCefr(o))).not.toContain('C2');
    expect(examScale.optionsFor('toeic').map((o) => examScale.examToCefr(o))).not.toContain('C2');
    expect(examScale.optionsFor('toefl').map((o) => examScale.examToCefr(o))).toContain('C2');
    expect(examScale.optionsFor('ielts').map((o) => examScale.examToCefr(o))).toContain('C2');
  });
});
