// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StoryCharacterDetailScreen } from './StoryCharacterDetailScreen';
import type { StoryPlan } from '../../types/domain';

const PLAN: StoryPlan = {
  storyId: 's1',
  contentType: 'long_story',
  genre: 'fantasy',
  titleJa: '星の継承者',
  synopsisJa: '少女が星を継ぐ物語。',
  characters: [
    {
      name: 'Mia',
      role: '主人公',
      descriptionJa: '好奇心旺盛な少女',
      portraitIllustrationUrl: 'data:image/png;base64,PORTRAIT',
      fullBodyIllustrationUrl: 'data:image/png;base64,FULLBODY',
    },
  ],
  chapters: [{ index: 0, headingJa: '第一章', beatJa: '' }],
};

describe('<StoryCharacterDetailScreen/>', () => {
  it('renders the character full-body image and profile', () => {
    const onBack = vi.fn();
    render(<StoryCharacterDetailScreen plan={PLAN} characterIndex={0} onBack={onBack} />);

    expect(screen.getByText('星の継承者')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Mia' })).toBeTruthy();
    expect(screen.getByText('主人公')).toBeTruthy();
    expect(screen.getByText('好奇心旺盛な少女')).toBeTruthy();
    expect((screen.getByAltText('Mia の全身') as HTMLImageElement).src).toContain('FULLBODY');

    fireEvent.click(screen.getByText('物語へ戻る'));
    expect(onBack).toHaveBeenCalled();
  });

  it('offers full-body regeneration with busy and error states', () => {
    const onRegenerateFullBody = vi.fn();
    const withoutFullBody = { ...PLAN.characters[0]! };
    delete withoutFullBody.fullBodyIllustrationUrl;
    render(
      <StoryCharacterDetailScreen
        plan={{ ...PLAN, characters: [withoutFullBody] }}
        characterIndex={0}
        onRegenerateFullBody={onRegenerateFullBody}
        regeneratingFullBody
        illustrationError="全身イラストを生成できませんでした。"
      />,
    );

    expect(screen.getByTestId('character-full-body-loading')).toBeTruthy();
    expect(screen.queryByAltText('Mia の全身')).toBeNull();
    const button = screen.getByTestId('regenerate-character-full-body') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('生成中…')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('全身イラストを生成できませんでした。');

    fireEvent.click(button);
    expect(onRegenerateFullBody).not.toHaveBeenCalled();
  });
});
