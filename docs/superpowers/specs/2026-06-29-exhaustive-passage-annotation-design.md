# 本文の網羅的アノテーション（気づき）設計書

- 日付: 2026-06-29
- 対象機能: 既存 `english-vocabulary-learning` の Reading「気づき（Notice）」拡張
- ステータス: 設計（実装計画前）

## 1. 背景と課題

ユーザー報告:「本文中のコロケーションやコノテーション、イディオムなどを全て拾うことができていません。」

現状の Notice（気づき）機能は、本文を網羅的に注釈する仕組みではなく、**少数のキュレーション**として設計されている。捕捉が不足する根本原因は次の4点:

1. **3〜5件の上限**: 本文生成プロンプト（`server/llm/schema.ts` の `PASSAGE_SYSTEM`）が「notice cues を 3〜5 件、3カテゴリ以上にまたがらせる（全部 collocation にするな）」と指示しており、本文がどれだけ表現に富んでいても数件しか出ない。
2. **`idiom` カテゴリが存在しない**: `NoticeCategory`（`src/types/domain.ts`, `server/llm/schema.ts`）に connotation/collocation/register/… はあるが **idiom が無い**。`WordData.more.idioms` は取得されるが、本文の気づきとして表に出る経路が無い。
3. **ターゲット語の事前取得属性にしか接地しない**: `isCueGrounded`（`src/domain/generation/noticeGrounding.ts`）が、ターゲット語に対して事前取得済みの属性を引用する cue 以外を落とす。非ターゲット語の表現や、属性として渡されていない表現は捕捉できない。
4. **`collocationSpans` もターゲット語の `core.collocations` のみ**（`schema.ts`）。

結論: 現状は「あなたの学習語について 3〜5 件の気づきを見せる」機能であり、「本文中の注目すべき表現を網羅的に注釈する」機能ではない。本要望はこの**振る舞いの変更**である。

## 2. 目的・スコープ

### ゴール
- 本文**全体**を対象に、学習者が立ち止まるべき表現を網羅的にアノテーションする。
- ターゲット学習語との結合を解消し、本文に出現する任意の表現を対象にする。

### 採用方針（ブレインストーミングでの決定）
- **捕捉範囲**: 本文全体に対して網羅的（ターゲット語に限定しない）。
- **表示**: 現行の丸数字バッジ＋右レール（`NoticeRail`）を踏襲（データ形・UI をほぼ維持）。
- **生成方式**: 本文生成とは別の**専用アノテーションパス**（2回目の LLM 呼び出し）。検証用の追加呼び出しは今回入れない（将来課題）。
- **カテゴリ**: `collocation, idiom, phrasal_verb, connotation, register, grammar_pattern`（`idiom`・`phrasal_verb` を新設）。
- **呼び出し位置**: オーケストレーター内、バリデーション通過後。

### 非スコープ
- アノテーションの正しさを再検証する追加の LLM 呼び出し（adversarial verify）。将来必要なら追加。
- コロケーションの青チップ（`collocationSpans`）はターゲット語のみ継続（全コロケーションのチップ化はしない）。
- 外部テキスト貼り付け用 UI。ただしアーキテクチャ上はアノテーションパスが任意の本文に適用可能な形にしておく。

## 3. アーキテクチャ / データフロー

```
runGenerationPipeline (controller, 変更なし)
  └─ orchestrator.generate(req)
        ├─ generate → validate → repair          # 現行ループ（変更なし）
        └─ 受理された PassageOutput に対して:
             annotatePassage(sentences, level)    # 新規: 2回目の LLM 呼び出し
               → noticeCues を置換
               → tokenizer.index(passageId, …)    # 既存の indexing
```

- 新シーム: `ContentGateway.annotatePassage?(sentences, level): Promise<NoticeCue[]>`（`suggestWords?` と同様の **optional**）。サーバは `sentences`（tokens）と `level` のみ必要とする。
- 新エンドポイント: `POST /api/passages:annotate`（`server/llm/handler.ts` にルート追加）。
- 新プロバイダ関数: `server/llm/providers.ts` の `annotatePassage(env, req, fetchImpl)`。
- サーバは既存の `reanchorSpans` / `locateAnchor` / `findRun` を再利用し、cue の `anchorText`（本文から逐語コピー）から正しい token span を再導出する（バッジのズレ防止機構をそのまま流用）。
- **グレースフルデグレード**: アノテーション呼び出しが失敗（503/timeout 等）した場合、気づき無しで本文を配信する（音声合成段と同じ思想）。生成自体は失敗させない。

### 呼び出し位置の詳細（オーケストレーター内）
`createGenerationOrchestrator.generate` の成功 2 経路（通常受理・cue ドロップ救済）を、共通の `finalize(passage)` に集約する:

```
finalize(passage):
  try:
    cues = await deps.gateway.annotatePassage?.(passage.sentences, req.level)
    if cues: passage = { ...passage, noticeCues: cues }
  catch: /* デグレード: 既存(空)の noticeCues のまま */
  return ok(tokenizer.index(passageId, passage))
```

- アノテーションは**最終受理本文に対して1回だけ**実行（repair の各試行では走らせない）。
- `annotatePassage` 未実装のゲートウェイ（テスト/モック）では単にスキップ → 既存挙動を壊さない。

## 4. 接地（grounding）モデルの変更（本設計の核心）

属性接地は「網羅的・非ターゲット」では成立しないため再定義する。

- **位置接地は維持**: `span_out_of_range` と `cue_surface_mismatch`（`span` のトークンが `anchorText` を逐語レンダリングする）。これがバッジを正しい語に固定する保証であり、現行のズレ防止を引き継ぐ。
- **属性接地は撤廃**: notices に対する `cue_unattested`・`cue_category_mismatch` を適用しない。`NoticeCue.wordId` と `sourceAttribute` を **optional 化**（cue がたまたまターゲット語に重なった場合のみ設定）。
- 表現の**正しさ**（本当にイディオム/コロケーションか）は、アノテーションプロンプトの品質基準に依存する:「学習者が立ち止まるべき表現を網羅的に。`{level}` CEFR 以上で高確度のもののみ。透明で自明な語連結は除く。」

## 5. カテゴリ

- `NoticeCategory`（`src/types/domain.ts` と `server/llm/schema.ts` の `NOTICE_CATEGORIES`）に **`idiom`・`phrasal_verb`** を追加。
- アノテーションパスが扱うのは: `collocation, idiom, phrasal_verb, connotation, register, grammar_pattern`。
- 既存の word-property 系カテゴリ（etymology / semantic_network / synonym_nuance / word_family / frequency / common_error）は型として残すが、本アノテーションパスでは積極的に使わない。
- スタイル（`src/ui/theme/tokens.ts`）:
  - `NOTICE_LABELS` に `idiom: 'イディオム'`, `phrasal_verb: '句動詞'` を追加。
  - `NOTICE_GROUP`: **`idiom` は terracotta グループ**（`colors.terracotta` 系の新グループ）で目立たせる。`phrasal_verb` は collocation（青）グループを流用。
  - `Legend.tsx` にイディオムのスウォッチを追加（任意）。

## 6. 密度制御

- バッジ＋レールは現行どおり。`PassageRenderer` は同一 token 位置の複数 cue・reading 順採番に既に対応しているため構造変更なし。
- 可読性と出力トークン予算を守るため、ハードな全体上限ではなく**ソフト上限（1文あたり〜2〜3件）を品質基準としてプロンプトで指示**。
- ターゲット語の青コロケーションチップはターゲットのみ継続（非ターゲットのコロケーションはバッジのみ）。

## 7. サーバ実装詳細

- `ANNOTATION_SYSTEM` プロンプト + `ANNOTATION_JSON_SCHEMA`:
  - 出力 = `{ noticeCues: [{ span, category, anchorText, explanationJa }] }`。
  - `anchorText` は対象文のトークンから逐語コピー、`category` は上記6種、`explanationJa` は短い日本語解説。
  - `span` は手計算させず、サーバが `anchorText` から再導出（既存ロジック流用）。
- `maxTokensForLength` 同様、本文長に応じた `max_tokens` を確保（網羅出力のため本文生成より広めの予算）。
- 入力: `sentences`（tokens 配列）, `level`。出力: 位置検証済み・reading 順採番済みの `noticeCues`。
- 既存 `reanchorSpans` の notice 部分（接地ドロップ含む）はアノテーションパス用に再構成し、属性接地ドロップを外して**位置接地のみ**にする。

## 8. 型・バリデータ変更

- `src/types/domain.ts`: `NoticeCategory` に追加、`NoticeCue.wordId?`・`sourceAttribute?` を optional 化。
- `src/domain/generation/passageValidator.ts`: notices の接地チェック（`cue_unattested`/`cue_category_mismatch`）を緩和し、位置系（`span_out_of_range`/`cue_surface_mismatch`）のみ適用。
- `src/domain/generation/noticeGrounding.ts`: `CATEGORY_ATTRIBUTES` に新カテゴリのキーを追加（`idiom`・`phrasal_verb` は接地対象を持たない＝空配列）。ターゲット collocation 経路で参照が残る場合のみ既存利用を維持。
- 本文生成（`PASSAGE_SYSTEM`）からは notice cues の指示ブロックを削除。`PassageOutput.noticeCues` は型としては保持し、生成器は空 `[]` を返す（アノテーションパスが上書き）。

## 9. UI 変更

- `tokens.ts`: 新カテゴリのラベル・色グループ（上記5）。
- `Legend.tsx`: イディオムのスウォッチ追加（任意）。
- `NoticeRail.tsx` / `PassageRenderer.tsx`: 構造変更なし（カテゴリ増分はスタイル経由で吸収）。

## 10. エラー処理

- `annotatePassage` 失敗 → notices 無しで本文配信（生成は成功扱い）。
- `anchorText` が本文に見つからない cue → サーバ側で除外（落とす）。
- 上流 LLM の `max_tokens`/`refusal` → 当該アノテーション結果を空として扱い、デグレード。

## 11. テスト戦略

- サーバ: `annotatePassage` の新規テスト（reanchor、位置検証、idiom/phrasal_verb カテゴリ、失敗時デグレード）。
- バリデータ: 接地ベースの cue テストを削除/緩和、位置テストは維持。
- `providers.test.ts`: 本文生成器が notices を出さなくなる前提へ更新。
- UI: `tokens`/`Legend` の新カテゴリテスト。`NoticeRail`/`PassageRenderer` は基本不変。
- オーケストレーター: アノテーション付与 + 失敗時デグレードのテスト。

## 12. 移行・影響

- 本文生成プロンプトから notice 指示を撤去。
- 既存の notice 関連テストの更新が必要（破壊的）。
- `ContentGateway` 実装（`HttpContentGateway`）に `annotatePassage` 追加、`/api/passages:annotate` を配線。

## 13. 未解決事項 / 将来課題

- 検証パス（adversarial verify）でノイズ低減。
- 必要なら全コロケーションのチップ化や、カテゴリ別フィルタ UI。
- 外部テキスト貼り付け対応（アノテーションパスは流用可能）。
