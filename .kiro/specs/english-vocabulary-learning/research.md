# Research & Design Decisions — english-vocabulary-learning (Lexia)

---
**Purpose**: ディスカバリーで得た知見・技術調査・設計判断の根拠を記録し、`design.md` を裏付ける。
**Usage**: `design.md` には収まらない比較・トレードオフの詳細をここに残す。
---

## Summary
- **Feature**: `english-vocabulary-learning`（プロダクト名 "Lexia"）
- **Discovery Scope**: New Feature（グリーンフィールド）/ Complex Integration（LLM 生成・クラウド TTS・間隔反復の3つの外部依存を統合）
- **Key Findings**:
  - 同梱の `support.js` は `<x-dc>` デザインキャンバスを描画する **dc-runtime ビューア**であり、製品コードではない。`英単語学習サイト.dc.html` は静的なビジュアルモック。したがって本機能は**新規 SPA を一から構築**し、実装スタックは本設計で決定する。
  - 中核の不確実性は3点に集約される：(1) 4段階習熟度＋4ボタン評価＋区間表示を満たす**間隔反復アルゴリズム**、(2) iOS Safari でも語単位追従ハイライトを実現する**TTS タイミング方式**、(3) CEFR レベル制御と決定論的レンダリングを両立する **LLM 構造化生成の注釈モデル**。
  - 統合上の最重要シームは**トークン分割（tokenization）**である。生成・TTS マーク対応付け・読解中の再認ヒットテストの3者が同一のトークン定義を共有しなければ、ハイライト／注釈スパン／再認イベントが同時に破綻する。
- **言語**: `spec.json.language = "ja"` のため、`design.md`・`research.md` 等の成果物は日本語で記述する。
- **ステアリング**: `.kiro/steering/` は未作成。プロジェクト全体規約が無いため、本設計で原則（依存方向・型安全・境界）を明示し、将来のステアリング化に備える。

## Research Log

### Topic 1: 間隔反復アルゴリズムと習熟度状態モデル
- **Context**: Req 1（習熟度管理：未学習/学習中/定着/習熟の4段階）と Req 9（復習：もう一度/難しい/普通/簡単 の4評価、各ボタンに次回間隔を表示、定着までの残り回数の目安）を、ローカルファースト（サーバ ML 学習なし）で満たす必要がある。読解中の再登場も習熟度へ反映する（Req 1.3, 3.4）。
- **Sources Consulted**:
  - FSRS 公式（DSR モデル）: https://github.com/open-spaced-repetition/free-spaced-repetition-scheduler
  - FSRS-6 アルゴリズム / 既定重み: https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm
  - Anki マニュアル（FSRS 設定・既定保持率0.90）: https://docs.ankiweb.net/deck-options.html
  - SM-2 仕様: https://www.super-memory.com/english/ol/sm2.htm
  - Duolingo HLR（Settles & Meedan, ACL 2016）: https://research.duolingo.com/papers/settles.acl16.pdf
- **Findings**:
  - **FSRS-6 を採用**（学習不要の既定重み、完全クライアントサイド）。状態は Stability `S`（保持率が目標値へ落ちるまでの日数）と Difficulty `D`（1–10）の2変数のみを永続化し、Retrievability `R` は経過時間と `S` から都度計算する。
  - 4ボタンは FSRS グレード 1–4 に直対応。各ボタンの**表示間隔**は「そのボタンを押した場合の `S'`」から区間式 `I = (S/FACTOR)·(Rd^(-1/decay) − 1)`（Rd=0.90）で算出。
  - 4段階習熟度は `S`（しきい値 定着=7日、習熟=30日）と reps/lapses から**導出（projection）**する。独立スコアは持たない。
  - 「定着までの残り回数」は理想カデンスの Good を前進シミュレーションして `S` がしきい値を超えるまでの回数として算出。
  - **読解中の再認**は早期復習（review-in-advance）として同じ式で扱える。タップ＝lookup を Again(1)（lapse）、タップ無しの読了を**減衰 Good**（`S' = S + 0.5·(S_good − S)`）とし、受動的再認を能動的想起より弱く加点する。読解単独では段階昇格させない。
- **Implications**: スケジューラはフレームワーク非依存の純粋ドメインサービス `FsrsScheduler` とし、習熟度導出 `MasteryProjector` を分離。永続化は SM-2 的な ease/interval ではなく FSRS の `{stability, difficulty, dueAt, reps, lapses, learningStep}` を保存する（後述の矛盾解消を参照）。

### Topic 2: 音声朗読と語単位追従ハイライト
- **Context**: Req 7（全文朗読の再生/停止、追従ハイライト、速度変更、声切替、再生位置表示・シーク、単語カードの発音再生）。PC とモバイル（iOS Safari 含む）双方で動作必須（Req 12.3）。
- **Sources Consulted**:
  - MDN SpeechSynthesisUtterance boundary event: https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance/boundary_event
  - Web Speech の実装差異: https://codersblock.com/blog/javascript-text-to-speech-and-its-many-quirks/
  - Amazon Polly Speech Marks: https://docs.aws.amazon.com/polly/latest/dg/using-speechmarks.html ／ 出力形式: https://docs.aws.amazon.com/polly/latest/dg/output.html
  - Azure WordBoundary: https://learn.microsoft.com/en-us/javascript/api/microsoft-cognitiveservices-speech-sdk/speechsynthesiswordboundaryeventargs
  - MDN Autoplay（iOS ジェスチャ要件）: https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
  - Polly 料金: https://aws.amazon.com/polly/pricing/
- **Findings**:
  - **方式B（事前生成クラウド TTS＋保存タイミングマップ）を採用**。生成時に (passage, voice) 単位で音声と語単位マークを合成・保存。第一エンジンは **Amazon Polly Neural の word speech marks**（`{time, type:'word', start, end, value}`、start/end は入力テキスト中のオフセット）。代替は Azure WordBoundary。
  - ハイライトは `HTMLAudioElement.currentTime` に対する `requestAnimationFrame` ループ＋保存マップの二分探索で駆動する。Web Speech の `boundary` には依存しない。
  - **Web Speech（方式A）は不採用**：Safari は boundary が文単位でしか発火せず `charLength` も欠落、Android は boundary が発火しない、iOS は `speak()` がユーザージェスチャ必須、声/速度/品質が端末依存で非決定的。MDN も「Baseline ではない」と明記。
  - iOS の自動再生制約：`play()` はタップ等のジェスチャ内で同期的に呼ぶ必要がある。再生ボタン・単語カード発音ボタンはこれを自然に満たす。`<audio>` は単一要素を最初のジェスチャで「解錠」して再利用し、`.src` のみ差し替える。
  - 速度変更はタイミングマップの再スケール不要（マークはメディア時間秒、`currentTime` は `playbackRate` に依らずメディア時間で進む）。Safari は `preservesPitch`/`webkitPreservesPitch` を設定。
  - 声切替は (voice) ごとに音声＋マップが1組必要。提供する声は少数に絞り、初回要求時に遅延生成＋キャッシュ。
- **Implications**: TTS を `TtsSynthesisPort` シームとして抽象化。タイミングマップは Polly のバイトオフセットを**ビルド時にトークンへ解決**して `WordMark{tokenId, startMs, endMs}` で保存し、クライアントは再トークナイズしない。マークがトークンへ1対1解決することを公開前に検証する。

### Topic 3: LLM による CEFR レベル別生成と構造化注釈
- **Context**: Req 3（対象単語を織り込んだレベル/テーマ準拠の英文生成、複数文への配置、習熟度に応じた注釈漸減、メタ情報付与）、Req 4/6（状態別の注釈表示、番号付き「気づき」）、Req 5（文ごと和訳）。生成は本仕様が所有、単語データ（語彙属性・音声・イラスト）は隣接供給。
- **Sources Consulted**:
  - 構造化出力リファレンス（スキーマ制約）: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
  - モデル一覧（claude-opus-4-8 / claude-sonnet-4-6）: https://platform.claude.com/docs/en/about-claude/models/overview
  - プロンプトキャッシュ: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
  - Adaptive thinking / Effort: https://platform.claude.com/docs/en/build-with-claude/effort
  - Batches API: https://platform.claude.com/docs/en/build-with-claude/batch-processing
  - CEFR 語彙（English Vocabulary Profile / CEFR-J）: https://www.englishprofile.org/wordlists
- **Findings**:
  - 単一の `messages.create(..., output_config={format:{type:'json_schema', schema}})`（または `messages.parse()`）で生成。既定モデル `claude-opus-4-8`、`thinking:{type:'adaptive'}`、`output_config.effort:'high'`、ストリーミング有効。高ボリューム時のコスト選択肢は `claude-sonnet-4-6`。
  - **文字オフセットを使わず、文/トークンインデックス方式で注釈を表現**する。理由：Anthropic 構造化出力のスキーマサブセットは数値制約（`minimum/maximum/multipleOf`）と文字列長制約（`minLength/maxLength`）を**サポートせず**、`minItems` も 0/1 のみ。よってオフセットの範囲妥当性をスキーマで保証できない。トークンインデックスなら「インデックスが範囲内か」「表層形が対象語の活用形か」を**アプリ側で安価に検証**できる。
  - スキーマは `additionalProperties:false` を全オブジェクトに必須。`enum/const/anyOf/$ref` は利用可。`category` は enum（connotation/collocation/register/etymology/semantic_network/synonym_nuance/grammar_pattern/word_family/frequency/common_error）で**強制可能**。複雑度上限（任意 24・union 16・strict tool 20）に注意し、ほぼ required・浅い構造に保つ。
  - 構造化出力は**形は保証するが内容は保証しない**。`stop_reason` が `refusal`/`max_tokens` のとき出力がスキーマ違反になり得る。よって **生成→検証→修復ループ**と **CEFR 語彙プロファイル検査**が必須（任意の磨き込みではない）。
  - 注釈のハルシネーション対策：語彙属性は外部供給データとしてプロンプトに渡し、各「気づき」に `sourceAttribute` 参照を持たせる。供給属性に対応しない category/説明の cue は検証で棄却する。
  - フィールド出自の境界：LLM が**生成**するのは passage 本文・文分割・トークン化・文ごと和訳・スパン位置・cue の選択と説明・メタ。語彙属性/音声/イラスト/習熟度は**外部**（プロンプトへ注入 or UI で id 結合）。
- **Implications**: 生成は `PassageGenerationService`（オーケストレーション）が担い、ContentGateway 経由で Claude を呼び、検証・修復・CEFR ゲートを通してから永続化＋TTS 合成へ進む。クレデンシャル保護のため LLM 呼び出しは**薄いサーバ/エッジプロキシ**の背後に置く（フロントはローカルファーストを維持）。

### Topic 4: フロントエンド構成とローカルファースト永続化
- **Context**: 5+画面のレスポンシブ SPA、モバイル下部固定プレーヤー（Req 12）、習熟度/SRS/読書進捗/設定のセッション間永続化（Req 13）、学習者識別は隣接 Auth から取得（シーム化）、単語データ/生成は外部サービス。
- **Sources Consulted**:
  - Vite Releases: https://vite.dev/releases ／ React Versions: https://react.dev/versions
  - TanStack Query v5: https://tanstack.com/query/v5/docs/framework/react/installation
  - Zustand persist: https://zustand.docs.pmnd.rs/integrations/persisting-store-data
  - Dexie.js: https://dexie.org/
  - React Router: https://reactrouter.com/
  - CSS env() safe-area: https://developer.mozilla.org/en-US/docs/Web/CSS/env ／ edge-to-edge & dvh: https://developer.chrome.com/docs/css-ui/edge-to-edge
- **Findings**:
  - **React 19 + TypeScript + Vite** の単一レスポンシブ SPA、ルーティングは React Router（`createBrowserRouter`、SSR 無し）。状態は所有別に分割：外部非同期状態（生成・単語データ）は **TanStack Query v5**、学習ドメイン状態と UI/プレーヤー状態は **Zustand v5**、永続記録は **Dexie 4（IndexedDB）**。
  - `localStorage` は FOUC 回避のため theme/locale など**同期読みが要る極小設定のみ**。学習記録（習熟度/SRS/進捗）は構造的・成長・クエリ可能なので Dexie が必須（localStorage は同期・5MB・文字列のみで不適）。
  - 全学習データは隣接 AuthProvider が供給する `userId` で名前空間化（Dexie DB 名 `lexia_<userId>` or `userId` カラム）。サインイン前は `anonymous`、初回サインインで移行。
  - 端末紛失＝総損失を避けるため、**append-only な復習イベントログ**と **export/import + SyncAdapter シーム**を初日から用意（クラウド同期自体は範囲外でもシームは持つ）。音声/イラストの blob は IndexedDB に保存せず外部 URL を HTTP/Query キャッシュに任せる。
  - 固定下部プレーヤーは、ルートのアウトレット外の**常駐レイアウトシェル**に置いた**アンマウントされない単一 `<audio>`** で実装。`position:fixed; bottom:0; padding-bottom:env(safe-area-inset-bottom)`＋`100dvh`、本文側にプレーヤー高さ分の下パディング。`<meta viewport ... viewport-fit=cover>` 必須。
  - 依存方向（強制ルール）：types → persistence(Dexie repos) → domain services → state(stores + query hooks) → UI。ドメインは React/Dexie/network に依存しない。
- **Implications**: バージョンは現行最新を基準にしつつ、Vite は Rolldown 移行リスクを踏まえ 7.x をフォールバックとして許容。Auth/Content/TTS は注入シーム。詳細は `design.md` の Technology Stack / File Structure / Components 参照。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Layered + Ports/Adapters (Hexagonal) **（採用）** | types→persistence→domain→state→UI の一方向依存。Auth/Content/TTS/Sync を注入シーム化 | ドメイン（FSRS・トークナイザ・CEFR 検証）を React/Dempfen から隔離してテスト可能。隣接サービスを差し替え可能。境界が明確で並行実装に強い | 初期の層分けコストとボイラープレート | ステアリング不在のため依存方向を design.md で明文化し原則化 |
| Feature-sliced monolith（画面ごとにロジック同梱） | 画面単位でロジック/状態/UI を凝集 | 立ち上がりが速い | SRS/トークナイザ/生成検証が複数画面に分散し共有契約が崩れやすい。テスト困難 | 本機能はクロスカット契約が多く不適 |
| サーバ集中（重いバックエンド） | 学習状態もサーバ管理 | 端末紛失に強い、同期容易 | 認証/課金/同期が範囲外。ローカルファースト要件・隣接境界に反する | 生成と TTS のみ薄いプロキシに限定する |

## Design Decisions

### Decision: 間隔反復は FSRS-6（固定重み）を採用し、4段階習熟度はその射影とする
- **Context**: 4ボタン×区間表示、4段階習熟度、残り回数目安、読解中再認の取り込みを、サーバ学習なしで満たす。
- **Alternatives Considered**:
  1. SM-2/Anki classic — 単純だが確率的記憶量を持たず、段階境界と残り回数が恣意的。"ease hell"。FSRS 比 ~20–30% 多い復習。
  2. Leitner — 実装最簡だが滑らかな区間/段階信号を出せない。
  3. HLR（Duolingo） — 言語学習特化で高精度だが集約ログでの学習が必要（ローカルファースト違反）。
  4. FSRS ユーザ別重み最適化 — 精度上限は高いが学習ステップ要・効果は数百レビュー後。
- **Selected Approach**: FSRS-6 の既定重みをクライアントで使用。S/D を永続化、R は都度計算。4ボタン→グレード直対応、表示間隔は `S'` から算出。習熟度は `deriveMastery(S, reps, lapses)` で導出（定着=7日、習熟=30日）。
- **Rationale**: Stability が「保持率が閾値へ落ちるまでの日数」そのものなので、区間表示・段階しきい値・残り回数シミュレーションの共通基盤になる。早期復習を自然に扱えるため読解中再認に追加数式が不要。
- **Trade-offs**: 既定 S0（Good=2.31d, Easy=8.30d）はモック表示（4d/10d）と一致しないため、初回表示ラダーのみ定数で上書きし以降は式に従う（二経路を明記）。閾値は製品判断でテレメトリ前は推定値。
- **Follow-up**: 減衰係数 0.5・しきい値・日次クールダウンを設定定数化し、実データで検証。

### Decision: 注釈は「文/トークンインデックス方式」、文字オフセットは使わない
- **Context**: 読解 UI が決定論的にスパンを描画するには、生成出力とレンダラがトークン境界で一致する必要がある。Anthropic スキーマは範囲/長さ制約を強制できない。
- **Alternatives Considered**:
  1. 文字オフセット — 空白/句読点/マルチバイトでズレやすく、スキーマで範囲検証不能。
  2. **文/トークンインデックス（採用）** — `sentences[].tokens:string[]` ＋ `(sentenceIndex, tokenStart, tokenEnd)`。
  3. インラインマークアップ（`<span>`） — 構造化保証を失い、文ごと和訳・番号付き cue の付与が煩雑。
  4. 2コール（生成→注釈） — 整列は正確だが約2倍のレイテンシ/コスト。
- **Selected Approach**: 単一構造化出力でトークン配列＋トークン範囲スパンを生成し、`TokenizerJoinService` がトークン↔正規文字列↔オフセットの単一の真実源となる。`stop_reason` 確認・スパン範囲/表層検証・`sourceAttribute` 検証・CEFR プロファイルゲートを通す生成→検証→修復ループを必須化。
- **Rationale**: 強制不能なスキーマ制約を、安価で網羅的な生成後アサーション＋修復に変換できる。TTS マーク対応付けと再認ヒットテストも同じトークン定義を共有でき、ハイライト/注釈/再認の整合が一点に集約される。
- **Trade-offs**: 出力がやや大きい。トークン結合規則（句読点前後の空白等）を生成側とレンダラで固定・単体テストする必要がある。
- **Follow-up**: 結合関数を1つに固定しユニットテスト。Polly のバイト/UTF-16 差異を吸収する両基底オフセット算出を実装。

### Decision: 追従ハイライトは事前生成 TTS＋保存タイミングマップ、Web Speech は不採用
- **Context**: iOS Safari で語単位ハイライトが必須。Web Speech の boundary は語単位で信頼できない。
- **Selected Approach**: 生成時に Polly Neural で音声＋word marks を合成・保存し、マークをビルド時にトークンへ解決。クライアントは `currentTime` の rAF＋二分探索で描画。`<audio>` 単一要素をジェスチャ解錠して再利用。
- **Rationale**: 決定論的・端末非依存・オフライン可（キャッシュ後）。語境界精度の難所をサーバ側に寄せられる。
- **Trade-offs**: (passage, voice) ごとに音声＋マップの生成/保存が必要（声は少数に制限・遅延生成）。生成時レイテンシが積み上がる。
- **Follow-up**: 公開前にマーク被覆＝トークン数を検証。`preservesPitch` を iOS 実機で確認。

### Decision: ローカルファースト永続化（Dexie/IndexedDB）＋ userId 名前空間＋エクスポート/同期シーム
- **Context**: Req 13 の永続化を、認証範囲外・多デバイス同期非要件（Req 12 はレスポンシブ）の制約下で満たす。
- **Selected Approach**: Dexie を system-of-record とし、習熟度/SRS/復習ログ/passage/タイミングマップ/進捗/設定を `userId` で名前空間化。append-only 復習ログと export/import + SyncAdapter を初日から用意。theme/locale のみ localStorage。
- **Rationale**: 学習記録はクエリ可能な成長データで IndexedDB が適切。端末紛失＝総損失を緩和するためログとバックアップ経路を確保。
- **Trade-offs**: 非同期ハイドレーション競合（初回描画は既定状態）に注意が必要。Dexie マイグレーションは不可逆で慎重さが要る。
- **Follow-up**: ハイドレーションフラグでゲート。`navigator.storage.persist()` で退避抑止。番号付きマイグレーションをフィクスチャでテスト。

### Decision: support.js は依存に含めずグリーンフィールド構築
- **Context**: `support.js` は dc-runtime のキャンバスビューア（React 利用）で、製品実行コードではない。
- **Selected Approach**: モックのビジュアル意図（配色・フォント・レイアウト・状態別注釈エンコード）を設計基準として採用しつつ、実装は新規 SPA として構築する。
- **Rationale**: モックは静的デザインドキュメントであり、ランタイム機能を提供しない。
- **Follow-up**: モック由来のデザイントークンを実装の単一ソースとして整理（design.md 参照）。

## Risks & Mitigations
- **トークン契約ドリフト（最重要）** — 生成レンダラ/Polly マーク対応/再認ヒットテストの3者が分割規則・tokenId 体系で食い違うとハイライト・注釈・再認が同時破綻。→ 共有・ユニットテスト済みの `TokenizerJoinService` を単一真実源にし、ビルド時に全マークが1トークンへ解決することをアサート。
- **文字エンコーディング不一致** — Polly は UTF-8 バイト、JS は UTF-16。曲線引用符・em ダッシュ・借用語のアクセント等でズレる。→ 文字集合の正規化、両基底でのオフセット算出、アセット単位の被覆検証。
- **生成→検証→修復の省略** — 構造化出力は形のみ保証。不正スパンが UI に届くと描画・ハイライト・再認が壊れる。→ `stop_reason` 確認＋範囲/表層/`sourceAttribute`/CEFR プロファイルの検証を必須化。
- **生成＋TTS のレイテンシ積み上げ** — Opus 呼び出し（＋修復）＋Polly 合成＋マーク取得が直列化。→ 段階的レディネス（本文先行・音声非同期）と Batches（50%割引）での事前生成。
- **FSRS と SM-2 のモデル不一致実装** — フロント調査の SM-2 的スキーマをそのまま実装すると残り回数/段階/区間が無意味化。→ 永続スキーマを FSRS に統一（本リサーチで解消済み）。
- **ローカルデータ損失** — IndexedDB 退避（特に iOS）や端末紛失で SRS/ログを喪失。→ append-only ログ＋export/import＋SyncAdapter＋`storage.persist()`。
- **非同期ハイドレーション競合** — Zustand persist/Dexie 読みは初回描画後に解決し、復習キューが空状態で計算され得る。→ ハイドレーションフラグでゲート、スケルトン表示。
- **CEFR レベルドリフト** — プロンプトアンカーだけでは帯域逸脱が起こる。→ 語彙プロファイルゲート＋再生成/降格。
- **未検証の製品定数** — 減衰0.5・閾値7/30・帯域許容は推定。→ 設定化し実データで検証。
- **オフライン×オンライン生成の緊張** — 生成・初回 TTS は本質的にオンライン。オフラインは生成済み・合成済み・キャッシュ済み passage に限る。→ 設計上の硬い境界として明記。
- **Vite 8(Rolldown) サプライチェーン** — プラグイン未対応の可能性。→ Vite 7.x をフォールバックに固定可能とする。

## References
- [FSRS（DSR モデル, 公式）](https://github.com/open-spaced-repetition/free-spaced-repetition-scheduler) — Stability/Difficulty/Retrievability と4評価、早期復習の根拠。
- [FSRS-6 The Algorithm（awesome-fsrs）](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm) — 既定重み・べき乗忘却曲線・区間式・難易度平均回帰。
- [Anki Manual — Deck Options](https://docs.ankiweb.net/deck-options.html) — 既定保持率0.90、学習ステップ指針。
- [SuperMemo 2（SM-2）](https://www.super-memory.com/english/ol/sm2.htm) — 比較対象の正準仕様。
- [Settles & Meedan, HLR（ACL 2016）](https://research.duolingo.com/papers/settles.acl16.pdf) — 言語学習向け半減期回帰、Leitner 比の精度。
- [Amazon Polly Speech Marks](https://docs.aws.amazon.com/polly/latest/dg/using-speechmarks.html) / [出力形式](https://docs.aws.amazon.com/polly/latest/dg/output.html) — 語マークの start/end オフセット契約。
- [Azure WordBoundary](https://learn.microsoft.com/en-us/javascript/api/microsoft-cognitiveservices-speech-sdk/speechsynthesiswordboundaryeventargs) — 代替エンジンの語境界。
- [MDN boundary event](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance/boundary_event) / [TTS quirks](https://codersblock.com/blog/javascript-text-to-speech-and-its-many-quirks/) — Web Speech 不採用の根拠。
- [MDN Autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay) — iOS ジェスチャ要件。
- [Anthropic 構造化出力](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) — スキーマサブセット制約・refusal/max_tokens 注意。
- [Claude モデル一覧](https://platform.claude.com/docs/en/about-claude/models/overview) — claude-opus-4-8 / claude-sonnet-4-6。
- [プロンプトキャッシュ](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) / [Effort](https://platform.claude.com/docs/en/build-with-claude/effort) / [Batches](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
- [English Vocabulary Profile / CEFR-J](https://www.englishprofile.org/wordlists) — レベル検証用語彙帯。
- [Vite Releases](https://vite.dev/releases) / [React Versions](https://react.dev/versions) / [TanStack Query v5](https://tanstack.com/query/v5/docs/framework/react/installation) / [Zustand persist](https://zustand.docs.pmnd.rs/integrations/persisting-store-data) / [Dexie.js](https://dexie.org/) / [React Router](https://reactrouter.com/)
- [MDN env()](https://developer.mozilla.org/en-US/docs/Web/CSS/env) / [Chrome edge-to-edge & dvh](https://developer.chrome.com/docs/css-ui/edge-to-edge) — 固定プレーヤー/セーフエリア。
