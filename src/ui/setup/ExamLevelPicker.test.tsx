// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ExamLevelPicker } from './ExamLevelPicker';
import type { ExamCriterion } from '../../types/domain';

describe('<ExamLevelPicker/>', () => {
  it('offers all four exam scales and lets the learner switch between them (9.1)', () => {
    const { getByTestId } = render(<ExamLevelPicker value={{ kind: 'eiken', value: '2' }} onChange={() => {}} />);
    expect(getByTestId('exam-kind-eiken')).toBeTruthy();
    expect(getByTestId('exam-kind-toeic')).toBeTruthy();
    expect(getByTestId('exam-kind-toefl')).toBeTruthy();
    expect(getByTestId('exam-kind-ielts')).toBeTruthy();
  });

  it('emits the selected criterion when a value option is chosen (9.1)', () => {
    const onChange = vi.fn<(c: ExamCriterion) => void>();
    const { getByTestId } = render(<ExamLevelPicker value={{ kind: 'toeic', value: '600' }} onChange={onChange} />);
    fireEvent.click(getByTestId('exam-value-800'));
    expect(onChange).toHaveBeenCalledWith({ kind: 'toeic', value: '800' });
  });

  it('switches the value set when a different exam kind is chosen, snapping to a same-CEFR value', () => {
    const onChange = vi.fn<(c: ExamCriterion) => void>();
    // eiken 準1 ⇒ B2. Switching to toeic should propose a B2-equivalent toeic value.
    const { getByTestId } = render(<ExamLevelPicker value={{ kind: 'eiken', value: '準1' }} onChange={onChange} />);
    fireEvent.click(getByTestId('exam-kind-toeic'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0]![0];
    expect(emitted.kind).toBe('toeic');
  });

  it('shows the approximate cross-exam conversion for the selected level (9.2)', () => {
    // eiken 準1 ⇒ B2 ⇒ TOEIC 785–944, TOEFL 72–94, IELTS 5.5–6.5.
    const { getByTestId } = render(<ExamLevelPicker value={{ kind: 'eiken', value: '準1' }} onChange={() => {}} />);
    const table = getByTestId('exam-conversion');
    expect(table.textContent).toContain('785–944');
    expect(table.textContent).toContain('72–94');
    expect(table.textContent).toContain('5.5–6.5');
  });

  it('marks the out-of-range cells as n/a at the top CEFR (9.2)', () => {
    // ielts 9.0 ⇒ C2 ⇒ TOEIC & 英検 are n/a.
    const { getByTestId } = render(<ExamLevelPicker value={{ kind: 'ielts', value: '9.0' }} onChange={() => {}} />);
    expect(getByTestId('exam-conversion').textContent).toContain('n/a');
  });

  it('offers a direct score input for TOEIC with its scale range (A-3-1)', () => {
    const { getByTestId } = render(<ExamLevelPicker value={{ kind: 'toeic', value: '800' }} onChange={() => {}} />);
    const input = getByTestId('exam-score-input') as HTMLInputElement;
    expect(input.value).toBe('800');
    expect(input.getAttribute('min')).toBe('10');
    expect(input.getAttribute('max')).toBe('990');
  });

  it('emits the typed score verbatim as the criterion value so 900 ≠ 800 downstream (A-3-1)', () => {
    const onChange = vi.fn<(c: ExamCriterion) => void>();
    const { getByTestId } = render(<ExamLevelPicker value={{ kind: 'toeic', value: '800' }} onChange={onChange} />);
    fireEvent.change(getByTestId('exam-score-input'), { target: { value: '900' } });
    expect(onChange).toHaveBeenCalledWith({ kind: 'toeic', value: '900' });
  });

  it('hides the numeric input for 英検 (fixed grades, not a numeric scale) (A-3-1)', () => {
    const { queryByTestId } = render(<ExamLevelPicker value={{ kind: 'eiken', value: '2' }} onChange={() => {}} />);
    expect(queryByTestId('exam-score-input')).toBeNull();
  });

  it('prefixes the conversion row with the resolved CEFR level (A-3-3)', () => {
    // 英検準1 ⇒ B2; the row now names the CEFR pivot alongside the cross-exam bands.
    const { getByTestId } = render(<ExamLevelPicker value={{ kind: 'eiken', value: '準1' }} onChange={() => {}} />);
    expect(getByTestId('exam-conversion').textContent).toContain('CEFR B2');
  });
});
