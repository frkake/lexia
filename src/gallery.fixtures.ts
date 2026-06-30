/**
 * Deterministic fixtures for the visual-regression gallery (task 11.4). These drive the
 * presentational screens with fixed data so screenshots are stable and the design-token
 * assertions have known content. Not part of the production bundle (gallery.html is a
 * dev/test-only entry).
 */

import { tokenizer } from './domain/tokenizer/joinService';
import { DAY_MS } from './domain/srs/parameters';
import type { DashboardSnapshot } from './domain/dashboard/dashboardProjector';
import type { ReviewItem } from './ui/review/ReviewSession';
import type { CandidateWord } from './ui/setup/SetupScreen';
import type { WordbookEntry } from './ui/wordbook/WordbookScreen';
import type { IndexedPassage, PassageOutput, SetupConfig, UserId, WordData, WordSchedulingState } from './types/domain';

/** Fixed clock (June 29 2026, 09:00 UTC) — Date.UTC is deterministic. */
export const FIXED_NOW = Date.UTC(2026, 5, 29, 9, 0, 0);
const startOfDay = (t: number): number => Math.floor(t / DAY_MS) * DAY_MS;
const TODAY = startOfDay(FIXED_NOW);

// ── Reading (rich annotations: 3 densities + collocations + 3 notice categories) ──

const READING_OUTPUT: PassageOutput = {
  meta: { title: '交渉のテーブルで', theme: '交渉', level: 'B2', newCount: 2, reviewCount: 2, approxWords: 19 },
  sentences: [
    {
      tokens: ['The', 'negotiation', 'reached', 'a', 'decisive', 'turning', 'point', '.'],
      translationJa: '交渉は決定的な転機を迎えた。',
      // 新出語 "decisive" → 和訳「決定的」(chars [3,6)) を新出強調する（要件4）。
      translationSpans: [{ charStart: 3, charEnd: 6, refType: 'word', wordId: 'decisive', isNew: true }],
    },
    { tokens: ['Both', 'sides', 'remained', 'cordial', 'throughout', '.'], translationJa: '双方は終始友好的だった。' },
    {
      tokens: ['They', 'finally', 'closed', 'the', 'deal', '.'],
      translationJa: '彼らはついに取引をまとめた。',
      // 新出語 "deal" → 和訳「取引」(chars [6,8)) を新出強調する（要件4）。
      translationSpans: [{ charStart: 6, charEnd: 8, refType: 'word', wordId: 'deal', isNew: true }],
    },
  ],
  targetSpans: [
    { sentenceIndex: 0, tokenStart: 1, tokenEnd: 2, wordId: 'negotiation', surface: 'negotiation', masteryDensity: 'review' },
    { sentenceIndex: 0, tokenStart: 4, tokenEnd: 5, wordId: 'decisive', surface: 'decisive', masteryDensity: 'new' },
    { sentenceIndex: 1, tokenStart: 3, tokenEnd: 4, wordId: 'cordial', surface: 'cordial', masteryDensity: 'known' },
    { sentenceIndex: 2, tokenStart: 4, tokenEnd: 5, wordId: 'deal', surface: 'deal', masteryDensity: 'new' },
  ],
  collocationSpans: [
    { sentenceIndex: 0, tokenStart: 5, tokenEnd: 7, headWordId: 'turning-point', collocationId: 'turning-point' },
    { sentenceIndex: 2, tokenStart: 2, tokenEnd: 5, headWordId: 'deal', collocationId: 'close-deal' },
  ],
  noticeCues: [
    { index: 1, span: { sentenceIndex: 0, tokenStart: 4, tokenEnd: 5 }, category: 'connotation', wordId: 'decisive', sourceAttribute: 'connotation', anchorText: 'decisive', explanationJa: '前向きで力強い含意を持つ。' },
    { index: 2, span: { sentenceIndex: 1, tokenStart: 3, tokenEnd: 4 }, category: 'register', wordId: 'cordial', sourceAttribute: 'register', anchorText: 'cordial', explanationJa: 'ややフォーマルな響き。' },
    { index: 3, span: { sentenceIndex: 2, tokenStart: 2, tokenEnd: 5 }, category: 'collocation', wordId: 'deal', sourceAttribute: 'core.collocations', anchorText: 'closed the deal', explanationJa: 'close a deal の定型表現。' },
  ],
};

export const readingPassage: IndexedPassage = tokenizer.index('gallery', READING_OUTPUT);

// ── Word detail card (full, with MORE) ──────────────────────────────────────

export const wordCardData: WordData = {
  wordId: 'resilient',
  headword: 'resilient',
  ipa: '/rɪˈzɪliənt/',
  pos: ['adjective'],
  register: 'neutral',
  connotation: '肯定的',
  frequency: 4,
  audioUrl: 'https://cdn.example/resilient.mp3',
  core: {
    meaningsJa: ['回復力のある', '立ち直りが早い'],
    examples: [{ en: 'a resilient economy', ja: '回復力のある経済' }],
    collocations: ['remain resilient', 'a resilient system'],
    synonymNuances: ['tough より内面的な強さを含意'],
  },
  more: {
    etymology: { prefix: 're-', root: 'salire（跳ねる）' },
    semanticNetwork: { synonyms: ['tough', 'hardy'], antonyms: ['fragile'], hypernyms: [], hyponyms: [], related: ['adaptable'] },
    wordFamily: ['resilience', 'resiliently'],
    grammarPatterns: ['resilient to X'],
    metaphor: '叩かれても元に戻るバネのようなイメージ。',
    commonErrors: ['×resilent（綴り）'],
  },
};

// ── Dashboard ────────────────────────────────────────────────────────────────

const WEEKLY_COUNTS = [3, 5, 2, 8, 4, 6, 9];

export const dashboardSnapshot: DashboardSnapshot = {
  dueTodayCount: 12,
  mastery: { new: 48, learning: 32, consolidating: 21, mastered: 15, total: 116 },
  reading: [{ passageId: 'p1', title: '交渉のテーブルで', level: 'B2', percent: 45, sentenceIndex: 3 }],
  weekly: WEEKLY_COUNTS.map((reviewCount, i) => ({ dayStartMs: TODAY - (6 - i) * DAY_MS, reviewCount })),
  dueList: [
    { wordId: 'decisive', dueAt: TODAY, mastery: 'Learning' },
    { wordId: 'cordial', dueAt: TODAY, mastery: 'Consolidating' },
    { wordId: 'negotiation', dueAt: TODAY + DAY_MS, mastery: 'Learning' },
    { wordId: 'leverage', dueAt: TODAY + 2 * DAY_MS, mastery: 'New' },
    { wordId: 'resilient', dueAt: TODAY + 3 * DAY_MS, mastery: 'Mastered' },
  ],
  streakDays: 6,
  recent: [
    { passageId: 'p1', title: '交渉のテーブルで', theme: '交渉', createdAt: FIXED_NOW - DAY_MS, completed: false },
    { passageId: 'p2', title: '四半期レビュー', theme: '財務', createdAt: FIXED_NOW - 2 * DAY_MS, completed: true },
  ],
};

export const dueGlosses: Record<string, string> = {
  decisive: '決定的な',
  cordial: '友好的な',
  negotiation: '交渉',
  leverage: '影響力',
  resilient: '回復力のある',
};

// ── Review session ───────────────────────────────────────────────────────────

const USER = 'gallery' as UserId;
function state(wordId: string, over: Partial<WordSchedulingState> = {}): WordSchedulingState {
  return {
    userId: USER,
    wordId,
    stability: 5,
    difficulty: 5,
    reps: 2,
    lapses: 0,
    learningStep: 0,
    lastReviewAt: FIXED_NOW - 4 * DAY_MS,
    dueAt: FIXED_NOW - DAY_MS,
    lastSource: 'review',
    mastery: 'Learning',
    reappearCount: 1,
    ...over,
  };
}

export const reviewQueue: ReviewItem[] = [
  {
    state: state('decisive', { stability: 6 }),
    headword: 'decisive',
    ipa: '/dɪˈsaɪsɪv/',
    context: { before: 'It was a ', target: 'decisive', after: ' moment for the team.' },
    answer: { meaningJa: '決定的な', detailJa: '結果を大きく左右するような', collocations: ['a decisive factor', 'decisive action'], register: 'neutral', synonyms: ['conclusive'] },
  },
  {
    state: state('cordial', { stability: 9, mastery: 'Consolidating' }),
    headword: 'cordial',
    ipa: '/ˈkɔːrdiəl/',
    context: { before: 'They kept a ', target: 'cordial', after: ' tone in the meeting.' },
    answer: { meaningJa: '友好的な', collocations: ['a cordial welcome'], register: 'formal' },
  },
];

// ── Setup ────────────────────────────────────────────────────────────────────

export const setupCandidates: CandidateWord[] = [
  { wordId: 'decisive', surface: 'decisive' },
  { wordId: 'cordial', surface: 'cordial' },
  { wordId: 'negotiation', surface: 'negotiation' },
  { wordId: 'leverage', surface: 'leverage' },
  { wordId: 'resilient', surface: 'resilient' },
];

export const setupInitial: Partial<SetupConfig> = {
  level: 'B2',
  themes: ['交渉', '会議'],
  newWordRatio: 0.3,
  length: 'medium',
};

// ── Wordbook ─────────────────────────────────────────────────────────────────

export const wordbookEntries: WordbookEntry[] = [
  { wordId: 'decisive', headword: 'decisive', gloss: '決定的な', stage: 'Learning' },
  { wordId: 'cordial', headword: 'cordial', gloss: '友好的な', stage: 'Consolidating' },
  { wordId: 'negotiation', headword: 'negotiation', gloss: '交渉', stage: 'Learning' },
  { wordId: 'leverage', headword: 'leverage', gloss: '影響力', stage: 'New' },
  { wordId: 'resilient', headword: 'resilient', gloss: '回復力のある', stage: 'Mastered' },
  { wordId: 'concede', headword: 'concede', gloss: '譲歩する', stage: 'New' },
];
