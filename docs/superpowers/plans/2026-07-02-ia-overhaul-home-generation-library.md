# IA Overhaul (Home Generation, Library Search, URL Reader) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move passage/story generation to the home page, replace the "読む" tab with URL-addressable passages (`/p/:id`, `/s/:storyId[/:chapter]`), and add a ranked full-text passage library with search.

**Architecture:** Keep the existing session-driven reader; add an `openPassage(deps, userId, passageId)` controller (sibling to `restoreReadingSession`) so a route can hydrate the session from a URL. Add a `PassageRepository.all(userId)` read and a pure `passageSearch` domain function (title ≫ intent/level ≫ body/translation) that also collapses story chapters into one directory entry. New presentational screens (Home, Library, StoryDirectory) are wired by thin route containers, mirroring the current `src/ui/app/routes.tsx` pattern.

**Tech Stack:** React 19, react-router-dom 7, Zustand, Dexie, TanStack Query, Vitest + @testing-library/react (jsdom), TypeScript (strict).

## Global Constraints

- Spec language for all Markdown/report content: **Japanese** (`.kiro/specs/*/spec.json` → `"language": "ja"`). UI copy is Japanese, matching existing screens.
- **No new design tokens.** Use only `src/ui/theme/tokens.ts` (`colors`, `fonts`, `radius`, `shadow`). This is an IA change, not a reskin.
- **No DB schema migration.** Reuse existing stores/indexes (`passages`, `stories`, `progress`). `passageId` format is unchanged (articles = random `p_<ts>_<n>`; story chapters = `${storyId}:${chapterIndex}`).
- **No generation-logic change.** `runGenerationPipeline` already returns `{ ok, passageId, passage, error, audio }` on success — reuse it as-is.
- Tests run on Node ≥20 (nvm v22.23.1): `npm test` (Vitest). Playwright is out of scope (sandbox can't launch it).
- Follow existing layering: domain purity in `src/domain/**`, controllers in `src/state/controllers/**`, presentational screens in `src/ui/**`, route containers in `src/ui/app/routes.tsx`.
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.

---

## File Structure

**Create:**
- `src/domain/library/passageSearch.ts` — pure search/ranking + story-directory collapse.
- `src/domain/library/passageSearch.test.ts` — unit tests.
- `src/ui/library/LibraryScreen.tsx` — presentational library + search box.
- `src/ui/library/LibraryScreen.test.tsx` — unit tests.
- `src/ui/home/HomeScreen.tsx` — generation hero + learning summary strip (composes `SetupScreen` + a summary from `DashboardSnapshot`).
- `src/ui/home/HomeScreen.test.tsx` — unit tests.
- `src/ui/story/StoryDirectoryScreen.tsx` — story directory (synopsis, characters, chapter list).
- `src/ui/story/StoryDirectoryScreen.test.tsx` — unit tests.

**Modify:**
- `src/types/ports.ts` — add `PassageRepository.all(userId)`.
- `src/infra/persistence/passageRepository.ts` — implement `all`.
- `src/infra/persistence/repositories.test.ts` — test `all`.
- `src/state/controllers/sessionBootstrap.ts` — add `openPassage`.
- `src/state/controllers/sessionBootstrap.test.ts` — test `openPassage` (create if absent — see Task 3).
- `src/ui/shared/TopNav.tsx` — 4-tab nav.
- `src/ui/shared/TopNav.test.tsx` — update expectations.
- `src/ui/router.tsx` — new route table.
- `src/ui/router.test.tsx` — update expectations.
- `src/ui/app/routes.tsx` — `HomeRoute`, `LibraryRoute`, `StoryDirectoryRoute`, URL-driven `ReadingRoute`.
- `src/ui/app/routes.test.tsx` — update to new URLs.
- `src/ui/app/storyRoute.test.tsx` — update to new URLs.

---

## Task 1: `PassageRepository.all(userId)`

**Files:**
- Modify: `src/types/ports.ts` (add method to `PassageRepository`)
- Modify: `src/infra/persistence/passageRepository.ts`
- Test: `src/infra/persistence/repositories.test.ts`

**Interfaces:**
- Consumes: existing `PassageRecord`, `LexiaDb.passages`.
- Produces: `PassageRepository.all(userId: UserId): Promise<PassageRecord[]>` — every passage for a learner, `createdAt` descending.

- [ ] **Step 1: Write the failing test**

Append to `src/infra/persistence/repositories.test.ts` (inside the existing top-level `describe`, or a new `describe('DexiePassageRepository.all')`). Match the file's existing setup style (it already opens a `LexiaDb` and uses `createRepositories`). Use this test:

```ts
describe('DexiePassageRepository.all', () => {
  it('returns all passages for the user, newest first, excluding other users', async () => {
    const db = new LexiaDb('all_user');
    await db.open();
    const repos = createRepositories(db);
    const mk = (passageId: string, userId: string, createdAt: number): PassageRecord => ({
      passageId,
      userId: userId as UserId,
      createdAt,
      passage: {
        meta: { title: passageId, intent: 'daily', level: 'B1', newCount: 0, reviewCount: 0, approxWords: 0 },
        sentences: [],
        targetSpans: [],
        collocationSpans: [],
        noticeCues: [],
      },
    });
    await repos.passages.put(mk('a', 'all_user', 100));
    await repos.passages.put(mk('b', 'all_user', 300));
    await repos.passages.put(mk('c', 'all_user', 200));
    await repos.passages.put(mk('x', 'other_user', 999));

    const all = await repos.passages.all('all_user' as UserId);
    expect(all.map((p) => p.passageId)).toEqual(['b', 'c', 'a']);
    db.close();
  });
});
```

Ensure the test file imports `PassageRecord` (from `../../types/ports`) and `UserId` (from `../../types/domain`); add to existing imports if missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/infra/persistence/repositories.test.ts`
Expected: FAIL — `repos.passages.all is not a function` (and/or a TS error that `all` is not on `PassageRepository`).

- [ ] **Step 3: Add the interface method**

In `src/types/ports.ts`, inside `interface PassageRepository`, add after `recent(...)`:

```ts
  /** Every passage for a learner, most-recently created first (library + search input). */
  all(userId: UserId): Promise<PassageRecord[]>;
```

- [ ] **Step 4: Implement in the Dexie repository**

In `src/infra/persistence/passageRepository.ts`, add this method to `DexiePassageRepository` (after `recent`):

```ts
  /** Every passage for a learner, newest first (uses the `createdAt` index). */
  all(userId: UserId): Promise<PassageRecord[]> {
    return this.db.passages
      .orderBy('createdAt')
      .reverse()
      .filter((p) => p.userId === userId)
      .toArray();
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/infra/persistence/repositories.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/ports.ts src/infra/persistence/passageRepository.ts src/infra/persistence/repositories.test.ts
git commit -m "feat(library): add PassageRepository.all(userId)"
```

---

## Task 2: `passageSearch` domain function

**Files:**
- Create: `src/domain/library/passageSearch.ts`
- Test: `src/domain/library/passageSearch.test.ts`

**Interfaces:**
- Consumes: `PassageRecord` (`../../types/ports`), `PassageMeta`/`LearningIntent`/`Cefr` (`../../types/domain`).
- Produces:
  ```ts
  export interface StoryGroup { kind: 'story'; storyId: string; title: string; chapterCount: number; latest: PassageRecord; }
  export interface ArticleHit { kind: 'article'; passage: PassageRecord; }
  export type LibraryEntry = StoryGroup | ArticleHit;
  export function passageSearch(passages: PassageRecord[], query: string, storyTitles?: Record<string, string>): LibraryEntry[];
  export const INTENT_LABELS: Record<LearningIntent, string>;
  ```
  Ordering: highest score first; ties break by `latest.createdAt` desc. Empty/whitespace query ⇒ recency order (all entries, score 0). Story chapters collapse into one `StoryGroup` (keyed by `storyRef.storyId`); a story matches if any chapter matches.

- [ ] **Step 1: Write the failing test**

Create `src/domain/library/passageSearch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { passageSearch } from './passageSearch';
import type { PassageRecord } from '../../types/ports';
import type { LearningIntent, Cefr, PassageOutput, UserId } from '../../types/domain';

function article(
  passageId: string,
  createdAt: number,
  meta: { title: string; intent?: LearningIntent; level?: Cefr },
  sentences: { en: string; ja: string }[] = [],
): PassageRecord {
  const passage: PassageOutput = {
    meta: {
      title: meta.title,
      intent: meta.intent ?? 'daily',
      level: meta.level ?? 'B1',
      newCount: 0,
      reviewCount: 0,
      approxWords: 0,
    },
    sentences: sentences.map((s) => ({ tokens: s.en.split(' '), translationJa: s.ja })),
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [],
  };
  return { passageId, userId: 'u' as UserId, createdAt, passage };
}

function chapter(storyId: string, chapterIndex: number, createdAt: number, title: string): PassageRecord {
  const rec = article(`${storyId}:${chapterIndex}`, createdAt, { title });
  rec.passage.meta.storyRef = { storyId, chapterIndex };
  return rec;
}

describe('passageSearch', () => {
  it('empty query returns every entry in recency order', () => {
    const out = passageSearch(
      [article('a', 100, { title: 'Alpha' }), article('b', 300, { title: 'Beta' })],
      '',
    );
    expect(out.map((e) => (e.kind === 'article' ? e.passage.passageId : e.storyId))).toEqual(['b', 'a']);
  });

  it('ranks a title match above a body-only match', () => {
    const titled = article('t', 100, { title: 'Ocean Currents' });
    const bodied = article('b', 200, { title: 'Markets' }, [{ en: 'The ocean was calm.', ja: '海は穏やかだった。' }]);
    const out = passageSearch([bodied, titled], 'ocean');
    expect(out.map((e) => (e.kind === 'article' ? e.passage.passageId : e.storyId))).toEqual(['t', 'b']);
  });

  it('matches the Japanese translation body', () => {
    const out = passageSearch(
      [article('j', 100, { title: 'Untitled' }, [{ en: 'It rained.', ja: '雨が降った。' }])],
      '雨',
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.kind === 'article' && out[0]!.passage.passageId).toBe('j');
  });

  it('matches on the learning-intent label (theme)', () => {
    const out = passageSearch([article('biz', 100, { title: 'Untitled', intent: 'business' })], 'ビジネス');
    expect(out).toHaveLength(1);
  });

  it('collapses story chapters into one directory entry and matches on any chapter', () => {
    const out = passageSearch(
      [
        chapter('s1', 0, 100, 'Chapter One'),
        chapter('s1', 1, 200, 'The Hidden Cave'),
        article('a', 50, { title: 'Solo' }),
      ],
      'cave',
      { s1: 'My Saga' },
    );
    const story = out.find((e) => e.kind === 'story');
    expect(story && story.kind === 'story' && story.storyId).toBe('s1');
    expect(story && story.kind === 'story' && story.chapterCount).toBe(2);
    expect(story && story.kind === 'story' && story.title).toBe('My Saga');
    // The solo article does not match "cave", so only the story is returned.
    expect(out.filter((e) => e.kind === 'article')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/domain/library/passageSearch.test.ts`
Expected: FAIL — cannot find module `./passageSearch`.

- [ ] **Step 3: Implement `passageSearch`**

Create `src/domain/library/passageSearch.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/domain/library/passageSearch.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Commit**

```bash
git add src/domain/library/passageSearch.ts src/domain/library/passageSearch.test.ts
git commit -m "feat(library): add pure passageSearch ranking + story grouping"
```

---

## Task 3: `openPassage` controller

**Files:**
- Modify: `src/state/controllers/sessionBootstrap.ts`
- Test: `src/state/controllers/sessionBootstrap.test.ts` (create if it does not exist)

**Interfaces:**
- Consumes: `PassageRepository` (`.get`), `ProgressRepository` (`.get`), `SessionStore`, `tokenizer.index`.
- Produces: `openPassage(deps: OpenPassageDeps, userId: UserId, passageId: string): Promise<IndexedPassage | null>` where `OpenPassageDeps = { passages: PassageRepository; progress: ProgressRepository; session: SessionStore }`. Returns the indexed passage after starting the session and restoring the saved sentence position, or `null` when the passage is not found / not owned by the user.

- [ ] **Step 1: Write the failing test**

Create `src/state/controllers/sessionBootstrap.test.ts` (if the file already exists, append the `describe` block instead):

```ts
import { describe, it, expect } from 'vitest';
import { openPassage } from './sessionBootstrap';
import { createSessionStore } from '../stores/sessionStore';
import type { PassageRepository, PassageRecord, ProgressRepository } from '../../types/ports';
import type { PassageOutput, ReadingProgress, UserId } from '../../types/domain';

function record(passageId: string, userId: string): PassageRecord {
  const passage: PassageOutput = {
    meta: { title: 'T', intent: 'daily', level: 'B1', newCount: 0, reviewCount: 0, approxWords: 0 },
    sentences: [
      { tokens: ['One', '.'], translationJa: '一。' },
      { tokens: ['Two', '.'], translationJa: '二。' },
      { tokens: ['Three', '.'], translationJa: '三。' },
    ],
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [],
  };
  return { passageId, userId: userId as UserId, createdAt: 1, passage };
}

function deps(records: PassageRecord[], progress: ReadingProgress[] = []) {
  const passages: Pick<PassageRepository, 'get'> = {
    async get(id) {
      return records.find((r) => r.passageId === id);
    },
  };
  const progressRepo: Pick<ProgressRepository, 'get'> = {
    async get(userId, passageId) {
      return progress.find((p) => p.userId === userId && p.passageId === passageId);
    },
  };
  return {
    passages: passages as PassageRepository,
    progress: progressRepo as ProgressRepository,
    session: createSessionStore(),
  };
}

describe('openPassage', () => {
  it('loads a passage into the session and restores the saved sentence position', async () => {
    const d = deps(
      [record('p1', 'u')],
      [{ userId: 'u' as UserId, passageId: 'p1', sentenceIndex: 2, percent: 100, status: 'in_progress', startedAt: 1 }],
    );
    const result = await openPassage(d, 'u' as UserId, 'p1');
    expect(result?.passageId).toBe('p1');
    expect(d.session.getState().passage?.passageId).toBe('p1');
    expect(d.session.getState().sentenceIndex).toBe(2);
  });

  it('starts at sentence 0 when there is no saved progress', async () => {
    const d = deps([record('p1', 'u')]);
    await openPassage(d, 'u' as UserId, 'p1');
    expect(d.session.getState().sentenceIndex).toBe(0);
  });

  it('returns null for an unknown passage and leaves the session untouched', async () => {
    const d = deps([record('p1', 'u')]);
    const result = await openPassage(d, 'u' as UserId, 'missing');
    expect(result).toBeNull();
    expect(d.session.getState().passage).toBeNull();
  });

  it('returns null when the passage belongs to another user', async () => {
    const d = deps([record('p1', 'other')]);
    const result = await openPassage(d, 'u' as UserId, 'p1');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/state/controllers/sessionBootstrap.test.ts`
Expected: FAIL — `openPassage` is not exported.

- [ ] **Step 3: Implement `openPassage`**

In `src/state/controllers/sessionBootstrap.ts`, add the deps type and function (keep the existing `restoreReadingSession` / `hydrateSettings`):

```ts
export interface OpenPassageDeps {
  passages: PassageRepository;
  progress: ProgressRepository;
  session: SessionStore;
}

/**
 * Open a specific passage by id into the reading session (URL-addressable reader). Loads the stored
 * record, re-indexes it with the shared tokenizer, starts the session, and seeks to the learner's
 * saved sentence position. Returns null (session untouched) when the passage is missing or owned by
 * another learner — the route renders a "not found" state rather than crashing.
 */
export async function openPassage(
  deps: OpenPassageDeps,
  userId: UserId,
  passageId: string,
): Promise<IndexedPassage | null> {
  const record = await deps.passages.get(passageId);
  if (!record || record.userId !== userId) return null;

  const passage = tokenizer.index(record.passageId, record.passage);
  const now = record.createdAt;
  deps.session.getState().startPassage(passage, now);

  const saved = await deps.progress.get(userId, passageId);
  if (saved) deps.session.getState().updateProgress(saved.sentenceIndex);
  return passage;
}
```

Verify the imports at the top of the file already include `PassageRepository`, `ProgressRepository`, `SessionStore`, `IndexedPassage`, `UserId`, and `tokenizer` — they do (used by `restoreReadingSession`). No new imports needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/state/controllers/sessionBootstrap.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add src/state/controllers/sessionBootstrap.ts src/state/controllers/sessionBootstrap.test.ts
git commit -m "feat(reader): add openPassage controller for URL-addressable passages"
```

---

## Task 4: 4-tab TopNav

**Files:**
- Modify: `src/ui/shared/TopNav.tsx`
- Test: `src/ui/shared/TopNav.test.tsx`

**Interfaces:**
- Produces: nav destinations `ホーム(/) · 文章(/library) · 復習(/review) · 単語帳(/wordbook)`.

- [ ] **Step 1: Update the failing test**

Replace the body of both `it(...)` blocks in `src/ui/shared/TopNav.test.tsx` with:

```ts
  it('shows the brand and the primary destinations', () => {
    const { getByText } = renderAt('/');
    expect(getByText(/Lexia/)).toBeTruthy();
    expect(getByText('ホーム')).toBeTruthy();
    expect(getByText('文章')).toBeTruthy();
    expect(getByText('復習')).toBeTruthy();
    expect(getByText('単語帳')).toBeTruthy();
  });

  it('marks the current route as active (aria-current)', () => {
    const { getByText } = renderAt('/review');
    expect(getByText('復習').getAttribute('aria-current')).toBe('page');
    expect(getByText('文章').getAttribute('aria-current')).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/ui/shared/TopNav.test.tsx`
Expected: FAIL — `ホーム` / `文章` not found (nav still shows the old 5 labels).

- [ ] **Step 3: Update the nav destinations**

In `src/ui/shared/TopNav.tsx`, replace the `DESTINATIONS` array with:

```ts
const DESTINATIONS: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'ホーム', end: true },
  { to: '/library', label: '文章' },
  { to: '/review', label: '復習' },
  { to: '/wordbook', label: '単語帳' },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/ui/shared/TopNav.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/shared/TopNav.tsx src/ui/shared/TopNav.test.tsx
git commit -m "feat(nav): collapse to 4 tabs (home/library/review/wordbook)"
```

---

## Task 5: LibraryScreen (presentational)

**Files:**
- Create: `src/ui/library/LibraryScreen.tsx`
- Test: `src/ui/library/LibraryScreen.test.tsx`

**Interfaces:**
- Consumes: `LibraryEntry`, `passageSearch`, `INTENT_LABELS` (Task 2); `PassageRecord`.
- Produces:
  ```ts
  export interface LibraryScreenProps {
    passages: PassageRecord[];
    storyTitles?: Record<string, string>;
    onOpenArticle?: (passageId: string) => void;
    onOpenStory?: (storyId: string) => void;
  }
  export function LibraryScreen(props: LibraryScreenProps): JSX.Element;
  ```
  Owns its own query state; renders a search box (`aria-label="文章を検索"`), a results list where article rows call `onOpenArticle(passageId)` and story rows call `onOpenStory(storyId)`, and an empty state (`該当する文章がありません`) when a non-empty query yields nothing.

- [ ] **Step 1: Write the failing test**

Create `src/ui/library/LibraryScreen.test.tsx`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/ui/library/LibraryScreen.test.tsx`
Expected: FAIL — cannot find module `./LibraryScreen`.

- [ ] **Step 3: Implement LibraryScreen**

Create `src/ui/library/LibraryScreen.tsx`:

```tsx
/**
 * L4 — LibraryScreen: the "文章" tab. All stored passages with a ranked search box. Standalone
 * articles link to /p/:id; story chapters collapse into one directory row that links to /s/:id.
 * Presentational: passages + story titles are injected; navigation is delegated via callbacks.
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { colors, fonts, radius } from '../theme/tokens';
import { passageSearch, INTENT_LABELS } from '../../domain/library/passageSearch';
import type { PassageRecord } from '../../types/ports';

export interface LibraryScreenProps {
  passages: PassageRecord[];
  storyTitles?: Record<string, string>;
  onOpenArticle?: (passageId: string) => void;
  onOpenStory?: (storyId: string) => void;
}

export function LibraryScreen({ passages, storyTitles = {}, onOpenArticle, onOpenStory }: LibraryScreenProps) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => passageSearch(passages, query, storyTitles), [passages, query, storyTitles]);
  const isSearching = query.trim().length > 0;

  return (
    <div style={pageStyle} className="library-page">
      <div style={{ width: '100%', maxWidth: 760 }}>
        <h1 style={{ fontFamily: fonts.serifJp, fontSize: 27, fontWeight: 500, color: colors.ink, margin: '0 0 4px' }}>
          文章
        </h1>
        <div style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.muted, marginBottom: 20 }}>
          生成した記事と物語をまとめて探せます。
        </div>

        <input
          type="search"
          aria-label="文章を検索"
          placeholder="タイトル・テーマ・本文で検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={searchStyle}
        />

        {results.length === 0 ? (
          <div style={emptyStyle}>
            {isSearching ? '該当する文章がありません' : 'まだ文章がありません。ホームで最初の文章を生成しましょう。'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 18 }}>
            {results.map((entry) =>
              entry.kind === 'article' ? (
                <button
                  key={entry.passage.passageId}
                  type="button"
                  onClick={() => onOpenArticle?.(entry.passage.passageId)}
                  style={rowStyle}
                >
                  <span style={titleStyle}>{entry.passage.meta.title}</span>
                  <span style={metaStyle}>
                    {INTENT_LABELS[entry.passage.meta.intent]} · {entry.passage.meta.level}
                  </span>
                </button>
              ) : (
                <button
                  key={entry.storyId}
                  type="button"
                  onClick={() => onOpenStory?.(entry.storyId)}
                  style={rowStyle}
                >
                  <span style={titleStyle}>
                    <span aria-hidden style={{ color: colors.primary, marginRight: 8 }}>
                      ▸
                    </span>
                    {entry.title}
                  </span>
                  <span style={metaStyle}>物語 · 全{entry.chapterCount}章</span>
                </button>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  background: colors.surfacePage,
  padding: '40px 24px',
  minHeight: '100%',
};

const searchStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: fonts.ui,
  fontSize: 15,
  color: colors.ink,
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderControl}`,
  borderRadius: radius.control,
  padding: '12px 14px',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 16,
  width: '100%',
  textAlign: 'left',
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: radius.card,
  padding: '16px 18px',
  cursor: 'pointer',
};

const titleStyle: CSSProperties = { fontFamily: fonts.serifJp, fontSize: 17, color: colors.ink };
const metaStyle: CSSProperties = { fontFamily: fonts.ui, fontSize: 12, color: colors.faint, flex: 'none' };

const emptyStyle: CSSProperties = {
  marginTop: 40,
  textAlign: 'center',
  fontFamily: fonts.ui,
  fontSize: 14,
  color: colors.faint,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/ui/library/LibraryScreen.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/ui/library/LibraryScreen.tsx src/ui/library/LibraryScreen.test.tsx
git commit -m "feat(library): add LibraryScreen with ranked search + story directories"
```

---

## Task 6: StoryDirectoryScreen (presentational)

**Files:**
- Create: `src/ui/story/StoryDirectoryScreen.tsx`
- Test: `src/ui/story/StoryDirectoryScreen.test.tsx`

**Interfaces:**
- Consumes: `StoryPlan`, `StoryCharacter` (`../../types/domain`).
- Produces:
  ```ts
  export interface StoryChapterRow { chapterIndex: number; headingJa: string; generated: boolean; }
  export interface StoryDirectoryScreenProps {
    plan: StoryPlan;
    chapters: StoryChapterRow[];
    onOpenChapter?: (chapterIndex: number) => void;
  }
  export function StoryDirectoryScreen(props: StoryDirectoryScreenProps): JSX.Element;
  ```
  Renders the story title, synopsis, character cards, and a chapter list. A generated chapter row calls `onOpenChapter(chapterIndex)`; an ungenerated row is shown disabled with a `未生成` marker.

- [ ] **Step 1: Write the failing test**

Create `src/ui/story/StoryDirectoryScreen.test.tsx`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/ui/story/StoryDirectoryScreen.test.tsx`
Expected: FAIL — cannot find module `./StoryDirectoryScreen`.

- [ ] **Step 3: Implement StoryDirectoryScreen**

Create `src/ui/story/StoryDirectoryScreen.tsx`:

```tsx
/**
 * L4 — StoryDirectoryScreen: the story "folder" (/s/:storyId). Title + synopsis + character cards +
 * chapter list. Generated chapters link into the reader (/s/:storyId/:chapterIndex); planned-but-
 * ungenerated chapters are shown disabled. Presentational: the plan + per-chapter generated flags
 * are injected; navigation is delegated via onOpenChapter.
 */

import type { CSSProperties } from 'react';
import { colors, fonts, radius } from '../theme/tokens';
import type { StoryPlan } from '../../types/domain';

export interface StoryChapterRow {
  chapterIndex: number;
  headingJa: string;
  generated: boolean;
}

export interface StoryDirectoryScreenProps {
  plan: StoryPlan;
  chapters: StoryChapterRow[];
  onOpenChapter?: (chapterIndex: number) => void;
}

export function StoryDirectoryScreen({ plan, chapters, onOpenChapter }: StoryDirectoryScreenProps) {
  return (
    <div style={pageStyle} className="story-directory-page">
      <div style={{ width: '100%', maxWidth: 720 }}>
        <div style={{ fontFamily: fonts.ui, fontSize: 12, fontWeight: 600, letterSpacing: '.04em', color: colors.primary }}>
          物語 / STORY
        </div>
        <h1 style={{ fontFamily: fonts.serifJp, fontSize: 28, fontWeight: 500, color: colors.ink, margin: '6px 0 10px' }}>
          {plan.titleJa}
        </h1>
        <p style={{ fontFamily: fonts.bodyJp, fontSize: 14, color: colors.body, lineHeight: 1.7, margin: 0 }}>
          {plan.synopsisJa}
        </p>

        {plan.characters.length > 0 ? (
          <section style={{ marginTop: 28 }}>
            <div style={sectionTitleStyle}>登場人物</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
              {plan.characters.map((ch) => (
                <div key={ch.name} style={characterCardStyle}>
                  {ch.illustrationUrl ? (
                    <img src={ch.illustrationUrl} alt={ch.name} style={portraitStyle} />
                  ) : (
                    <div aria-hidden style={{ ...portraitStyle, background: colors.avatarBg }} />
                  )}
                  <div>
                    <div style={{ fontFamily: fonts.ui, fontSize: 14, fontWeight: 600, color: colors.ink }}>{ch.name}</div>
                    <div style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.muted }}>{ch.role}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section style={{ marginTop: 28 }}>
          <div style={sectionTitleStyle}>章の一覧</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 12 }}>
            {chapters.map((row) =>
              row.generated ? (
                <button
                  key={row.chapterIndex}
                  type="button"
                  onClick={() => onOpenChapter?.(row.chapterIndex)}
                  style={chapterRowStyle(true)}
                >
                  <span style={{ fontFamily: fonts.serifJp, fontSize: 16, color: colors.ink }}>{row.headingJa}</span>
                  <span style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.primary }}>読む</span>
                </button>
              ) : (
                <div key={row.chapterIndex} style={chapterRowStyle(false)}>
                  <span style={{ fontFamily: fonts.serifJp, fontSize: 16, color: colors.faint }}>{row.headingJa}</span>
                  <span style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>未生成</span>
                </div>
              ),
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  background: colors.surfacePage,
  padding: '40px 24px',
  minHeight: '100%',
};

const sectionTitleStyle: CSSProperties = { fontFamily: fonts.ui, fontSize: 14, fontWeight: 600, color: colors.ink };

const characterCardStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: radius.card,
  padding: '12px 16px',
  minWidth: 200,
};

const portraitStyle: CSSProperties = { width: 44, height: 44, borderRadius: radius.full, objectFit: 'cover', flex: 'none' };

const chapterRowStyle = (generated: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  width: '100%',
  textAlign: 'left',
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: radius.card,
  padding: '14px 18px',
  cursor: generated ? 'pointer' : 'default',
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/ui/story/StoryDirectoryScreen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/story/StoryDirectoryScreen.tsx src/ui/story/StoryDirectoryScreen.test.tsx
git commit -m "feat(story): add StoryDirectoryScreen (synopsis, characters, chapter list)"
```

---

## Task 7: HomeScreen (generation hero + summary strip)

**Files:**
- Create: `src/ui/home/HomeScreen.tsx`
- Test: `src/ui/home/HomeScreen.test.tsx`

**Interfaces:**
- Consumes: `SetupScreen` + `SetupScreenProps` (`../setup/SetupScreen`), `DashboardScreen` (`../dashboard/DashboardScreen`), `DashboardSnapshot` (`../../domain/dashboard/dashboardProjector`).
- Produces:
  ```ts
  export interface HomeScreenProps {
    setup: SetupScreenProps;         // forwarded to the embedded generation form
    snapshot?: DashboardSnapshot;    // learning summary; omitted while loading
    now?: number;
    onContinue?: () => void;
    onStartReview?: () => void;
    onOpenPassage?: (passageId: string) => void;
  }
  export function HomeScreen(props: HomeScreenProps): JSX.Element;
  ```
  Renders the generation form as the hero (via embedded `SetupScreen`), then — when `snapshot` is present — the existing `DashboardScreen` below it for the learning summary (streak, due, continue, mastery, weekly, recent). Delegates continue/review/open to the DashboardScreen callbacks.

> **Note (reuse, not duplication):** `HomeScreen` composes the existing `SetupScreen` and `DashboardScreen` rather than reimplementing their internals. This keeps generation + dashboard behavior in one place; Home is a layout that stacks the hero above the summary.

- [ ] **Step 1: Write the failing test**

Create `src/ui/home/HomeScreen.test.tsx`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomeScreen } from './HomeScreen';
import type { DashboardSnapshot } from '../../domain/dashboard/dashboardProjector';

const snapshot: DashboardSnapshot = {
  dueTodayCount: 3,
  streakDays: 5,
  mastery: { total: 10, new: 4, learning: 3, consolidating: 2, mastered: 1 },
  reading: [],
  weekly: [],
  dueList: [],
  recent: [],
};

function renderHome() {
  return render(
    <MemoryRouter>
      <HomeScreen setup={{ candidates: [], onGenerate: vi.fn() }} snapshot={snapshot} now={1_000_000} />
    </MemoryRouter>,
  );
}

describe('<HomeScreen/>', () => {
  it('renders the generation form as the hero and the learning summary below', () => {
    renderHome();
    // Generation hero (embedded SetupScreen) — its primary action button.
    expect(screen.getByText('文章を生成する')).toBeTruthy();
    // Learning summary from the snapshot (DashboardScreen renders the streak chip).
    expect(screen.getByText('5日連続')).toBeTruthy();
  });

  it('omits the summary while the snapshot is loading', () => {
    render(
      <MemoryRouter>
        <HomeScreen setup={{ candidates: [], onGenerate: vi.fn() }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('文章を生成する')).toBeTruthy();
    expect(screen.queryByText('5日連続')).toBeNull();
  });
});
```

> Before writing the implementation, confirm the exact `DashboardSnapshot` field names by opening `src/domain/dashboard/dashboardProjector.ts`. If any field in the test's `snapshot` literal differs (e.g. a nested shape), adjust the literal to match the real type — do NOT change the projector.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/ui/home/HomeScreen.test.tsx`
Expected: FAIL — cannot find module `./HomeScreen`.

- [ ] **Step 3: Implement HomeScreen**

Create `src/ui/home/HomeScreen.tsx`:

```tsx
/**
 * L4 — HomeScreen: the app entry (/). The generation form is the hero (compose the existing
 * SetupScreen), with the learning summary (streak, due, continue, mastery, weekly, recent) stacked
 * below by reusing DashboardScreen. Presentational: setup props + a projected DashboardSnapshot are
 * injected; navigation is delegated. No dashboard/setup logic is duplicated here.
 */

import type { CSSProperties } from 'react';
import { SetupScreen, type SetupScreenProps } from '../setup/SetupScreen';
import { DashboardScreen } from '../dashboard/DashboardScreen';
import { colors, fonts } from '../theme/tokens';
import type { DashboardSnapshot } from '../../domain/dashboard/dashboardProjector';

export interface HomeScreenProps {
  setup: SetupScreenProps;
  snapshot?: DashboardSnapshot;
  now?: number;
  onContinue?: () => void;
  onStartReview?: () => void;
  onOpenPassage?: (passageId: string) => void;
}

export function HomeScreen({ setup, snapshot, now, onContinue, onStartReview, onOpenPassage }: HomeScreenProps) {
  return (
    <div className="home-page">
      <SetupScreen {...setup} />
      {snapshot ? (
        <div style={summaryWrapStyle}>
          <div style={summaryHeadingStyle}>学習の状況</div>
          <DashboardScreen
            snapshot={snapshot}
            now={now}
            onContinue={onContinue ? () => onContinue() : undefined}
            onStartReview={onStartReview}
            onOpenPassage={onOpenPassage ? (passageId) => onOpenPassage(passageId) : undefined}
          />
        </div>
      ) : null}
    </div>
  );
}

const summaryWrapStyle: CSSProperties = { background: colors.surfacePage, paddingTop: 8 };
const summaryHeadingStyle: CSSProperties = {
  fontFamily: fonts.serifJp,
  fontSize: 18,
  fontWeight: 500,
  color: colors.ink,
  padding: '24px 32px 0',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/ui/home/HomeScreen.test.tsx`
Expected: PASS (both cases). `DashboardScreen` calls `useNavigate`, so the test wraps `HomeScreen` in `MemoryRouter` (already done).

- [ ] **Step 5: Commit**

```bash
git add src/ui/home/HomeScreen.tsx src/ui/home/HomeScreen.test.tsx
git commit -m "feat(home): add HomeScreen (generation hero + learning summary)"
```

---

## Task 8: Rewire the router (new route table + URL-driven route containers)

This task changes routing end-to-end and updates the three route-level test files together, because they only pass as a set once the new URLs and containers exist. It is one reviewable deliverable: "the app navigates by the new IA."

**Files:**
- Modify: `src/ui/router.tsx`
- Modify: `src/ui/router.test.tsx`
- Modify: `src/ui/app/routes.tsx`
- Modify: `src/ui/app/routes.test.tsx`
- Modify: `src/ui/app/storyRoute.test.tsx`

**Interfaces:**
- Consumes: `openPassage` (Task 3), `PassageRepository.all` (Task 1), `passageSearch` (Task 2), `LibraryScreen` (Task 5), `StoryDirectoryScreen` (Task 6), `HomeScreen` (Task 7).
- Produces route table:
  ```ts
  { index: true, element: <HomeRoute /> }
  { path: 'library', element: <LibraryRoute /> }
  { path: 'p/:passageId', element: <ReadingRoute /> }
  { path: 's/:storyId', element: <StoryDirectoryRoute /> }
  { path: 's/:storyId/:chapterIndex', element: <ReadingRoute /> }
  { path: 'review', element: <ReviewRoute /> }
  { path: 'wordbook', element: <WordbookRoute /> }
  ```

- [ ] **Step 1: Update the router test (failing)**

Replace the second `it(...)` in `src/ui/router.test.tsx` with:

```ts
  it('wires the new IA destinations under the shell', () => {
    const children = appRoutes[0]!.children ?? [];
    const hasIndex = children.some((c) => 'index' in c && c.index); // home (generation)
    const paths = children.flatMap((c) => ('path' in c && c.path ? [c.path] : []));
    expect(hasIndex).toBe(true);
    expect(paths).toEqual(
      expect.arrayContaining(['library', 'p/:passageId', 's/:storyId', 's/:storyId/:chapterIndex', 'review', 'wordbook']),
    );
    // The retired tabs are gone.
    expect(paths).not.toContain('read');
    expect(paths).not.toContain('setup');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/ui/router.test.tsx`
Expected: FAIL — paths still contain `read`/`setup`, not the new ones.

- [ ] **Step 3: Update the route table**

In `src/ui/router.tsx`, update the imports and `children`:

```tsx
import {
  HomeRoute,
  LibraryRoute,
  ReadingRoute,
  ReviewRoute,
  StoryDirectoryRoute,
  WordbookRoute,
} from './app/routes';

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomeRoute /> },
      { path: 'library', element: <LibraryRoute /> },
      { path: 'p/:passageId', element: <ReadingRoute /> },
      { path: 's/:storyId', element: <StoryDirectoryRoute /> },
      { path: 's/:storyId/:chapterIndex', element: <ReadingRoute /> },
      { path: 'review', element: <ReviewRoute /> },
      { path: 'wordbook', element: <WordbookRoute /> },
    ],
  },
];
```

- [ ] **Step 4: Rewrite the route containers**

In `src/ui/app/routes.tsx` make these changes:

(a) **Add imports** near the top (with the other `react-router-dom` and screen imports):

```tsx
import { useNavigate, useParams } from 'react-router-dom';
import { HomeScreen } from '../home/HomeScreen';
import { LibraryScreen } from '../library/LibraryScreen';
import { StoryDirectoryScreen, type StoryChapterRow } from '../story/StoryDirectoryScreen';
import { openPassage } from '../../state/controllers/sessionBootstrap';
```

(b) **Rename `SetupRoute` to `HomeRoute`.** Keep ALL of its existing generation logic (candidates, suggestion, story plan-confirm gate, `runArticlePipeline`, `onGenerate`, `onConfirmPlan`, `StoryPlanReview` early return). Change only the success navigations and the final `return`:

- In `runArticlePipeline`, replace `if (outcome.ok) navigate('/read');` with:
  ```tsx
  if (outcome.ok && outcome.passageId) navigate(`/p/${outcome.passageId}`);
  else if (!outcome.ok) setGenerationError(generationErrorMessage(outcome.error));
  ```
- In `onConfirmPlan`, after a successful chapter generation, replace `navigate('/read');` with:
  ```tsx
  navigate(`/s/${plan.storyId}/${chapterIndex}`);
  ```
  (`chapterIndex` is the `0` already defined in that function.)
- Add a dashboard snapshot read for the summary strip (mirror `DashboardRoute`) and change the final `return` from `<SetupScreen .../>` to `<HomeScreen .../>`:
  ```tsx
  const snapshot = useLiveQuery(
    () =>
      loadDashboardSnapshot(
        { loadStates: c.loadStates, progress: c.repos.progress, reviewLog: c.repos.reviewLog, passages: c.repos.passages },
        c.userId,
        c.now(),
      ),
    [c],
  );

  const resume = async (): Promise<void> => {
    await restoreReadingSession({ passages: c.repos.passages, progress: c.repos.progress, session: c.session }, c.userId);
    const active = c.session.getState().passage;
    if (active) navigate(readerPathFor(active.passageId, active.source.meta.storyRef));
  };

  return (
    <HomeScreen
      setup={{
        candidates,
        suggestionShortfall,
        initial: lastSetup,
        generating,
        generationError,
        onGenerate: (s) => void onGenerate(s),
      }}
      snapshot={snapshot ?? undefined}
      now={c.now()}
      onContinue={() => void resume()}
      onStartReview={() => navigate('/review')}
      onOpenPassage={() => void resume()}
    />
  );
  ```

(c) **Add a shared path helper** (module scope, near `CANDIDATE_LIMIT`):

```tsx
/** Reader URL for a passage: story chapters are /s/:storyId/:chapterIndex, articles are /p/:id. */
function readerPathFor(passageId: string, storyRef?: { storyId: string; chapterIndex: number }): string {
  return storyRef ? `/s/${storyRef.storyId}/${storyRef.chapterIndex}` : `/p/${passageId}`;
}
```

(d) **Make `ReadingRoute` URL-driven.** At the top of `ReadingRoute`, derive the target passageId from params and open it when it differs from the session passage:

```tsx
  const c = useContainer();
  const navigate = useNavigate();
  const params = useParams();
  const targetPassageId =
    params.storyId && params.chapterIndex !== undefined
      ? `${params.storyId}:${params.chapterIndex}`
      : params.passageId;
  const passage = useStore(c.session, (s) => s.passage);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!targetPassageId) return;
    if (passage?.passageId === targetPassageId) {
      setNotFound(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const opened = await openPassage(
        { passages: c.repos.passages, progress: c.repos.progress, session: c.session },
        c.userId,
        targetPassageId,
      );
      if (!cancelled) setNotFound(opened === null);
    })();
    return () => {
      cancelled = true;
    };
  }, [c, targetPassageId, passage?.passageId]);

  if (notFound) {
    return (
      <div style={notFoundStyle}>
        <div style={{ fontFamily: fonts.serifJp, fontSize: 20, color: colors.ink }}>文章が見つかりません</div>
        <button type="button" onClick={() => navigate('/library')} style={notFoundButtonStyle}>
          文章一覧へ
        </button>
      </div>
    );
  }
```

  Keep the rest of `ReadingRoute` as-is EXCEPT the two navigations:
  - `completeReading` stays the same (it does not navigate).
  - Any `navigate('/read')` inside `ReadingRoute` (there are none today besides via session) — leave untouched.
  - The next-chapter flow (`generateNextStoryChapter`) already swaps the session passage in place; after a successful generation, also navigate to the new chapter URL so the address bar tracks the chapter. At the end of the success branch (after `runGenerationPipeline` returns ok), add:
    ```tsx
    if (outcome.ok) navigate(`/s/${plan.storyId}/${nextIndex}`);
    ```
    (place it right after the existing `if (!outcome.ok) { setNextChapterError(...); return; }` guard, using the `plan` and `nextIndex` already in scope).

  Add these styles near the other `CSSProperties` consts at the bottom of the file:

```tsx
const notFoundStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 16,
  padding: '80px 24px',
  background: colors.surfacePage,
};

const notFoundButtonStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 13,
  fontWeight: 600,
  color: colors.primary,
  background: colors.surfaceBlue,
  border: `1px solid ${colors.primaryBorder}`,
  borderRadius: radius.chip,
  padding: '8px 18px',
  cursor: 'pointer',
};
```

  Add `radius` to the tokens import (`import { colors, fonts, radius } from '../theme/tokens';`) and ensure `useEffect`, `useState`, `useParams` are imported.

(e) **Add `LibraryRoute`** (after `WordbookRoute`):

```tsx
export function LibraryRoute() {
  const c = useContainer();
  const navigate = useNavigate();

  const passages = useLiveQuery(() => c.repos.passages.all(c.userId), [c]);
  const storyTitles = useLiveQuery(async () => {
    const stories = await c.repos.stories.recent(c.userId, 200);
    return Object.fromEntries(stories.map((s) => [s.storyId, s.plan.titleJa] as const));
  }, [c]);

  if (!passages) return <ScreenSkeleton />;

  return (
    <LibraryScreen
      passages={passages}
      storyTitles={storyTitles ?? {}}
      onOpenArticle={(passageId) => navigate(`/p/${passageId}`)}
      onOpenStory={(storyId) => navigate(`/s/${storyId}`)}
    />
  );
}
```

(f) **Add `StoryDirectoryRoute`** (after `LibraryRoute`):

```tsx
export function StoryDirectoryRoute() {
  const c = useContainer();
  const navigate = useNavigate();
  const params = useParams();
  const storyId = params.storyId ?? '';

  const data = useLiveQuery(async () => {
    const story = await c.repos.stories.get(storyId);
    if (!story || story.userId !== c.userId) return null;
    const chapters = await c.repos.passages.byStory(c.userId, storyId);
    const generated = new Set(chapters.map((ch) => ch.passage.meta.storyRef?.chapterIndex ?? 0));
    const rows: StoryChapterRow[] = story.plan.chapters.map((ch) => ({
      chapterIndex: ch.index,
      headingJa: ch.headingJa,
      generated: generated.has(ch.index),
    }));
    return { plan: story.plan, rows };
  }, [c, storyId]);

  if (data === undefined) return <ScreenSkeleton />;
  if (data === null) {
    return (
      <div style={notFoundStyle}>
        <div style={{ fontFamily: fonts.serifJp, fontSize: 20, color: colors.ink }}>物語が見つかりません</div>
        <button type="button" onClick={() => navigate('/library')} style={notFoundButtonStyle}>
          文章一覧へ
        </button>
      </div>
    );
  }

  return (
    <StoryDirectoryScreen
      plan={data.plan}
      chapters={data.rows}
      onOpenChapter={(chapterIndex) => navigate(`/s/${storyId}/${chapterIndex}`)}
    />
  );
}
```

- [ ] **Step 5: Update `routes.test.tsx` to the new URLs**

In `src/ui/app/routes.test.tsx`:
- Change every `initialEntries: ['/setup']` to `initialEntries: ['/']`.
- The generation → reading assertions stay valid (the title still renders after navigation to `/p/:id`). After the `文章を生成する` click, the router now lands on `/p/<generated-id>`; the existing `screen.getAllByText('取引の成立')` waits already cover it.
- In the API-down test, change the final `expect(router.state.location.pathname).toBe('/setup');` to `expect(router.state.location.pathname).toBe('/');`.
- The 3-zone layout test: change `initialEntries: ['/setup']` to `['/']`; the rest is unchanged.

- [ ] **Step 6: Update `storyRoute.test.tsx` to the new URLs**

In `src/ui/app/storyRoute.test.tsx`:
- Change the story-gate tests' `initialEntries: ['/setup']` to `['/']`.
- In the first story test, change `await waitFor(() => expect(router.state.location.pathname).toBe('/read'));` to:
  ```ts
  await waitFor(() => expect(router.state.location.pathname).toBe('/s/story_1/0'));
  ```
- In the confirm-error test, change `expect(router.state.location.pathname).toBe('/setup');` to `expect(router.state.location.pathname).toBe('/');`.
- The "continue long-story chapter" test uses `initialEntries: ['/read']`; change it to `['/s/story_1/0']` (the session is pre-seeded with `story_1:0`, and the URL now matches). After clicking `続きを生成`, add:
  ```ts
  await waitFor(() => expect(router.state.location.pathname).toBe('/s/story_1/1'));
  ```
  (Keep the existing assertions about the generated chapter body and the extended plan.)

- [ ] **Step 7: Run the full affected suite**

Run: `npm test -- src/ui/router.test.tsx src/ui/app/routes.test.tsx src/ui/app/storyRoute.test.tsx`
Expected: PASS. If a story/reading test races on navigation, wrap the asserted navigation in `waitFor` (pattern already used in these files).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors. Fix any unused-import or missing-import issues introduced by the rename (e.g. remove the now-unused `SetupScreen` import from `routes.tsx` if `HomeScreen` fully replaces it — but keep `CandidateWord`/`SetupConfig` type imports still referenced by the generation logic).

- [ ] **Step 9: Commit**

```bash
git add src/ui/router.tsx src/ui/router.test.tsx src/ui/app/routes.tsx src/ui/app/routes.test.tsx src/ui/app/storyRoute.test.tsx
git commit -m "feat(nav): route by new IA (home generation, /p /s reader, library)"
```

---

## Task 9: Full-suite regression + cleanup

**Files:**
- Possibly modify: any test still referencing `/setup` or `/read` or the old nav labels (`ダッシュボード`, `学習をはじめる`, `読む`).

- [ ] **Step 1: Find stragglers**

Run:
```bash
grep -rnE "'/setup'|'/read'|ダッシュボード|学習をはじめる|「?読む」?" src --include=*.tsx --include=*.ts | grep -v node_modules
```
Expected: only intentional occurrences remain (e.g. the `SetupScreen` heading text `学習をはじめる` inside `SetupScreen.tsx` is fine — it's the form heading, not a nav route). Any test asserting old routes/labels that this plan didn't already update must be fixed to the new IA.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS. Note: the memory file `lexia-test-env` records 2 tests that are flaky under load — if a failure is one of those and passes on a focused re-run, it is not a regression.

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "test: align remaining route/nav references with the new IA"
```

---

## Self-Review

**1. Spec coverage:**
- Generation on home → Task 7 (HomeScreen) + Task 8 (`HomeRoute`, index route). ✅
- Remove "読む" tab; passages open by URL → Task 3 (`openPassage`) + Task 4 (nav) + Task 8 (`/p/:id`, `/s/:storyId/:chapter`, URL-driven `ReadingRoute`). ✅
- Article search (full-text, title/theme-ranked) → Task 1 (`all`) + Task 2 (`passageSearch`) + Task 5 (LibraryScreen). ✅
- Stories as a directory structure → Task 2 (story collapse) + Task 6 (StoryDirectoryScreen) + Task 8 (`/s/:storyId`, `StoryDirectoryRoute`). ✅
- Home summary strip retains dashboard value → Task 7 composes `DashboardScreen`. ✅
- Error states (unknown passage/story, empty search) → Task 5 (empty state), Task 8 (`notFound` in reader + story dir). ✅
- No schema migration / no token change / no generation-logic change → honored across all tasks (reuse `all` on existing index, existing tokens, existing `runGenerationPipeline`). ✅

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Every code step has full code. ✅ (Task 7 Step 1 asks the implementer to verify the `DashboardSnapshot` literal against the real type — this is a correctness guard, not a placeholder; the implementation code itself is complete.)

**3. Type consistency:**
- `passageSearch(passages, query, storyTitles?)` and `LibraryEntry`/`StoryGroup`/`ArticleHit` — consistent between Task 2 (def), Task 5 (consumer), Task 8 (route not directly, uses LibraryScreen).
- `openPassage(deps, userId, passageId)` with `OpenPassageDeps` — consistent between Task 3 (def) and Task 8 (`ReadingRoute` caller).
- `PassageRepository.all(userId)` — Task 1 (def) → Task 8 (`LibraryRoute`). ✅
- `StoryChapterRow { chapterIndex, headingJa, generated }` — Task 6 (def) → Task 8 (`StoryDirectoryRoute` builds rows). ✅
- `HomeScreenProps.setup: SetupScreenProps` — Task 7 (def) → Task 8 (`HomeRoute` passes `{ candidates, suggestionShortfall, initial, generating, generationError, onGenerate }`, all valid `SetupScreenProps`). ✅
- `readerPathFor(passageId, storyRef?)` — defined once in Task 8(c), used in Task 8(b) `resume`. ✅

All consistent. Plan ready.
