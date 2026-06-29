# 本文の網羅的アノテーション 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本文全体を対象に、コロケーション・イディオム・句動詞・コノテーション・レジスター・文法パターンを網羅的に「気づき(NoticeCue)」として注釈する。

**Architecture:** 本文生成（`generatePassage`）は本文＋ターゲット語スパンのみを担当し、気づきは出さない。最終受理本文に対して**専用のアノテーションパス**（2回目のLLM呼び出し `annotatePassage`）を走らせ、`anchorText` から位置を再導出した `NoticeCue[]` を生成する。オーケストレーターがバリデーション通過後に呼び出し、失敗時はグレースフルデグレード（気づき無し）。

**Tech Stack:** TypeScript / React 19 / Vitest / Vite。LLMはOpenAI(既定)・Anthropic両対応のRESTプロキシ（`server/llm`）。

## Global Constraints

- 接地の置換: 属性接地は廃止し、**位置接地のみ**（`span` のトークンが `anchorText` を逐語レンダリングする）を維持する。
- バッジのズレ防止: cueの`span`は必ず`anchorText`から再導出する（モデルのトークン番号は信用しない）。
- 既存のUI（丸数字バッジ＋`NoticeRail`）とデータ形は維持。`NoticeCue` は後方互換のため `wordId`/`sourceAttribute` を optional 化するのみ。
- アノテーション対象カテゴリ: `collocation, idiom, phrasal_verb, connotation, register, grammar_pattern`。
- コミットは**ユーザーが依頼したときのみ**。作業ツリーには未コミットのWIP（cue採番・jump-to-badge）が同領域にあるため、各タスクの「Commit」ステップは実行を保留し、ユーザー承認後にまとめて行う。
- テストランナー: `pnpm test`（vitest run）。型: `pnpm typecheck`。

---

### Task 1: ドメイン型と接地マップに idiom / phrasal_verb を追加

**Files:**
- Modify: `src/types/domain.ts`（`NoticeCategory`, `NoticeCue`, 新規 `PassageAnnotationRequest`）
- Modify: `src/domain/generation/noticeGrounding.ts`（`CATEGORY_ATTRIBUTES`）
- Test: `src/domain/generation/noticeGrounding.test.ts`

**Interfaces:**
- Produces: `NoticeCategory`（`'idiom' | 'phrasal_verb'` 追加）、`NoticeCue.wordId?`/`sourceAttribute?`（optional）、`interface PassageAnnotationRequest { sentences: Sentence[]; level: Cefr }`。

- [ ] **Step 1: 失敗するテストを書く** — `noticeGrounding.test.ts` に追記

```ts
  it('treats idiom and phrasal_verb as never attribute-grounded (the annotation pass asserts them)', () => {
    expect(isCueGrounded('idiom', { more: { idioms: ['bite the bullet'] } })).toBe(false);
    expect(isCueGrounded('phrasal_verb', {})).toBe(false);
  });
```

- [ ] **Step 2: 失敗を確認** — `pnpm test src/domain/generation/noticeGrounding.test.ts`（型エラー: `'idiom'` は `NoticeCategory` でない、で FAIL）

- [ ] **Step 3: 型を追加** — `src/types/domain.ts`

`NoticeCategory` の末尾に追加:

```ts
export type NoticeCategory =
  | 'connotation'
  | 'collocation'
  | 'register'
  | 'etymology'
  | 'semantic_network'
  | 'synonym_nuance'
  | 'grammar_pattern'
  | 'word_family'
  | 'frequency'
  | 'common_error'
  | 'idiom'
  | 'phrasal_verb';
```

`NoticeCue` の `wordId`/`sourceAttribute` を optional 化:

```ts
export interface NoticeCue {
  index: number;
  span: SpanRef;
  category: NoticeCategory;
  /**
   * Legacy target-word grounding key (only the old target-word cue path set this). Exhaustive
   * annotation-pass cues omit it; grounding for those is location-only (anchorText ⇄ span).
   */
  wordId?: string;
  sourceAttribute?: string;
  anchorText: string;
  explanationJa: string;
}
```

`GenerationRequest` の定義の直後に新インターフェースを追加:

```ts
/** Input to the exhaustive annotation pass: the finished passage's tokens + its CEFR level. */
export interface PassageAnnotationRequest {
  sentences: Sentence[];
  level: Cefr;
}
```

- [ ] **Step 4: 接地マップを拡張** — `src/domain/generation/noticeGrounding.ts` の `CATEGORY_ATTRIBUTES` に2行追加（`common_error` の後）:

```ts
  common_error: ['more.commonErrors', 'commonErrors'],
  idiom: [],
  phrasal_verb: [],
```

- [ ] **Step 5: テスト通過を確認** — `pnpm test src/domain/generation/noticeGrounding.test.ts`（PASS）

- [ ] **Step 6: Commit（保留）** — Global Constraints によりユーザー承認まで保留。

---

### Task 2: 新カテゴリの表示スタイル（design tokens）

**Files:**
- Modify: `src/ui/theme/tokens.ts`（`NOTICE_LABELS`, `NOTICE_GROUP`, 新 `IDIOM` グループ）
- Test: `src/ui/theme/tokens.test.ts`

**Interfaces:**
- Consumes: Task 1 の `NoticeCategory`。
- Produces: `noticeStyle('idiom')` / `noticeStyle('phrasal_verb')` が有効な `NoticeStyle` を返す。

- [ ] **Step 1: 失敗するテストを書く** — `tokens.test.ts` に追記し、既存の網羅テストの配列も更新

新規テスト:

```ts
  it('styles idiom with the terracotta group and phrasal_verb with the blue group', () => {
    expect(noticeStyle('idiom')).toMatchObject({ label: 'イディオム', color: '#C07A63', numberColor: '#C07A63' });
    expect(noticeStyle('phrasal_verb')).toMatchObject({ label: '句動詞', numberColor: '#3D6CB0' });
  });
```

既存の `'returns a defined style for every notice category'` の `categories` 配列末尾に `'idiom', 'phrasal_verb'` を追加:

```ts
      'frequency',
      'common_error',
      'idiom',
      'phrasal_verb',
    ] as const;
```

- [ ] **Step 2: 失敗を確認** — `pnpm test src/ui/theme/tokens.test.ts`（FAIL: `noticeStyle('idiom')` の label 等が未定義）

- [ ] **Step 3: スタイルを実装** — `src/ui/theme/tokens.ts`

`REGISTER` 定義の直後に `IDIOM` を追加:

```ts
const IDIOM: Omit<NoticeStyle, 'label'> = { color: colors.terracotta, bg: '#F3E9E4', numberColor: colors.terracotta };
```

`NOTICE_LABELS` に2行追加（`common_error` の後）:

```ts
  common_error: '誤用注意',
  idiom: 'イディオム',
  phrasal_verb: '句動詞',
```

`NOTICE_GROUP` に2行追加（`common_error` の後）:

```ts
  common_error: REGISTER,
  idiom: IDIOM,
  phrasal_verb: COLLOCATION,
```

- [ ] **Step 4: テスト通過を確認** — `pnpm test src/ui/theme/tokens.test.ts`（PASS）

- [ ] **Step 5: Commit（保留）**

---

### Task 3: バリデータを optional cue フィールドに対応（位置のみ接地）

**Files:**
- Modify: `src/domain/generation/passageValidator.ts`（cueループのガード）
- Test: `src/domain/generation/passageValidator.test.ts`

**Interfaces:**
- Consumes: Task 1 の optional `NoticeCue.wordId`/`sourceAttribute`。
- Produces: 振る舞い変更なし（`sourceAttribute`/`wordId` を持つ既存cueは従来通り判定、両方欠くcueは位置のみ判定）。

- [ ] **Step 1: 失敗するテストを書く** — `passageValidator.test.ts` に追記

```ts
  it('does not flag an annotation cue that omits wordId/sourceAttribute (location-only grounding)', () => {
    const report = passageValidator.validate(
      basePassage({
        noticeCues: [
          { index: 1, span: { sentenceIndex: 0, tokenStart: 3, tokenEnd: 4 }, category: 'idiom', anchorText: 'negotiate', explanationJa: '' },
        ],
      }),
      ctx,
    );
    expect(report.violations.some((v) => v.kind === 'cue_unattested' || v.kind === 'cue_category_mismatch')).toBe(false);
    expect(report.ok).toBe(true);
  });
```

- [ ] **Step 2: 失敗を確認** — `pnpm test src/domain/generation/passageValidator.test.ts`
  Expected: 型エラー（`cue.sourceAttribute` が `string | undefined` を `allowed.includes()` に渡せない）でFAIL。

- [ ] **Step 3: ガードを実装** — `src/domain/generation/passageValidator.ts` のcueループ後半（`const allowed = ...` 以降）を置換:

```ts
    // Attribute-grounding applies only to legacy target-word cues (those that declare a
    // sourceAttribute / wordId). Exhaustive annotation-pass cues omit both and are validated by
    // location only (above); their correctness is the annotation pass's responsibility.
    const allowed = CATEGORY_ATTRIBUTES[cue.category];
    if (cue.sourceAttribute !== undefined && !allowed.includes(cue.sourceAttribute)) {
      violations.push({
        kind: 'cue_category_mismatch',
        detail: `cue #${cue.index} category ${cue.category} cites "${cue.sourceAttribute}"`,
        cueIndex: cue.index,
      });
      continue;
    }
    if (cue.wordId !== undefined) {
      const target = targetById.get(cue.wordId);
      // Ground by category (not the literal sourceAttribute) — models are inconsistent about the
      // `more.` prefix, so a cue is attested when the category's canonical attribute is present.
      if (!isCueGrounded(cue.category, target?.attributes)) {
        violations.push({
          kind: 'cue_unattested',
          detail: `cue #${cue.index} ${cue.category} not grounded for ${cue.wordId}`,
          cueIndex: cue.index,
        });
      }
    }
```

- [ ] **Step 4: テスト通過を確認** — `pnpm test src/domain/generation/passageValidator.test.ts`（新規含め全PASS。既存の `cue_unattested`/`cue_category_mismatch` テストは sourceAttribute/wordId を与えているので従来通り検出される）

- [ ] **Step 5: Commit（保留）**

---

### Task 4: サーバ側アノテーションパス（schema + provider + handler）

**Files:**
- Modify: `server/llm/schema.ts`（`NOTICE_CATEGORIES`、`PASSAGE_SYSTEM` から notice 指示削除、`ANNOTATION_*` 追加）
- Modify: `server/llm/providers.ts`（`reanchorSpans` から cue 処理除去、`anchorCues`/`annotatePassage` 追加、import整理）
- Modify: `server/llm/handler.ts`（`/api/passages:annotate` ルート）
- Test: `server/llm/providers.test.ts`（旧cueテストの整理＋`annotatePassage` テスト群）

**Interfaces:**
- Consumes: Task 1 の `PassageAnnotationRequest`, `NoticeCue`, `NoticeCategory`。
- Produces:
  - `export const ANNOTATION_CATEGORIES`（`readonly string[]` 互換のタプル）
  - `export const ANNOTATION_JSON_SCHEMA`
  - `export function buildAnnotationMessages(req: PassageAnnotationRequest): { system: string; user: string }`
  - `export function annotationMaxTokens(sentenceCount: number): number`
  - `export async function annotatePassage(env: Env, req: PassageAnnotationRequest, fetchImpl?): Promise<NoticeCue[]>`

- [ ] **Step 1: 失敗するテストを書く** — `server/llm/providers.test.ts`

import行に `annotatePassage` を追加:

```ts
import { ProviderError, generatePassage, getWordData, suggestWords, annotatePassage, type Env } from './providers';
```

ファイル末尾に新describeを追加:

```ts
describe('annotatePassage', () => {
  const sentences = [
    { tokens: ['The', 'board', 'will', 'bite', 'the', 'bullet', '.'], translationJa: '' },
    { tokens: ['It', 'paid', 'off', '.'], translationJa: '' },
  ];

  it('re-derives each cue span from its verbatim anchorText and numbers them in reading order', async () => {
    const reply = {
      noticeCues: [
        // Listed out of reading order; the model's indices are unreliable (deliberately wrong here).
        { span: { sentenceIndex: 1, tokenStart: 0, tokenEnd: 0 }, category: 'phrasal_verb', anchorText: 'paid off', explanationJa: '報われた' },
        { span: { sentenceIndex: 0, tokenStart: 9, tokenEnd: 9 }, category: 'idiom', anchorText: 'bite the bullet', explanationJa: '思い切ってやる' },
      ],
    };
    const fetchImpl = vi.fn(async () => openAiCompletion(reply));
    const cues = await annotatePassage({ OPENAI_API_KEY: 'sk-real-key' }, { sentences, level: 'B1' }, fetchImpl as unknown as typeof fetch);
    expect(cues.map((c) => [c.category, c.index, c.span.sentenceIndex, c.span.tokenStart, c.span.tokenEnd])).toEqual([
      ['idiom', 1, 0, 3, 6], // "bite the bullet"
      ['phrasal_verb', 2, 1, 1, 3], // "paid off"
    ]);
  });

  it('drops a cue whose anchorText does not occur in the passage', async () => {
    const reply = { noticeCues: [{ span: { sentenceIndex: 0, tokenStart: 0, tokenEnd: 1 }, category: 'idiom', anchorText: 'kick the bucket', explanationJa: '' }] };
    const fetchImpl = vi.fn(async () => openAiCompletion(reply));
    const cues = await annotatePassage({ OPENAI_API_KEY: 'sk-real-key' }, { sentences, level: 'B1' }, fetchImpl as unknown as typeof fetch);
    expect(cues).toEqual([]);
  });

  it('degrades to no cues on a truncated (max_tokens) reply', async () => {
    const fetchImpl = vi.fn(async () => openAiCompletion({ noticeCues: [] }, 'length'));
    const cues = await annotatePassage({ OPENAI_API_KEY: 'sk-real-key' }, { sentences, level: 'B1' }, fetchImpl as unknown as typeof fetch);
    expect(cues).toEqual([]);
  });

  it('returns no cues for an empty passage without calling the model', async () => {
    const fetchImpl = vi.fn();
    const cues = await annotatePassage({ OPENAI_API_KEY: 'sk-real-key' }, { sentences: [], level: 'B1' }, fetchImpl as unknown as typeof fetch);
    expect(cues).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
```

旧 cue テストの整理（本文生成はもう気づきを出さない）:
1. `'re-anchors mis-indexed spans and cleans notice cues against the supplied attributes'` を次で**置換**（target/collocation 再アンカーだけ残す）:

```ts
  it('re-anchors mis-indexed target and collocation spans by their declared text', async () => {
    const reqWithTargets: GenerationRequest = {
      level: 'B1',
      themes: ['会議'],
      newWordRatio: 0.3,
      length: 'short',
      targetWords: [{ wordId: 'agenda', surface: 'agenda', masteryDensity: 'new', attributes: { connotation: 'neutral' } }],
    };
    const passage = {
      meta: { title: 't', theme: '会議', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 9 },
      sentences: [{ tokens: ['We', 'set', 'an', 'agenda', 'for', 'the', 'team', 'meeting', '.'], translationJa: '' }],
      targetSpans: [{ sentenceIndex: 0, tokenStart: 0, tokenEnd: 1, wordId: 'agenda', surface: 'agenda', masteryDensity: 'new' }],
      collocationSpans: [{ sentenceIndex: 0, tokenStart: 5, tokenEnd: 9, headWordId: 'agenda', collocationId: 'set an agenda' }],
      noticeCues: [],
    };
    const fetchImpl = vi.fn(async () => openAiCompletion(passage));
    const res = await generatePassage({ OPENAI_API_KEY: 'sk-real-key' }, reqWithTargets, fetchImpl as unknown as typeof fetch);
    expect(res.passage.targetSpans[0]).toMatchObject({ tokenStart: 3, tokenEnd: 4 }); // "agenda"
    expect(res.passage.collocationSpans[0]).toMatchObject({ tokenStart: 1, tokenEnd: 4 }); // "set an agenda"
    expect(res.passage.noticeCues).toEqual([]); // notices now come from the annotation pass
  });
```

2. 次の3テストを**削除**（振る舞いは `annotatePassage` テストへ移管）:
   - `'re-anchors a repeated expression to the occurrence nearest the model\'s declared index'`
   - `'renumbers surviving notice cues to contiguous unique indices (1..N)'`
   - `'numbers notice cues in reading order (by position in the passage)'`（作業ツリーWIPで追加されたテスト。reading順採番の振る舞いは `annotatePassage` の最初のテストで担保）

- [ ] **Step 2: 失敗を確認** — `pnpm test server/llm/providers.test.ts`（`annotatePassage` 未エクスポートでFAIL）

- [ ] **Step 3: schema を実装** — `server/llm/schema.ts`

(a) import に型追加:

```ts
import type { GenerationRequest, PassageAnnotationRequest } from '../../src/types/domain';
```

(b) `NOTICE_CATEGORIES` に2要素追加（`'common_error'` の後）:

```ts
  'common_error',
  'idiom',
  'phrasal_verb',
] as const;
```

(c) `PASSAGE_SYSTEM` から「Notice cues: ...」段落（`'Notice cues: add 3-5 cues...'` 〜 `'about anchorText.'` の行）を**削除**し、末尾の段落を次に**置換**:

```ts
  'When target words ARE requested, collocationSpans should be NON-empty (use the supplied',
  'core.collocations). Leave noticeCues an EMPTY array — in-passage "notice" insights are added by a',
  'separate annotation step, not here. With no target words, write a coherent themed passage with',
  'empty targetSpans/collocationSpans/noticeCues.',
  'meta.newCount/reviewCount count distinct new/review target words; approxWords ~= total words.',
```

(d) `buildPassageMessages` の前（または `WORD_SYSTEM` 群の近く）に追加:

```ts
/** Expression categories the annotation pass may emit (the in-text, phrase-level subset). */
export const ANNOTATION_CATEGORIES = [
  'collocation',
  'idiom',
  'phrasal_verb',
  'connotation',
  'register',
  'grammar_pattern',
] as const;

/** JSON Schema for the annotation reply: a flat list of location-anchored notice cues. */
export const ANNOTATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    noticeCues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          span: {
            type: 'object',
            additionalProperties: false,
            properties: { ...SPAN_PROPS },
            required: ['sentenceIndex', 'tokenStart', 'tokenEnd'],
          },
          category: { type: 'string', enum: [...ANNOTATION_CATEGORIES] },
          anchorText: { type: 'string' },
          explanationJa: { type: 'string' },
        },
        required: ['span', 'category', 'anchorText', 'explanationJa'],
      },
    },
  },
  required: ['noticeCues'],
} as const;

const ANNOTATION_SYSTEM = [
  'You annotate an already-written English reading passage for Japanese learners. You receive the',
  'passage as sentences of TOKENS (one word / punctuation mark / clitic per token, joined with',
  'deterministic spacing) and reply with a SINGLE JSON object {"noticeCues":[...]} matching the',
  'schema — no prose, no markdown, no code fences.',
  '',
  'Find EVERY expression in the passage a learner should pause on, across these categories:',
  'collocation, idiom, phrasal_verb, connotation, register, grammar_pattern. Be exhaustive — do not',
  'stop at a few. For each, add a cue:',
  '- anchorText: the EXACT word(s) in the passage the note is about, copied VERBATIM from that',
  "  sentence's tokens (the joined surface). It MUST appear verbatim in the passage.",
  '- span: { sentenceIndex, tokenStart, tokenEnd } (half-open) for those tokens. Do NOT agonize over',
  '  exact indices — the app re-derives the span from anchorText — but point at the right sentence.',
  '- category: the single best fit from the list above.',
  '- explanationJa: a short Japanese note on what to notice (nuance, fixed phrasing, why it matters).',
  '',
  'Quality bar: only high-confidence, pedagogically worthwhile items at or above the requested CEFR',
  'level. Skip transparent, trivial sequences ("go to", "in the"). Aim for at most ~2-3 cues per',
  'sentence so the page stays readable; add nothing for a sentence with nothing notable. Returning',
  'few or zero cues for a plain passage is fine.',
].join('\n');

export function buildAnnotationMessages(req: PassageAnnotationRequest): { system: string; user: string } {
  const sentences = req.sentences.map((s, i) => ({ sentenceIndex: i, tokens: s.tokens }));
  const user = [
    `Passage CEFR level: ${req.level}.`,
    'Annotate this passage exhaustively. Reply with {"noticeCues":[...]} only.',
    JSON.stringify({ sentences }, null, 2),
  ].join('\n');
  return { system: ANNOTATION_SYSTEM, user };
}

/** Output-token budget for the annotation pass: generous, scales with passage size. */
export function annotationMaxTokens(sentenceCount: number): number {
  return Math.min(4000, 500 + sentenceCount * 150);
}
```

- [ ] **Step 4: provider を実装** — `server/llm/providers.ts`

(a) import の整理:
- `noticeGrounding` からの import 行 `import { CATEGORY_ATTRIBUTES, isCueGrounded } from '../../src/domain/generation/noticeGrounding';` を**削除**。
- `schema` import に `ANNOTATION_JSON_SCHEMA, ANNOTATION_CATEGORIES, buildAnnotationMessages, annotationMaxTokens` を追加。
- domain import に `NoticeCue, PassageAnnotationRequest` を追加。

(b) `reanchorSpans` の **noticeCues ブロックを削除**し、return を変更。`const attrByWord = ...` から `.map((cue, i) => ({ ...cue, index: i + 1 }));` までの `const noticeCues = ...` 文を丸ごと削除し、最後の return を:

```ts
  // Notices are produced by the separate annotation pass (annotatePassage), not by generation.
  return { ...passage, targetSpans, collocationSpans, noticeCues: [] };
```

(c) `suggestWords` の後（ファイル末尾付近）に追加:

```ts
type RawCue = {
  span?: { sentenceIndex?: number; tokenStart?: number; tokenEnd?: number };
  category?: NoticeCue['category'];
  anchorText?: string;
  explanationJa?: string;
};

const ANNOTATION_CATEGORY_SET = new Set<string>(ANNOTATION_CATEGORIES);

/**
 * Turn the annotation model's raw cues into grounded NoticeCues: re-derive each span from its
 * verbatim `anchorText` (the model quotes the text correctly but miscounts indices), drop cues whose
 * anchor cannot be located or whose category is unknown, and number survivors in READING ORDER —
 * matching PassageRenderer, which flushes a badge when the cursor passes the cue's tokenEnd.
 */
function anchorCues(sentences: PassageOutput['sentences'], raw: RawCue[]): NoticeCue[] {
  return raw
    .map((cue): NoticeCue | null => {
      const anchorText = typeof cue.anchorText === 'string' ? cue.anchorText.trim() : '';
      const category = cue.category;
      if (!anchorText || !category || !ANNOTATION_CATEGORY_SET.has(category)) return null;
      const loc = locateAnchor(sentences, anchorText, cue.span?.sentenceIndex ?? 0, cue.span?.tokenStart ?? 0);
      if (!loc) return null;
      return {
        index: 0,
        span: loc,
        category,
        anchorText,
        explanationJa: typeof cue.explanationJa === 'string' ? cue.explanationJa : '',
      };
    })
    .filter((c): c is NoticeCue => c !== null)
    .sort(
      (a, b) =>
        a.span.sentenceIndex - b.span.sentenceIndex ||
        a.span.tokenEnd - b.span.tokenEnd ||
        a.span.tokenStart - b.span.tokenStart,
    )
    .map((cue, i) => ({ ...cue, index: i + 1 }));
}

/** Second LLM pass: exhaustively annotate a finished passage with in-text notice cues. */
export async function annotatePassage(
  env: Env,
  req: PassageAnnotationRequest,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<NoticeCue[]> {
  if (!Array.isArray(req.sentences) || req.sentences.length === 0) return [];
  const { system, user } = buildAnnotationMessages(req);
  const { text, stopReason } = await callModel(
    env,
    fetchImpl,
    system,
    user,
    annotationMaxTokens(req.sentences.length),
    ANNOTATION_JSON_SCHEMA,
    'passage_annotation',
  );
  // Refusal / truncation yield no usable annotations; degrade to none rather than failing.
  if (stopReason === 'refusal' || stopReason === 'max_tokens') return [];
  const parsed = parseJson<{ noticeCues?: unknown }>(text, 'annotation');
  const raw = Array.isArray(parsed.noticeCues) ? (parsed.noticeCues as RawCue[]) : [];
  return anchorCues(req.sentences, raw);
}
```

- [ ] **Step 5: handler を配線** — `server/llm/handler.ts`

(a) import に追加:

```ts
import type { GenerationRequest, WordSuggestionRequest, PassageAnnotationRequest } from '../../src/types/domain';
import { type Env, ProviderError, generatePassage, getWordData, suggestWords, annotatePassage } from './providers';
```

(b) パス定数追加:

```ts
const ANNOTATE_PATH = '/api/passages:annotate';
```

(c) `route` 内、`SUGGEST_PATH` ブロックの後にルート追加:

```ts
  if (path === ANNOTATE_PATH) {
    if (req.method !== 'POST') return sendStatus(res, 405, 'method not allowed');
    const body = await readJson<PassageAnnotationRequest>(req);
    if (!body || !Array.isArray(body.sentences) || !body.level) {
      throw new ProviderError(400, 'Invalid PassageAnnotationRequest body.');
    }
    const noticeCues = await annotatePassage(env, body);
    return sendJson(res, 200, { noticeCues });
  }
```

- [ ] **Step 6: テスト通過を確認** — `pnpm test server/llm/providers.test.ts`（全PASS）

- [ ] **Step 7: Commit（保留）**

---

### Task 5: クライアント ContentGateway に annotatePassage を追加

**Files:**
- Modify: `src/types/ports.ts`（`ContentGateway.annotatePassage?`）
- Modify: `src/infra/content/contentGatewayHttp.ts`（実装 + import）
- Test: `src/infra/content/contentGatewayHttp.test.ts`

**Interfaces:**
- Consumes: Task 1 の `NoticeCue`, `Cefr`, `Sentence`。
- Produces: `ContentGateway.annotatePassage?(sentences: Sentence[], level: Cefr): Promise<NoticeCue[]>`。`HttpContentGateway` は具象メソッドとして実装。

- [ ] **Step 1: 失敗するテストを書く** — `contentGatewayHttp.test.ts` の末尾に追記

```ts
describe('HttpContentGateway.annotatePassage', () => {
  it('posts the sentences + level to /api/passages:annotate and returns the cues', async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    const cue = { index: 1, span: { sentenceIndex: 0, tokenStart: 0, tokenEnd: 1 }, category: 'idiom', anchorText: 'She', explanationJa: '' };
    const gw = gatewayWith(async (url, init) => {
      captured = { url: String(url), init };
      return jsonResponse(200, { noticeCues: [cue] });
    });
    const cues = await gw.annotatePassage(samplePassage.sentences, 'B1');
    expect(captured!.url).toBe('https://api.test/api/passages:annotate');
    expect(captured!.init?.method).toBe('POST');
    expect(JSON.parse(String(captured!.init?.body))).toMatchObject({ level: 'B1' });
    expect(cues).toEqual([cue]);
  });

  it('returns an empty list when the reply has no cues array', async () => {
    const gw = gatewayWith(async () => jsonResponse(200, {}));
    expect(await gw.annotatePassage(samplePassage.sentences, 'B1')).toEqual([]);
  });
});
```

- [ ] **Step 2: 失敗を確認** — `pnpm test src/infra/content/contentGatewayHttp.test.ts`（`gw.annotatePassage` 未実装でFAIL）

- [ ] **Step 3: ポートを拡張** — `src/types/ports.ts`

import に型追加（`./domain` からの import に `Cefr, Sentence, NoticeCue` を加える）:

```ts
import type {
  UserId,
  WordSchedulingState,
  ReviewLogEntry,
  GenerationRequest,
  GenerationResponse,
  WordData,
  WordSuggestionRequest,
  IndexedPassage,
  AudioAsset,
  TimingMap,
  PassageOutput,
  ReadingProgress,
  Settings,
  Cefr,
  Sentence,
  NoticeCue,
} from './domain';
```

`ContentGateway` に optional メソッドを追加（`suggestWords?` の後）:

```ts
  /**
   * Exhaustively annotate an already-generated passage with in-text "notice" cues (collocations,
   * idioms, phrasal verbs, connotation, register, grammar). Optional so lightweight gateways/mocks
   * need not implement it; the orchestrator skips enrichment when it is absent.
   */
  annotatePassage?(sentences: Sentence[], level: Cefr): Promise<NoticeCue[]>;
```

- [ ] **Step 4: 実装** — `src/infra/content/contentGatewayHttp.ts`

import に型追加:

```ts
import type {
  GenerationRequest,
  GenerationResponse,
  StopReason,
  WordData,
  WordSuggestionRequest,
  Cefr,
  Sentence,
  NoticeCue,
} from '../../types/domain';
```

`suggestWords` メソッドの後に追加:

```ts
  async annotatePassage(sentences: Sentence[], level: Cefr): Promise<NoticeCue[]> {
    const body = await this.request<{ noticeCues: NoticeCue[] }>('/api/passages:annotate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sentences, level }),
    });
    return Array.isArray(body.noticeCues) ? body.noticeCues : [];
  }
```

- [ ] **Step 5: テスト通過を確認** — `pnpm test src/infra/content/contentGatewayHttp.test.ts`（PASS）

- [ ] **Step 6: Commit（保留）**

---

### Task 6: オーケストレーター統合（受理後にアノテーション、失敗時デグレード）

**Files:**
- Modify: `src/domain/generation/generationOrchestrator.ts`（`finalize` 導入）
- Test: `src/domain/generation/generationOrchestrator.test.ts`

**Interfaces:**
- Consumes: Task 5 の `ContentGateway.annotatePassage?`。
- Produces: 受理本文の `noticeCues` をアノテーション結果で置換した `IndexedPassage`。`annotatePassage` 未実装/失敗時は既存cuesのまま（=空）で配信。

- [ ] **Step 1: 失敗するテストを書く** — `generationOrchestrator.test.ts` の `describe('GenerationOrchestrator', ...)` 内に追記

```ts
  it('enriches the accepted passage with cues from the annotation pass', async () => {
    const { gateway } = queueGateway([goodResponse]);
    const enriched: ContentGateway = {
      ...gateway,
      annotatePassage: async () => [
        { index: 1, span: { sentenceIndex: 0, tokenStart: 3, tokenEnd: 4 }, category: 'idiom', anchorText: 'negotiate', explanationJa: '' },
      ],
    };
    const orch = createGenerationOrchestrator({ gateway: enriched, passageId: 'p1' });
    const result = await orch.generate(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.source.noticeCues.map((c) => c.category)).toEqual(['idiom']);
    }
  });

  it('degrades (still ships the passage) when the annotation pass throws', async () => {
    const { gateway } = queueGateway([goodResponse]);
    const failing: ContentGateway = {
      ...gateway,
      annotatePassage: async () => {
        throw new Error('annotate down');
      },
    };
    const orch = createGenerationOrchestrator({ gateway: failing, passageId: 'p1' });
    const result = await orch.generate(req);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.renderText).toContain('negotiate');
  });
```

- [ ] **Step 2: 失敗を確認** — `pnpm test src/domain/generation/generationOrchestrator.test.ts`
  Expected: `enriches ...` が FAIL（現状は `goodResponse` の register cue のまま、annotation で置換されない）。

- [ ] **Step 3: finalize を実装** — `src/domain/generation/generationOrchestrator.ts` の `generate` を変更

`const ctx = ...` の後に `finalize` を定義:

```ts
    const ctx = contextFor(req, deps.cefrOf);

    // After a passage is accepted, enrich it with the exhaustive annotation pass (a second LLM call
    // run ONCE on the final text). Failure is non-fatal: ship the passage with whatever cues it has.
    const finalize = async (passage: PassageOutput): Promise<Result<IndexedPassage, GenerationError>> => {
      let noticeCues = passage.noticeCues;
      try {
        const annotated = await deps.gateway.annotatePassage?.(passage.sentences, req.level);
        if (annotated) noticeCues = annotated;
      } catch {
        // Degrade: keep the passage readable; notices are simply absent.
      }
      return ok(tokenizer.index(passageId, { ...passage, noticeCues }));
    };

    let attemptReq = req;
```

成功2経路の return を差し替え:
- `if (report.ok) { return ok(tokenizer.index(passageId, resp.passage)); }` → `if (report.ok) { return finalize(resp.passage); }`
- salvage の `if (salvaged && validator.validate(salvaged, ctx).ok) { return ok(tokenizer.index(passageId, salvaged)); }` → `... { return finalize(salvaged); }`

- [ ] **Step 4: テスト通過を確認** — `pnpm test src/domain/generation/generationOrchestrator.test.ts`（既存含め全PASS。既存テストのgatewayは `annotatePassage` を持たないため `?.` でスキップされ、振る舞い不変）

- [ ] **Step 5: Commit（保留）**

---

### Task 7: 全体検証

- [ ] **Step 1: 型チェック** — `pnpm typecheck`（エラー0）
- [ ] **Step 2: 全テスト** — `pnpm test`（全PASS）
- [ ] **Step 3: Lint** — `pnpm lint`（エラー0；未使用 import 等の検出）
- [ ] **Step 4: 設計書との突き合わせ** — `docs/superpowers/specs/2026-06-29-exhaustive-passage-annotation-design.md` の各節がタスクで満たされているか確認。
- [ ] **Step 5: Commit（保留）** — ユーザー承認後、Task1〜7 をまとめて（またはタスク単位で）コミット。

## Self-Review メモ
- **Spec coverage:** 設計§3=Task6、§4=Task1/3、§5=Task1/2/4、§7=Task4、§8=Task1/3、§9=Task2、§10=Task4/6、§11=各Task。Legend(§9, 任意)はYAGNIで対象外（レール側チップでカテゴリ名は表示済み）。
- **Placeholders:** なし。各ステップに実コードを記載。
- **Type consistency:** `annotatePassage` の3形態（provider `(env, PassageAnnotationRequest)` / gateway `(sentences, level)` / 呼び出し `?.(passage.sentences, req.level)`）整合。`NoticeCue.wordId/sourceAttribute` optional 化は anchorCues（両欠）と既存fixture（両有）双方で成立。
