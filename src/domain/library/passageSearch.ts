/**
 * L1 — passageSearch: pure ranking over a learner's stored passages for the Library screen.
 * Full-text (title + intent label + level + English tokens + Japanese translation), but WEIGHTED so
 * a title match outranks a theme/level match, which outranks a body/translation match (design.md §3.4).
 * Story chapters collapse into a single directory entry keyed by `storyRef.storyId`; a story matches
 * when ANY of its chapters matches. No I/O — the caller supplies the passages and story titles.
 */

import type { PassageRecord } from '../../types/ports';
import type { LearningIntent } from '../../types/domain';

/** Japanese labels for the closed learning-intent set (drives theme matching + display). */
export const INTENT_LABELS: Record<LearningIntent, string> = {
  business: 'ビジネス',
  daily: '日常会話',
  toeic: 'TOEIC',
  eiken: '英検',
  academic: 'アカデミック',
  travel: '旅行',
};

export interface StoryGroup {
  kind: 'story';
  storyId: string;
  title: string;
  chapterCount: number;
  /** Newest chapter (drives recency ordering + a "continue" link target). */
  latest: PassageRecord;
}

export interface ArticleHit {
  kind: 'article';
  passage: PassageRecord;
}

export type LibraryEntry = StoryGroup | ArticleHit;

const WEIGHT = { title: 100, meta: 10, body: 1 } as const;

/** Score one passage against a lowercased query (0 = no match). */
function scorePassage(passage: PassageRecord['passage'], q: string): number {
  let score = 0;
  if (passage.meta.title.toLowerCase().includes(q)) score += WEIGHT.title;
  const metaText = `${INTENT_LABELS[passage.meta.intent]} ${passage.meta.intent} ${passage.meta.level}`.toLowerCase();
  if (metaText.includes(q)) score += WEIGHT.meta;
  for (const sentence of passage.sentences) {
    const body = `${sentence.tokens.join(' ')} ${sentence.translationJa}`.toLowerCase();
    if (body.includes(q)) {
      score += WEIGHT.body;
      break; // one body hit is enough to rank; avoids O(sentences) inflation
    }
  }
  return score;
}

export function passageSearch(
  passages: PassageRecord[],
  query: string,
  storyTitles: Record<string, string> = {},
): LibraryEntry[] {
  const q = query.trim().toLowerCase();

  // Partition into standalone articles and story-chapter groups.
  const articles: PassageRecord[] = [];
  const storyChapters = new Map<string, PassageRecord[]>();
  for (const rec of passages) {
    const storyId = rec.passage.meta.storyRef?.storyId;
    if (storyId) {
      const list = storyChapters.get(storyId) ?? [];
      list.push(rec);
      storyChapters.set(storyId, list);
    } else {
      articles.push(rec);
    }
  }

  type Scored = { entry: LibraryEntry; score: number; createdAt: number };
  const scored: Scored[] = [];

  for (const rec of articles) {
    const score = q ? scorePassage(rec.passage, q) : 0;
    if (q && score === 0) continue;
    scored.push({ entry: { kind: 'article', passage: rec }, score, createdAt: rec.createdAt });
  }

  for (const [storyId, chapters] of storyChapters) {
    const latest = chapters.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
    const score = q ? Math.max(...chapters.map((c) => scorePassage(c.passage, q))) : 0;
    if (q && score === 0) continue;
    const title = storyTitles[storyId] ?? latest.passage.meta.title;
    scored.push({
      entry: { kind: 'story', storyId, title, chapterCount: chapters.length, latest },
      score,
      createdAt: latest.createdAt,
    });
  }

  scored.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt);
  return scored.map((s) => s.entry);
}
