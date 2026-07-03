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
    expect(getByText('物語全体の概要')).toBeTruthy();
    expect(getByText('キャラクター設定')).toBeTruthy();
    expect(getByText('プロット')).toBeTruthy();
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
    fireEvent.change(getByLabelText('物語全体の概要'), { target: { value: '新しいあらすじ' } });
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

  it('renders a character portrait when the plan carries an illustrationUrl (6.8)', () => {
    const withArt = plan({
      characters: [{ name: 'Aria', role: '主人公', descriptionJa: '勇敢な少女', illustrationUrl: 'data:image/png;base64,QUJD' }],
    });
    const { getByAltText } = render(<StoryPlanReview plan={withArt} onConfirm={() => {}} />);
    const img = getByAltText('Aria') as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.src).toContain('data:image/png;base64,QUJD');
  });

  it('shows a loading skeleton for a character still being illustrated', () => {
    const { getAllByTestId } = render(<StoryPlanReview plan={plan()} onConfirm={() => {}} illustrating />);
    // Two characters, neither has a URL yet ⇒ two skeletons.
    expect(getAllByTestId('character-portrait-loading')).toHaveLength(2);
  });

  it('allows confirmation while character portraits are still loading', () => {
    const onConfirm = vi.fn<(p: StoryPlan) => void>();
    const { getByText } = render(<StoryPlanReview plan={plan()} onConfirm={onConfirm} illustrating />);
    fireEvent.click(getByText('この設定で執筆する'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('shows a monogram placeholder when illustration is absent and not in progress', () => {
    const { getAllByTestId, queryByRole } = render(<StoryPlanReview plan={plan()} onConfirm={() => {}} />);
    expect(getAllByTestId('character-portrait-placeholder')).toHaveLength(2);
    expect(queryByRole('img')).toBeNull();
  });

  it('still confirms via the explicit button when portraits are shown', () => {
    const onConfirm = vi.fn<(p: StoryPlan) => void>();
    const withArt = plan({
      characters: [{ name: 'Aria', role: '主人公', descriptionJa: '勇敢な少女', illustrationUrl: 'data:image/png;base64,QUJD' }],
    });
    const { getByText } = render(<StoryPlanReview plan={withArt} onConfirm={onConfirm} illustrating />);
    fireEvent.click(getByText('この設定で執筆する'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // The confirmed plan carries the illustration through to persistence.
    expect(onConfirm.mock.calls[0]![0].characters[0]!.illustrationUrl).toBe('data:image/png;base64,QUJD');
  });

  it('offers per-character portrait regeneration when wired', () => {
    const onRegenerateCharacter = vi.fn();
    const { getByTestId } = render(
      <StoryPlanReview plan={plan()} onConfirm={() => {}} onRegenerateCharacter={onRegenerateCharacter} />,
    );
    fireEvent.click(getByTestId('regenerate-character-portrait-1'));
    expect(onRegenerateCharacter).toHaveBeenCalledWith(1);
  });

  it('shows portrait regeneration busy and error states', () => {
    const { getByTestId, getByRole, getByText } = render(
      <StoryPlanReview
        plan={plan()}
        onConfirm={() => {}}
        onRegenerateCharacter={() => {}}
        regeneratingCharacterIndex={0}
        characterIllustrationError="キャラクターイラストを再生成できませんでした。"
      />,
    );
    const active = getByTestId('regenerate-character-portrait-0') as HTMLButtonElement;
    const other = getByTestId('regenerate-character-portrait-1') as HTMLButtonElement;
    expect(active.disabled).toBe(true);
    expect(active.getAttribute('aria-busy')).toBe('true');
    expect(other.disabled).toBe(true);
    expect(getByText('生成中…')).toBeTruthy();
    expect(getByRole('alert').textContent).toContain('キャラクターイラストを再生成できませんでした。');
  });

  it('disables portrait regeneration while initial illustration is still in progress', () => {
    const { getByTestId } = render(
      <StoryPlanReview plan={plan()} onConfirm={() => {}} onRegenerateCharacter={() => {}} illustrating />,
    );
    expect((getByTestId('regenerate-character-portrait-0') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows body-generation progress and errors on the confirmation gate', () => {
    const onConfirm = vi.fn<(p: StoryPlan) => void>();
    const { getByRole, getByText } = render(
      <StoryPlanReview plan={plan()} onConfirm={onConfirm} confirming confirmError="本文生成に失敗しました。" />,
    );
    const button = getByRole('button', { name: '執筆しています…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(getByText('本文生成に失敗しました。')).toBeTruthy();
    fireEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
