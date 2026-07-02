// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LibraryScreen } from './LibraryScreen';
import type { PassageRecord } from '../../types/ports';
import type { PassageOutput, UserId } from '../../types/domain';

function article(passageId: string, title: string, createdAt: number): PassageRecord {
  const passage: PassageOutput = {
    meta: { title, intent: 'daily', level: 'B1', newCount: 0, reviewCount: 0, approxWords: 0 },
    sentences: [],
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [],
  };
  return { passageId, userId: 'u' as UserId, createdAt, passage };
}

function chapter(storyId: string, chapterIndex: number, title: string): PassageRecord {
  const rec = article(`${storyId}:${chapterIndex}`, title, 100 + chapterIndex);
  rec.passage.meta.storyRef = { storyId, chapterIndex };
  return rec;
}

describe('<LibraryScreen/>', () => {
  it('lists articles and story directories, and routes clicks to the right handler', () => {
    const onOpenArticle = vi.fn();
    const onOpenStory = vi.fn();
    render(
      <LibraryScreen
        passages={[article('a1', 'Ocean Currents', 200), chapter('s1', 0, 'Saga Ch.1')]}
        storyTitles={{ s1: 'My Saga' }}
        onOpenArticle={onOpenArticle}
        onOpenStory={onOpenStory}
      />,
    );
    fireEvent.click(screen.getByText('Ocean Currents'));
    expect(onOpenArticle).toHaveBeenCalledWith('a1');
    fireEvent.click(screen.getByText('My Saga'));
    expect(onOpenStory).toHaveBeenCalledWith('s1');
  });

  it('filters as the query changes and shows an empty state on no match', () => {
    render(<LibraryScreen passages={[article('a1', 'Ocean Currents', 200), article('a2', 'Markets', 100)]} />);
    const box = screen.getByLabelText('文章を検索');
    fireEvent.change(box, { target: { value: 'ocean' } });
    expect(screen.getByText('Ocean Currents')).toBeTruthy();
    expect(screen.queryByText('Markets')).toBeNull();
    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(screen.getByText('該当する文章がありません')).toBeTruthy();
  });
});
