// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { WordTargetSlider } from './WordTargetSlider';

describe('<WordTargetSlider/>', () => {
  it('renders a 100-step slider bounded by the content-type range (7.1/7.3)', () => {
    const { getByLabelText } = render(
      <WordTargetSlider contentType="article" value={400} onChange={() => {}} />,
    );
    const slider = getByLabelText('文章の長さ') as HTMLInputElement;
    expect(slider.min).toBe('100'); // article min
    expect(slider.max).toBe('1500'); // article max
    expect(slider.step).toBe('100');
    expect(slider.value).toBe('400');
  });

  it('uses the short-story range when the content type is a story (7.3)', () => {
    const { getByLabelText } = render(
      <WordTargetSlider contentType="short_story" value={800} onChange={() => {}} />,
    );
    const slider = getByLabelText('文章の長さ') as HTMLInputElement;
    expect(slider.min).toBe('500');
    expect(slider.max).toBe('3000');
  });

  it('emits the chosen word count on change (7.1)', () => {
    const onChange = vi.fn<(n: number) => void>();
    const { getByLabelText } = render(
      <WordTargetSlider contentType="article" value={400} onChange={onChange} />,
    );
    fireEvent.change(getByLabelText('文章の長さ'), { target: { value: '700' } });
    expect(onChange).toHaveBeenCalledWith(700);
  });

  it('shows the current word count and an approximate page count (7.2)', () => {
    const { getByText } = render(
      <WordTargetSlider contentType="article" value={550} onChange={() => {}} />,
    );
    // 550 words ≒ 2 pages at 275 words/page.
    expect(getByText(/550/)).toBeTruthy();
    expect(getByText(/2\s*ページ/)).toBeTruthy();
  });
});
