// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { StoryPlanReview } from './StoryPlanReview';
import type { StoryPlan } from '../../types/domain';

function plan(over: Partial<StoryPlan> = {}): StoryPlan {
  return {
    storyId: 's1',
    contentType: 'long_story',
    genre: 'fantasy',
    titleJa: '竜の物語',
    synopsisJa: '竜と少女が世界を救う冒険。',
    characters: [
      { name: 'Aria', role: '主人公', descriptionJa: '勇敢な少女' },
      { name: 'Draco', role: '相棒', descriptionJa: '孤独な竜' },
    ],
    chapters: [
      { index: 0, headingJa: '第一章 出会い', beatJa: '少女が竜と出会う' },
      { index: 1, headingJa: '第二章 試練', beatJa: '二人が試練に挑む' },
    ],
    ...over,
  };
}

describe('<StoryPlanReview/> (Requirement 6.3 confirmation gate)', () => {
  it('shows the generated characters and plot for review', () => {
    const { getByText } = render(<StoryPlanReview plan={plan()} onConfirm={() => {}} />);
    expect(getByText('竜の物語')).toBeTruthy();
    expect(getByText(/竜と少女が世界を救う冒険。/)).toBeTruthy();
    expect(getByText('Aria')).toBeTruthy();
    expect(getByText('Draco')).toBeTruthy();
    expect(getByText(/第一章 出会い/)).toBeTruthy();
  });

  it('emits the (possibly edited) plan on confirm — the gate to body generation', () => {
    const onConfirm = vi.fn<(p: StoryPlan) => void>();
    const { getByText } = render(<StoryPlanReview plan={plan()} onConfirm={onConfirm} />);
    fireEvent.click(getByText('この設定で執筆する'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]![0].storyId).toBe('s1');
  });

  it('lets the learner edit the synopsis before confirming (6.3 edit)', () => {
    const onConfirm = vi.fn<(p: StoryPlan) => void>();
    const { getByLabelText, getByText } = render(<StoryPlanReview plan={plan()} onConfirm={onConfirm} />);
    fireEvent.change(getByLabelText('あらすじ'), { target: { value: '新しいあらすじ' } });
    fireEvent.click(getByText('この設定で執筆する'));
    expect(onConfirm.mock.calls[0]![0].synopsisJa).toBe('新しいあらすじ');
  });

  it('does not confirm on mount (no body generation until the gate is passed)', () => {
    const onConfirm = vi.fn();
    render(<StoryPlanReview plan={plan()} onConfirm={onConfirm} />);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('offers a cancel/regenerate affordance when provided', () => {
    const onCancel = vi.fn();
    const { getByText } = render(<StoryPlanReview plan={plan()} onConfirm={() => {}} onCancel={onCancel} />);
    fireEvent.click(getByText('やり直す'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
