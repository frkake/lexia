// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MasteryDot, masteryDotColor } from './MasteryDot';

describe('masteryDotColor', () => {
  it('maps each mastery stage to its semantic token', () => {
    expect(masteryDotColor('Learning')).toBe('#8FB0DA');
    expect(masteryDotColor('Consolidating')).toBe('#4C7BC0');
    expect(masteryDotColor('Mastered')).toBe('#4C9A86');
    expect(masteryDotColor('New')).toBe('#C4CCD6');
  });

  it('falls back to the inactive color when no stage is given', () => {
    expect(masteryDotColor(undefined)).toBe('#CBD3DD');
  });
});

describe('<MasteryDot/>', () => {
  it('renders a circular dot tagged with its stage', () => {
    const { getByTestId } = render(<MasteryDot stage="Consolidating" />);
    const dot = getByTestId('mastery-dot');
    expect(dot.getAttribute('data-stage')).toBe('Consolidating');
    expect(dot.style.borderRadius).toBe('50%');
  });

  it('marks a stage-less dot as inactive', () => {
    const { getByTestId } = render(<MasteryDot />);
    expect(getByTestId('mastery-dot').getAttribute('data-stage')).toBe('inactive');
  });
});
