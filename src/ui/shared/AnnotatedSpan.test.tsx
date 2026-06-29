// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { AnnotatedSpan, annotationStyle } from './AnnotatedSpan';

describe('annotationStyle', () => {
  it('underlines the three mastery densities per the encoding table', () => {
    expect(annotationStyle('new').borderBottom).toBe('1.5px solid #4C7BC0');
    expect(annotationStyle('review').borderBottom).toBe('1.5px solid #8FB0DA');
    expect(annotationStyle('known').borderBottom).toBe('1.5px dotted #C4CCD6');
  });

  it('renders the brand-new keyword as a filled white-on-primary chip', () => {
    const s = annotationStyle('keyword');
    expect(s.background).toBe('#3D6CB0');
    expect(s.color).toBe('#fff');
  });

  it('renders a collocation as a tinted clamped chip', () => {
    const s = annotationStyle('collocation');
    expect(s.background).toBe('#E4EDF8');
    expect(s.WebkitBoxDecorationBreak).toBe('clone');
  });

  it('emphasizes the active (TTS follow-along) token in primary italic', () => {
    const s = annotationStyle('review', true);
    expect(s.color).toBe('#3D6CB0');
    expect(s.fontStyle).toBe('italic');
  });
});

describe('<AnnotatedSpan/>', () => {
  it('renders the surface text and tags its kind', () => {
    const { getByText } = render(<AnnotatedSpan kind="new">restless</AnnotatedSpan>);
    const el = getByText('restless');
    expect(el.getAttribute('data-kind')).toBe('new');
  });

  it('is a keyboard-operable button when selectable and fires onSelect', () => {
    const onSelect = vi.fn();
    const { getByRole } = render(
      <AnnotatedSpan kind="new" onSelect={onSelect}>
        candid
      </AnnotatedSpan>,
    );
    const btn = getByRole('button');
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('is not a button when not selectable', () => {
    const { queryByRole, getByText } = render(<AnnotatedSpan kind="known">erode</AnnotatedSpan>);
    expect(queryByRole('button')).toBeNull();
    expect(getByText('erode').getAttribute('data-active')).toBe('false');
  });
});
