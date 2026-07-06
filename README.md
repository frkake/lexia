# 英単語学習サイト

## 概要

英単語を学習するのに有用な以下のことを活用して学習
- コロケーション
- イディオム
- フレーズ
- 用例
- 音声
- イラスト
- コノテーション（肯定的・否定的・硬い・カジュアルなどの響き）
- メタファー（抽象的な意味を支える比喩）
- 語源（接頭辞・語根・接尾辞）
- 意味のネットワーク（類義語・反義語・上位語・下位語・関連語）
- レジスター（フォーマル・日常・学術・ビジネス・スラングなどの使用域）
- 類義語のニュアンスの違い
- 文法パターン（後ろに続く形や構文）
- 語のファミリー（派生語・品詞変化）
- 頻度・重要度
- 誤用しやすい点

このサイトでは、未学習・あるいは習熟度の低い英単語を組み合わせて、読みやすい文章を作成し、その文章をもとに、英単語を学習する。
一つの文章で英単語を縛らず、習熟度に応じて再登場させることで、英単語を定着させる。

単語を単独の日本語訳として覚えるのではなく、実際に使われる文脈、周辺語彙、感情的な響き、語源的なつながり、比喩的な広がりをあわせて学ぶ。
これにより、意味を推測する力、類義語を使い分ける力、自然な文章の中で単語を運用する力を身につける。

## セットアップ

### 前提条件

| ツール | バージョン | インストール |
|--------|-----------|-------------|
| Node.js | v20 以上（推奨 v24） | https://nodejs.org/ または `nvm install 24` |
| pnpm | v9 以上（推奨 v10） | `corepack enable && corepack prepare pnpm@latest --activate` |

> **Corepack を使う場合**: Node.js 16.13+ に同梱の Corepack で pnpm を有効化できます。  
> もしくは `npm install -g pnpm` でグローバルインストールしてください。

### 手順

```bash
# 1. リポジトリをクローン
git clone <repository-url>
cd lexia

# 2. 依存パッケージのインストール
pnpm install

# 3. 環境変数の設定
cp .env.example .env
# .env を編集し、LLM プロバイダの API キーを設定する:
#   - OpenAI を使う場合: OPENAI_API_KEY を設定
#   - Claude を使う場合: LLM_PROVIDER=claude に変更し ANTHROPIC_API_KEY を設定

# 4. 開発サーバの起動
pnpm dev
```

`pnpm dev` が成功すると、以下にアクセスできます:
- アプリ: http://localhost:5173/
- ビジュアルギャラリー: http://localhost:5173/gallery.html

### 動作確認

開発サーバ起動後、別ターミナルで LLM 接続を確認:

```bash
curl -X POST http://localhost:5173/api/passages:generate \
  -H 'content-type: application/json' \
  -d '{"level":"B1","themes":["会議"],"newWordRatio":0.3,"length":"short","targetWords":[]}'
```

正常にレスポンスが返れば LLM 連携が動作しています。

## 開発・テスト

```bash
pnpm dev              # Vite 開発サーバ（実アプリ /, ビジュアルギャラリー /gallery.html）
pnpm build            # tsc --noEmit + vite build
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint
```

## 生成API（バックエンドプロキシ）

文章生成・単語データは、LLM を保持する薄いサーバプロキシ経由で取得する（クレデンシャルはクライアントに出さない）。
プロキシは Vite プラグイン（`server/`）として実装され、`pnpm dev` / `pnpm preview` が `/api/*` を提供する。

- プロバイダは `.env` の `LLM_PROVIDER` で選択（`openai`（既定）/ `claude`）。`.env.example` を `.env` にコピーして API キーを設定する。
  - OpenAI: `OPENAI_API_KEY`（任意で `OPENAI_MODEL`、既定 `gpt-4o`）
  - Anthropic: `ANTHROPIC_API_KEY`（任意で `ANTHROPIC_MODEL`、既定 `claude-opus-4-8`）
- 生成APIが未設定・到達不可・エラーのときは**モックにフォールバックせずエラーを返す**。
  クライアントは「生成サービスに接続できませんでした」等のエラーを表示する。
- 動作確認（`pnpm dev` 起動後、別ターミナルで最小リクエストを送る）:

```bash
curl -X POST http://localhost:5173/api/passages:generate \
  -H 'content-type: application/json' \
  -d '{"level":"B1","themes":["会議"],"newWordRatio":0.3,"length":"short","targetWords":[]}'
```

## 音声API（TTS）

読解画面の音声は `/api/tts:*` 経由で合成する。Azure Speech を優先し、未設定時は Amazon Polly を互換フォールバックとして使える。
リスニング用シーンでは、文ごとに話者・アクセントを分けて合成し、返却された speech marks をトークン単位のハイライトに変換する。

- 音声一覧: `GET /api/tts:voices`
- 文章音声: `POST /api/tts:synthesize`（`text`, `voiceId`, 任意の `segments`）
- 単語音声: `GET /api/tts/word?wordId=deal&voiceId=azure-us-jenny`
- Azure Speech: `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`
- Amazon Polly: `AWS_REGION`（任意で `POLLY_ENGINE`）

### ユニット / 統合テスト（Vitest）

```bash
pnpm test             # 全ユニット + 統合テスト（fake-indexeddb 使用、ブラウザ不要）
pnpm coverage
```

ドメイン・永続化・状態・UI 各層のユニットに加え、`src/state/controllers/` にフロー結線
（生成パイプライン / 読解再認 / 復習サイクル / 再訪復元）と統合テスト・性能テストを置く。

### E2E・ビジュアル回帰（Playwright）

`/api/*`（生成・単語データ・TTS）はモックし、実アプリを 2 プロジェクトで検証する。

- `desktop-chromium`（PC フレーム）
- `mobile-webkit`（iPhone 414×842 / Safari エンジン）

```bash
pnpm exec playwright install chromium webkit   # 初回のみブラウザ取得
pnpm test:e2e                                   # E2E + ビジュアル回帰（e2e/）
pnpm test:e2e:update                            # スクリーンショットのベースライン更新
```

- E2E（`e2e/flows|audio|mobile.spec.ts`）：Setup→生成→読解、単語詳細、文字サイズ、和訳切替、
  音声追従ハイライト（シーク・速度）、固定プレーヤー、ナビ越しの `<audio>` 存続。
- ビジュアル回帰（`e2e/visual.spec.ts`）：6 フレームを `gallery.html` の固定フィクスチャで描画して
  スナップショット比較し、状態別注釈・習熟度色・カテゴリチップを design.md「Design Tokens」と照合。
  ベースライン（`e2e/visual.spec.ts-snapshots/`）はフォント描画依存のため生成環境に紐づく。


