# 情報アーキテクチャ刷新：ホーム生成・記事ライブラリ・URL 対応リーダー 設計書

- 日付: 2026-07-02
- 対象機能: 既存 Lexia（`learning-experience-overhaul`）のナビゲーション／画面構成の刷新
- ステータス: 設計（実装計画前）

## 1. 背景と課題

ユーザー要望（3点）:

1. **物語を生成する画面をトップページに配置してほしい。**
2. **「読む」タブは不要。** 各文章はその文章の URL に飛ぶ形にしたい。
3. **記事の検索機能がほしい。**

現状の情報アーキテクチャ:

- ルートは `AppShell` 配下の5つ（`src/ui/router.tsx`）:
  - `/`（`DashboardRoute`）/ `/setup`（`SetupRoute` = 生成）/ `/read`（`ReadingRoute`）/ `/review` / `/wordbook`
- `TopNav`（`src/ui/shared/TopNav.tsx`）は `ダッシュボード / 学習をはじめる / 読む / 復習 / 単語帳` の5タブ。
- **リーダーはセッション駆動でURL非対応**: `/read` はメモリ上の `c.session.getState().passage` を描画する。TTS 合成・タイミング・追従ハイライト・進捗はすべて `session.startPassage` に紐づく（`src/state/controllers/*`, `AppShell.tsx`）。URL は文章を特定しない。
- **検索・全件一覧が存在しない**: `PassageRepository` は `get(passageId) / recent / byStory` のみ、`StoryRepository` は `get / put / recent` のみ。ダッシュボードの「最近読んだ文章」以外に過去記事へ辿る導線がない。
- `passageId` は記事＝ランダムID、物語章＝`${storyId}:${chapterIndex}` の形（`src/ui/app/routes.tsx`, `generationController.ts`）。

結論: 本要望はナビゲーションと画面構成（情報アーキテクチャ）の変更であり、視覚デザイン（トークン）の刷新ではない。生成の再設計や読解ロジックの変更も含まない。

## 2. 目的・スコープ

### ゴール
- 生成をアプリの入口（ホーム）に置く。
- 「読む」タブを廃し、各文章を **URL で特定できる**ようにする（ディープリンク・リロード・共有が可能）。
- 過去の文章を **ランク付き全文検索**で探せるライブラリを新設する。
- 物語は **ディレクトリ構造**（物語トップ＝章の一覧）で辿れるようにする。

### 採用方針（ブレインストーミングでの決定）
- **ホーム構成**: 生成フォームをヒーローに。その下に学習サマリ（連続日数・本日の復習語数・読みかけ再開・最近の記事）を軽くまとめる。既存ダッシュボードの習熟度内訳・週間チャートはページ下部に温存する。
- **検索対象と並び**: 本文・日本語訳も含む全文一致。ただし **タイトル ＞ テーマ（intent）／レベル ＞ 本文・訳** の重み付けでスコア順に並べ替える。
- **物語の探索**: ライブラリでは物語を **1つのディレクトリ項目**として表示（タイトル・章数・進捗）。クリックで物語トップへ。
- **URL 対応方式**: 既存セッションへ「ID から開く」コントローラを新設する方式（後述 4）。セッションを廃してURLを唯一の真実源にする大規模リファクタは採らない。
- **検索実装**: ドメイン層の純関数 `passageSearch` ＋ `PassageRepository.all()` を新設し、クライアント側でスコアリング。Dexie 全文インデックスやサーバ検索は採らない（データは学習者1人分のローカル IndexedDB、数十〜低数百件規模）。

### 非スコープ
- 生成ロジック・プロンプト・検証パイプラインの変更。
- 読解画面（`ReadingScreen`）の内部レイアウト刷新（`newReadingLayout` は現状維持）。
- デザイントークン（色・タイポ）の追加・変更。既存トークンのみ使用。
- 外部URLからの記事取り込み、クラウド同期。
- 全文検索の高度化（形態素解析・あいまい検索・ハイライト抜粋）。将来課題。

## 3. アーキテクチャ / データフロー

### 3.1 ルーティング（`src/ui/router.tsx`）

ナビは5→**4タブ**（`ホーム / 文章 / 復習 / 単語帳`）。`ダッシュボード`・`学習をはじめる`・`読む` の3タブは消える。

| パス | 画面 | 役割 |
|---|---|---|
| `/` | **HomeRoute**（新） | 生成ヒーロー＋学習サマリ |
| `/library` | **LibraryRoute**（新） | 全文章一覧＋ランク付き検索。物語はディレクトリ表示 |
| `/p/:passageId` | **ReadingRoute**（改） | 単発記事を URL で開く |
| `/s/:storyId` | **StoryDirectoryRoute**（新） | 物語トップ：あらすじ・登場人物・章一覧 |
| `/s/:storyId/:chapterIndex` | **ReadingRoute**（改） | 物語の章（`passageId = ${storyId}:${chapterIndex}` を復元） |
| `/review`, `/wordbook` | 既存 | 変更なし |

旧 `/setup`・`/read` は廃止。互換のため `/setup`→`/`、`/read`→直近の読みかけ or `/library` へリダイレクトするフォールバックを1つ置く（任意・低コスト）。

### 3.2 生成後のナビゲーション

`HomeRoute`（旧 `SetupRoute` のロジックを移設）:
- 記事生成成功 → `navigate('/p/' + passageId)`
- 物語: 従来どおりプラン確認ゲート（`StoryPlanReview`）を経て、章生成成功 → `navigate('/s/' + storyId + '/0')`

`generationController` は生成した `passageId` を呼び出し側へ返せるようにする（現状 `outcome` に含める）。含まれていなければセッションから取得する。

### 3.3 URL 対応リーダー（データフロー）

```
/p/:id もしくは /s/:sid/:ci
   → ReadingRoute が params から passageId を決定
   → session.passage.passageId と異なれば openPassage(passageId) を実行
        openPassage: passages.get → tokenizer.index → session.startPassage
                     → progress.get で保存位置へ seek → 音声を player へ委譲/unavailable
   → ReadingScreen は従来どおり session.passage を描画（ほぼ無改造）
```

## 4. コンポーネント / モジュール

### 4.1 新規：`openPassage` コントローラ
- 位置: `src/state/controllers/sessionBootstrap.ts` に追加（既存 `restoreReadingSession` の兄弟）。
- 責務: `passageId` を受け取り、`PassageRecord` をロード→ `tokenizer.index` → `session.startPassage` → `progress.get(userId, passageId)` があればその `sentenceIndex` へ復元。音声は既存の復元経路（`player` の `unavailable` マーク or TTS 委譲）に合わせる。
- 依存: `PassageRepository`, `ProgressRepository`, `SessionStore`（既存 `RestoreDeps` を拡張）。
- 戻り値: `IndexedPassage | null`（未存在時 null → 画面は「見つかりません」）。
- 使い方: 引数は `(deps, userId, passageId)`。内部を読まずとも「IDから読書セッションを開く」と分かる。

### 4.2 新規：`PassageRepository.all(userId)`
- 位置: `src/types/ports.ts`（IF）＋ `src/infra/persistence/passageRepository.ts`（Dexie 実装）。
- 責務: 学習者の全 `PassageRecord` を返す（`createdAt` 降順）。検索・ライブラリの入力。
- テスト: 既存 `repositories.test.ts` に1ケース追加。

### 4.3 新規：`passageSearch` ドメイン純関数
- 位置: `src/domain/library/passageSearch.ts`（`dashboardProjector` / `sessionPlanner` と同じドメイン層）。
- 入力: `PassageRecord[]` とクエリ文字列。出力: スコア降順の結果（記事＝個別、物語＝ディレクトリに集約）。
- スコアリング: タイトル一致（最重み）＞ intent ラベル／CEFR・級レベル一致 ＞ 本文トークン・`translationJa` 一致（最軽）。空クエリは `createdAt` 降順（＝recency）。
- 物語集約: 同一 `storyRef.storyId` の章を1エントリに畳み込み、章のどれかがヒットすれば物語がヒット。集約結果は `StoryRepository` からタイトル・章数を補う。
- テスト: ランク順、タイトル優先、日本語訳ヒット、空クエリ=recency、物語集約 の各ケース。

### 4.4 新規画面（プレゼンテーショナル）
- `src/ui/home/HomeScreen.tsx`: 生成フォーム（`SetupScreen` を内包 or 移設）＋サマリ・ストリップ（`DashboardSnapshot` から連続日数・本日の復習・読みかけ・最近の記事）。習熟度内訳・週間チャートは既存 `DashboardScreen` の該当セクションを再利用。
- `src/ui/library/LibraryScreen.tsx`: 検索ボックス＋結果リスト（記事行＝ `/p/:id`、物語行＝ `/s/:sid`）。空クエリ=recency、0件=ホームへ誘導する空状態。
- `src/ui/story/StoryDirectoryScreen.tsx`: あらすじ・登場人物カード・章一覧（生成済み=リンク、未生成=プランから表示＋生成導線）。`StoryRepository.get` ＋ `PassageRepository.byStory` を利用。

### 4.5 ルートコンテナ（`src/ui/app/routes.tsx`）
- `HomeRoute`（旧 `SetupRoute` の生成ロジック＋ `DashboardRoute` のサマリ読み込みを統合）。
- `LibraryRoute`（`all()` を `useLiveQuery`、`passageSearch` を適用、ローカル state のクエリ）。
- `StoryDirectoryRoute`（`useParams` の `storyId`）。
- `ReadingRoute`（`useParams` から `passageId` を決定し `openPassage` を effect で実行）。

### 4.6 ナビ（`src/ui/shared/TopNav.tsx`）
- `DESTINATIONS` を `ホーム(/) / 文章(/library) / 復習(/review) / 単語帳(/wordbook)` に更新。`end` は `/` のみ。

## 5. エラーハンドリング

- **未存在の `:passageId`**（削除済み・不正ID・未生成章）: クラッシュせず「文章が見つかりません」表示＋「文章一覧へ」リンク。`openPassage` は `null` を返し、`ReadingRoute` が not-found 分岐。
- **物語トップの未存在 `storyId`**: 同様に not-found ＋ライブラリへ。
- **検索0件**: 空状態（「該当する文章がありません」＋ホームで生成する導線）。
- **音声**: 既存の劣化方針（`player` を `unavailable`）を踏襲。URL 直開き時に TTS 未合成でも本文は読める。

## 6. テスト戦略

- **純関数**: `passageSearch` を単体テスト（5ケース、上記 4.3）。
- **リポジトリ**: `PassageRepository.all()` の1ケース。
- **コントローラ**: `openPassage`（復元位置・未存在=null）。
- **ルーティング/画面**: 既存 `router.test.tsx` / `routes.test.tsx` / `storyRoute.test.tsx` / `ReadingScreen.test.tsx` を新URLへ更新。`/p/:id` ディープリンク、`/s/:sid` ディレクトリ、生成後のリダイレクト先を検証。
- **回帰**: 復習・単語帳・生成パイプライン・プラン確認ゲートは挙動不変であることを確認。
- 環境: Node ≥20（nvm v22.23.1）で `npm test`。Playwright はサンドボックス制約のため対象外。

## 7. 移行・ロールアウト

- 既存データ（`passages` / `stories` / `progress`）はスキーマ変更なしでそのまま利用（`all()` は既存インデックスのみ）。DB マイグレーション不要。
- `passageId` フォーマットは不変のため、既存記事・章はそのまま URL 化できる。
- 大きめの表面積のため、ルーティング → `openPassage` → ライブラリ/検索 → ホーム統合 → 物語ディレクトリ の順に段階実装する（詳細は実装計画で分割）。

## 8. 未決事項

- 現状なし（ブレインストーミングで IA・検索対象・物語ディレクトリ方針を確定済み）。
