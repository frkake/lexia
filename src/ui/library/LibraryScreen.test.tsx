// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LibraryScreen } from './LibraryScreen';
import type { PassageRecord } from '../../types/ports';
import type { PassageOutput, ReadingProgress, UserId } from '../../types/domain';

function progressRec(passageId: string, status: ReadingProgress['status'], percent: number): ReadingProgress {
  return {
    userId: 'u' as UserId,
    passageId,
    sentenceIndex: 0,
    percent,
    status,
    startedAt: 0,
    lastOpenedAt: 0,
    completedAt: status === 'completed' ? 1 : undefined,
  };
}

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

  // ── D-4: thumbnails, meta, progress, story badge ─────────────────────────────
  it('renders a scene thumbnail when present and a category-initial placeholder otherwise', () => {
    const withImg = article('a1', 'Ocean Currents', 1);
    withImg.passage.meta.sceneIllustrationUrl = 'data:image/png;base64,ZZZ';
    const { container } = render(<LibraryScreen passages={[withImg, article('a2', 'Markets', 2)]} />);
    expect(container.querySelector('img[src="data:image/png;base64,ZZZ"]')).toBeTruthy();
    // The scene-less article shows its initial (M) as a placeholder instead of an image.
    expect(screen.getByText('M')).toBeTruthy();
  });

  it('prefers the downscaled sceneThumbnailUrl over the full-size illustration (D-4 第2段)', () => {
    const a = article('a1', 'Ocean Currents', 1);
    a.passage.meta.sceneIllustrationUrl = 'data:image/png;base64,FULL';
    a.passage.meta.sceneThumbnailUrl = 'data:image/jpeg;base64,THUMB';
    const { container } = render(<LibraryScreen passages={[a]} />);
    expect(container.querySelector('img[src="data:image/jpeg;base64,THUMB"]')).toBeTruthy();
    expect(container.querySelector('img[src="data:image/png;base64,FULL"]')).toBeNull();
  });

  it('renders the meta line: intent · level · words · date', () => {
    const a = article('a1', 'Ocean Currents', new Date(2026, 5, 28).getTime());
    a.passage.meta.approxWords = 320;
    render(<LibraryScreen passages={[a]} />);
    expect(screen.getByText(/日常会話 · B1 · 320語 · 6\/28/)).toBeTruthy();
  });

  it('shows read state per row: 読了 / 続きから% / 未読', () => {
    render(
      <LibraryScreen
        passages={[article('a1', 'A', 3), article('a2', 'B', 2), article('a3', 'C', 1)]}
        progress={{ a1: progressRec('a1', 'completed', 100), a2: progressRec('a2', 'in_progress', 45) }}
      />,
    );
    expect(screen.getByTestId('status-completed').textContent).toContain('読了');
    expect(screen.getByTestId('status-progress').textContent).toContain('45');
    expect(screen.getByTestId('status-unread')).toBeTruthy(); // a3 has no progress record
  });

  it('marks a story directory with a「物語 · 全N章」badge and routes to the story', () => {
    const onOpenStory = vi.fn();
    render(
      <LibraryScreen
        passages={[chapter('s1', 0, 'Ch1'), chapter('s1', 1, 'Ch2')]}
        storyTitles={{ s1: 'Saga' }}
        onOpenStory={onOpenStory}
      />,
    );
    expect(screen.getByText('物語 · 全2章')).toBeTruthy();
    fireEvent.click(screen.getByText('Saga'));
    expect(onOpenStory).toHaveBeenCalledWith('s1');
  });
});
