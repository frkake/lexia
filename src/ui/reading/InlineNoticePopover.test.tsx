// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { InlineNoticePopover } from './InlineNoticePopover';
import { noticeStyle } from '../theme/tokens';
import type { NoticeCue } from '../../types/domain';

const cue: NoticeCue = {
  index: 3,
  span: { sentenceIndex: 0, tokenStart: 1, tokenEnd: 4 },
  category: 'phrase',
  anchorText: 'closed the deal',
  explanationJa: '取引を成立させる定型表現。',
};

describe('<InlineNoticePopover/>', () => {
  it('renders the category chip and the explanation, and closes on the close button', () => {
    const onClose = vi.fn();
    const { getByTestId, getByText } = render(<InlineNoticePopover cue={cue} displayIndex={2} onClose={onClose} />);

    const popover = getByTestId('inline-notice-popover-3');
    expect(popover.getAttribute('role')).toBe('dialog');
    expect(getByText(noticeStyle('phrase').label)).toBeTruthy(); // フレーズ
    expect(popover.textContent).toContain('取引を成立させる定型表現。');

    fireEvent.click(getByTestId('inline-notice-close-3'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is absolutely positioned under the badge so it overlays rather than reflows the prose', () => {
    const { getByTestId } = render(<InlineNoticePopover cue={cue} onClose={vi.fn()} />);
    const popover = getByTestId('inline-notice-popover-3');
    expect(popover.style.position).toBe('absolute');
    expect(popover.style.top).toBe('100%');
  });

  it('stops a tap inside it from bubbling to the badge (which would toggle it shut)', () => {
    const onClose = vi.fn();
    const { getByTestId } = render(
      <span onClick={onClose}>
        <InlineNoticePopover cue={cue} onClose={vi.fn()} />
      </span>,
    );
    // A click on the popover body must not reach the wrapping badge handler.
    fireEvent.click(getByTestId('inline-notice-popover-3'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
