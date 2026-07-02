// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StoryDirectoryScreen } from './StoryDirectoryScreen';
import type { StoryPlan } from '../../types/domain';

const PLAN: StoryPlan = {
  storyId: 's1',
  contentType: 'long_story',
  genre: 'fantasy',
  titleJa: '星の継承者',
  synopsisJa: '少女が星を継ぐ物語。',
  characters: [{ name: 'Mia', role: '主人公', descriptionJa: '好奇心旺盛な少女' }],
  chapters: [
    { index: 0, headingJa: '第一章 旅立ち', beatJa: '' },
    { index: 1, headingJa: '第二章 星の門', beatJa: '' },
  ],
};

describe('<StoryDirectoryScreen/>', () => {
  it('shows synopsis, characters, and opens a generated chapter', () => {
    const onOpenChapter = vi.fn();
    render(
      <StoryDirectoryScreen
        plan={PLAN}
        chapters={[
          { chapterIndex: 0, headingJa: '第一章 旅立ち', generated: true },
          { chapterIndex: 1, headingJa: '第二章 星の門', generated: false },
        ]}
        onOpenChapter={onOpenChapter}
      />,
    );
    expect(screen.getByText('星の継承者')).toBeTruthy();
    expect(screen.getByText('少女が星を継ぐ物語。')).toBeTruthy();
    expect(screen.getByText('Mia')).toBeTruthy();

    fireEvent.click(screen.getByText('第一章 旅立ち'));
    expect(onOpenChapter).toHaveBeenCalledWith(0);

    // The ungenerated chapter is marked and does not navigate.
    expect(screen.getByText('未生成')).toBeTruthy();
    fireEvent.click(screen.getByText('第二章 星の門'));
    expect(onOpenChapter).toHaveBeenCalledTimes(1);
  });
});
