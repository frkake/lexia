# 実装計画 — english-vocabulary-learning (Lexia)

> 要件 ID は requirements.md の数値 ID を用いる。タスクの順序は依存関係を含意する（タスク N はそれ以前の全タスクに暗黙依存）。`(P)` は直前の同階層タスクと並行実行可能であることを示す。レイヤー依存方向は `types → domain → infra → state → ui`（design.md「Architecture」準拠）。UI タスクの「視覚的一致」条件と 11.4 は、`英単語学習サイト.dc.html` の対応フレームを視覚基準とし、具体値は design.md「Data Models → Design Tokens」を単一情報源とする。

- [x] 1. 基盤：プロジェクト構成・ドメイン型・学習パラメータ定数
- [x] 1.1 プロジェクト scaffold とレイヤー依存方向の強制
  - Vite + React 19 + TypeScript の SPA プロジェクトを初期化し、React Router v7・TanStack Query v5・Zustand v5・Dexie 4 を依存に追加する
  - `types → domain → infra → state → ui` の一方向依存を Lint ルール（import boundaries）で強制し、ドメイン層からの React / Dexie / network の import を禁止する
  - 観測可能な完了条件：ビルドと Lint がパスし、ドメイン層ディレクトリから Dexie を import するコードが Lint エラーで拒否される
  - _Requirements: 12.1_

- [x] 1.2 L0 ドメイン型・ポート interface・Result 型の定義
  - 学習ドメイン型（`WordSchedulingState`・`MasteryStage`(4段階)・`ReviewLogEntry`・`PassageOutput`・`Sentence`・`SpanRef`/`TargetSpan`/`CollocationSpan`・`NoticeCue`/`NoticeCategory`・`AudioAsset`/`WordMark`/`TimingMap`・`WordData`(MORE は optional)・`ReadingProgress`・`Settings`・`SetupConfig`）を定義する
  - ポート interface（`AuthProvider`・`ContentGateway`・`TtsSynthesisPort`・`SyncAdapter`・各 `*Repository`）と `Result<T,E>` 判別共用体を定義する
  - 観測可能な完了条件：全ポート・全ドメイン型が型コンパイルを通過し、`WordData.more` 欠落を許容する型構造になっている
  - _Requirements: 1.1, 1.2, 3.6, 8.1, 8.3, 8.5, 13.1_

- [x] 1.3 学習パラメータ定数モジュール
  - FSRS-6 既定重み `w[0..20]`・`Rd=0.90`・`S_CONSOLIDATE=7`・`S_MASTER=30`・初回表示ラダー（Again 10分 / Hard 1日 / Good 4日 / Easy 10日）を単一モジュールに集約する
  - 受動再認の減衰係数（0.5）・日次クールダウン窓・CEFR 帯域外許容比率を「未検証定数」としてコメント付きで定義する
  - 観測可能な完了条件：各定数が単一モジュールから export され、スケジューリング／検証ロジックが他に重複定義を持たない
  - _Requirements: 1.4, 9.4_

- [x] 2. 永続化基盤（LexiaDB とリポジトリ）
- [x] 2.1 Dexie スキーマと番号付きマイグレーション基盤
  - `lexia_<userId>` DB に scheduling / reviewLog / passages / timingMaps / progress / settings / wordCache の各ストアと複合主キー・インデックス（`dueAt`・`stability`・`mastery`・`status` 等）を定義する
  - `version(n).stores().upgrade()` による番号付きマイグレーションと、`APP_SCHEMA_VERSION` の settings 保持・Dexie version 同期、`navigator.storage.persist()` 要求を実装する
  - 観測可能な完了条件：フィクスチャを seed して version を上げるユニットテストが不変条件を保ったまま通過する
  - _Requirements: 13.1, 13.2, 13.3_

- [x] 2.2 各ドメインリポジトリの実装
  - `SchedulingRepository`（`get`/`upsert`/`dueBefore`/`lowStability`）・append-only `ReviewLogRepository`（`append`/`since`/`lastPassageUpdate`）・`PassageRepository`・`TimingMapRepository`・`ProgressRepository`・`SettingsRepository`・`WordCacheRepository` を 1.2 のポート interface に従い Dexie 実装する
  - 音声 blob・イラストは保存せず外部 URL 参照に限定する
  - 観測可能な完了条件：`dueBefore`/`lowStability` がインデックス経由で期日順・低安定度順の `WordSchedulingState` を返し、`ReviewLog` が追記のみで更新されることをテストで確認できる
  - _Requirements: 1.1, 1.2, 9.1, 11.1, 13.1, 13.2_

- [x] 3. ドメイン層：トークナイザと FSRS スケジューリング
- [x] 3.1 (P) TokenizerJoinService（トークン定義の単一真実源）
  - トークン配列→正規表示文字列の決定論的結合規則（句読点・短縮形・ハイフン間隔）を実装し、`tokenId = passageId:sentenceIndex:tokenIndex` と UTF-16 / UTF-8 両基底の `charStart/charEnd` を付与する
  - Polly のバイト範囲を一意 tokenId へ解決する `resolveMark`（解決不能は error）と `hitTest`（tokenId→TargetSpan）を実装する
  - 観測可能な完了条件：句読点／特殊文字を含む文で被覆＝トークン数となり、同一入力で `index`/`renderText` が決定論的であることをユニットテストで確認できる
  - _Requirements: 3.1, 4.2, 4.3, 7.2_
  - _Boundary: TokenizerJoinService_

- [x] 3.2 (P) FsrsScheduler（FSRS-6 スケジューリング）
  - 4評価（Again/Hard/Good/Easy=1..4）に対する `initial`/`review`/`simulate`(非破壊)/`retrievability`/`nextIntervalMs`/`repsToConsolidate` を純粋関数で実装し、状態は Stability・Difficulty のみ永続化する
  - 期限は絶対経過 ms（連続 R(t,S)）で判定し、学習ステップ中は初回表示ラダーで短間隔を上書きする
  - 観測可能な完了条件：既知入力→既知出力（区間・残り回数）のユニットテストが通過し、`review()` が `dueAt = now + nextIntervalMs(result)` を満たす
  - _Requirements: 1.3, 1.4, 9.4, 9.5, 9.6_
  - _Boundary: FsrsScheduler_

- [x] 3.3 (P) MasteryProjector（4段階習熟度の導出）
  - `deriveMastery` で FSRS 状態から New / Learning / Consolidating / Mastered を導出し、生成注釈密度用の 4→3 ダウンキャスト（`MasteryDensity`）を提供する
  - 段階昇格は明示的復習成功（grade>=3）かつ Stability がしきい値超過時のみ発火、lapse による降格判定を実装する
  - 観測可能な完了条件：境界 S=7/30 と lapse 回数に対する段階遷移がユニットテストで期待通りに導出される
  - _Requirements: 1.1, 1.4, 1.5, 3.5, 6.3_
  - _Depends: 3.2_
  - _Boundary: MasteryProjector_

- [x] 3.4 (P) RecallEventService（読解再認→FSRS グレード）
  - タップ（lookup）= Again lapse、タップ無し読了 = 減衰 Good（`S' = S + 0.5·(S_good − S)`）へ写像し、同一語の passage 由来更新に日次クールダウンを課す
  - passage 由来イベントは段階昇格を発火させず、全再認を `source='passage'` で append-only `ReviewLog` に記録する
  - 観測可能な完了条件：同日2回目の再認が `logEntry=null`（二重計上抑止）となり、減衰更新と非昇格がユニットテストで確認できる
  - _Requirements: 1.3, 3.4, 9.5_
  - _Depends: 3.2_
  - _Boundary: RecallEventService_

- [x] 4. ドメイン層：セッション計画・生成検証・オーケストレーション・ダッシュボード射影
- [x] 4.1 (P) SessionPlanner（候補語選定と生成リクエスト組立）
  - `SchedulingRepository` の due / 低安定度クエリから今回織り込む候補単語を自動選定し、Setup 条件（レベル・テーマ・新出比率・長さ・除外/追加）を `GenerationRequest` へ組み立てる
  - 復習セッション用に対象語の順序付きキューを生成する
  - 観測可能な完了条件：苦手語が優先選定された候補リストと、Setup 条件を反映した生成リクエストがモックリポジトリ上のテストで得られる
  - _Requirements: 2.4, 9.1_
  - _Depends: 1.2_
  - _Boundary: SessionPlanner_

- [x] 4.2 (P) PassageValidator（生成結果の検証）
  - スパン範囲（`0<=tokenStart<tokenEnd<=len`）・TargetSpan 表層が対象語の活用形・NoticeCue の `sourceAttribute` が供給属性に存在し category と整合、を検証する
  - CEFR 語彙プロファイル（帯域外トークン比率・新出比率）を検査し `ValidationReport` を返す
  - 観測可能な完了条件：範囲外スパン／表層不一致／未接地 cue／帯域逸脱を含む候補に対し検証が違反を検出するユニットテストが通過する
  - _Requirements: 3.1, 3.2, 3.3, 3.5_
  - _Depends: 3.1_
  - _Boundary: PassageValidator_

- [x] 4.3 GenerationOrchestrator（生成→検証→修復ループ）
  - `ContentGateway.generatePassage` を呼んで `stop_reason` を確認（refusal/max_tokens は再生成）し、PassageValidator 検証逸脱時は修復プロンプトを上限回数まで再試行、超過で `validation_exhausted` を返す
  - 成功時は Tokenizer で索引付けした `IndexedPassage` を確定する
  - 観測可能な完了条件：検証失敗→修復→成功の経路と上限到達時のエラー返却が、モック ContentGateway 上のテストで再現できる
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - _Depends: 3.1, 4.2_
  - _Boundary: GenerationOrchestrator_

- [x] 4.4 (P) DashboardProjector（ダッシュボード指標の導出）
  - 習熟度内訳（4段階の語数・総語数）・本日復習必要数・ストリーク・週次学習量推移・期限リスト・最近読んだ文章の `DashboardSnapshot` を導出する
  - 観測可能な完了条件：スケジューリング状態・進捗・ログのフィクスチャから期待通りの `DashboardSnapshot` が得られるユニットテストが通過する
  - _Requirements: 10.1, 10.2, 10.4, 10.5, 10.6_
  - _Depends: 3.3_
  - _Boundary: DashboardProjector_

- [x] 5. 隣接アダプタ（Content / TTS / Auth / Sync）のポート実装
- [x] 5.1 (P) ContentGateway HTTP アダプタ（生成プロキシ・単語データ）
  - `POST /api/passages:generate`（`{ passage, stop_reason }`）と `GET /api/words/{wordId}`（`WordData`）を呼ぶアダプタを実装し、400/422/429/503 を `Result` へ正規化する
  - クレデンシャルはサーバ保持を前提とし、クライアントには露出しない
  - 観測可能な完了条件：生成成功・検証エラー(422)・レート超過(429)の各レスポンスがポート契約どおりの `Result` に正規化される
  - _Requirements: 3.1, 8.1, 8.2, 8.3_
  - _Depends: 1.2_
  - _Boundary: ContentGateway_

- [x] 5.2 (P) TtsSynthesis アダプタ（音声合成・語マーク→TimingMap）
  - passage×voice の音声合成と語マーク取得を行い、Tokenizer の `resolveMark` で token 解決済み `TimingMap` を構築、単語発音クリップ URL を取得する
  - 公開前に「マーク被覆＝トークン数」を検証し、`(passageId, voiceId)` キーで冪等に上書きする
  - 観測可能な完了条件：被覆検証に失敗するマーク集合を拒否し、成功時に tokenId で二分探索可能な `TimingMap` を返す
  - _Requirements: 7.1, 7.2, 7.4, 7.6_
  - _Depends: 3.1_
  - _Boundary: TtsSynthesisPort_

- [x] 5.3 (P) Auth アダプタと anonymous→userId 移行
  - 隣接 Auth をラップして `userId` を供給し、サインイン時に `anonymous` 名前空間 DB から `lexia_<userId>` へ学習データを移行する
  - 観測可能な完了条件：匿名状態で蓄積したスケジューリング／ログが初回サインイン後の userId 名前空間で復元されることをテストで確認できる
  - _Requirements: 13.1, 13.4_
  - _Depends: 2.1_
  - _Boundary: AuthProvider_

- [x] 5.4 (P) Sync export/import アダプタ
  - scheduling + reviewLog + progress + settings を JSON で `export(userId): Blob` / `import(userId, Blob)` する `SyncAdapter` を実装する
  - 観測可能な完了条件：export→import ラウンドトリップで SRS 状態とレビューログが完全一致する
  - _Requirements: 13.1, 13.4_
  - _Depends: 2.2_
  - _Boundary: SyncAdapter_

- [x] 6. 状態層（stores・queries・hooks）
- [x] 6.1 (P) PlayerStore と HighlightController
  - AppShell 常駐の単一 `<audio>` を `.src` 差し替えのみで制御（play/toggle/seek/rate/voice/playWord）し、iOS 解錠後に要素を作り直さない
  - rAF で `currentTime` を読み、アクティブ `TimingMap` を tokenId で二分探索して追従ハイライトをトグル、シーク／声切替で再計算する
  - 観測可能な完了条件：再生位置・全体長・進捗が更新され、再生中に正しいトークンがハイライトされることを確認できる
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 12.3_
  - _Depends: 3.1, 5.2_
  - _Boundary: PlayerStore_

- [x] 6.2 (P) contentQueries（生成・単語データの Query フック）
  - `useGeneratePassage` / `useWordData` を TanStack Query で実装し、キャッシュ・再試行・重複排除・SWR を構成、GenerationOrchestrator と ContentGateway を配線する
  - 観測可能な完了条件：同一リクエストの重複呼び出しが排除され、生成失敗時に再試行されることを確認できる
  - _Requirements: 3.1, 8.1_
  - _Depends: 4.3, 5.1_
  - _Boundary: QueryHooks_

- [x] 6.3 (P) useScheduling 反応的読取と sessionStore
  - `useLiveQuery` 経由で due / mastery / 進捗を反応的に読み取る `useScheduling` と、進行中 passage・読解 UI 状態・読書進捗を保持する `sessionStore` を実装する
  - 観測可能な完了条件：習熟度・進捗の更新が画面再描画に即時反映され、読書中断時に進捗が保持される
  - _Requirements: 1.5, 10.3, 11.1, 13.2, 13.4_
  - _Depends: 2.2, 3.3_
  - _Boundary: QueryHooks, DomainStores_

- [x] 6.4 (P) settingsStore（表示設定の永続化）
  - 和訳モード・文字サイズ・音声(声/速度)・theme/locale・`lastSetup` を保持し、theme/locale は localStorage 同期読取（FOUC 回避）、その他は SettingsRepository へ永続化する
  - 観測可能な完了条件：設定変更が永続化され、再訪時に復元されることを確認できる
  - _Requirements: 5.1, 13.3, 13.4_
  - _Depends: 2.2_
  - _Boundary: settingsStore_

- [x] 7. UI 基盤：AppShell・ルーティング・共有部品
- [x] 7.1 AppShell・ルーター・常駐 BottomPlayer
  - ヘッダ＋`<Outlet/>`＋常駐 `BottomPlayer` を構成し、`createBrowserRouter` で 5 ルートを配線、`100dvh`＋`env(safe-area-inset-bottom)`＋`viewport-fit=cover` でモバイル下部固定プレーヤーを実現する
  - 画面幅に応じて PC / モバイルレイアウトをコンテナクエリ／ブレークポイントで切替（ルートは切替えない）
  - 観測可能な完了条件：画面遷移をまたいで `<audio>` がアンマウントされず、モバイル幅でプレーヤーが下部固定・safe-area 内に表示される
  - 視覚的一致：iPhone Reading フレームに対応し、モバイルのステータスバー／戻る／和訳トグル／角丸ドックプレーヤー（22px 上端・`--shadow-dock`）／ホームインジケータが design.md「Design Tokens」に一致する
  - _Requirements: 12.1, 12.2_
  - _Depends: 6.1_

- [x] 7.2 (P) 共有プレゼン部品（AnnotatedSpan・MasteryDot・Legend・TopNav）
  - デザイントークン（配色・状態別注釈エンコード）に従い、習熟度状態別注釈・コロケーション強調・凡例・習熟度ドット・ナビを実装する
  - 観測可能な完了条件：新出 / 学習中 / 定着・再登場 / コロケーション / 気づき番号が視覚的に区別され、凡例がその意味を表示する
  - 視覚的一致：状態別注釈の色・装飾が design.md「Design Tokens → 状態別注釈エンコード」のトークン値（下線 solid `#4C7BC0`／`#8FB0DA`、dotted `#C4CCD6`、コロケーション bg `#E4EDF8`、気づき番号 `#4C9A86`／`#3D6CB0`／`#6B7686`）に一致する
  - _Requirements: 4.2, 4.3, 4.4_
  - _Depends: 1.2_
  - _Boundary: shared UI_

- [x] 8. 読解体験 UI（読解・和訳・気づき・単語詳細）
- [x] 8.1 ReadingScreen と PassageRenderer
  - 本文・タイトル・場面イラスト・メタ情報を表示し、`AnnotatedSpan` で学習単語を習熟度状態別に、コロケーションを区別して描画、文字サイズ変更手段と単語選択→詳細参照を提供する
  - モバイルレイアウトで戻る手段と現在文章のタイトル・レベル・新出/復習語数を表示する
  - 観測可能な完了条件：単語タップで WordDetailCard が開き、文字サイズ変更が本文へ反映され、モバイルで戻る／メタ表示が機能する
  - 視覚的一致：Reading フレーム（PC）に対応し、ヘッダ／本文カラム（max 600px）／場面イラストプレースホルダ／メタ表記／凡例のレイアウトと配色・タイポが design.md「Design Tokens」に一致する
  - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 12.4_
  - _Depends: 6.3, 7.2_

- [x] 8.2 (P) SentenceTranslation（和訳モード切替）
  - 和訳モード「オフ / 文ごと / 全文」を切替え、文ごとモードでは個別文の和訳表示／非表示をトグルする
  - 観測可能な完了条件：オフで既定非表示、文ごとで対象文のみ表示トグル、全文で全体和訳が表示される
  - 視覚的一致：和訳ブロックが Reading フレームの様式（左 2px `#CBD8E8`・`--font-body-jp` 14px・color `--faint-2`）に、「＋この文の和訳を表示」トグルがトークン（青ティント・`--radius-control`）に一致する
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - _Depends: 6.4, 8.1_
  - _Boundary: reading/SentenceTranslation_

- [x] 8.3 (P) NoticeRail と StudyWordsList（気づき・学習単語一覧）
  - 本文中の番号付き箇所に対応する気づき（対象表現＋分類）を一覧表示し、当該文章の学習単語一覧を習熟度状態とともに、再登場回数や定着補足を提示する
  - 観測可能な完了条件：番号付き気づきが本文位置と対応し、各学習語の習熟度状態と再登場回数が表示される
  - 視覚的一致：NoticeRail が Reading フレーム右レールに対応し、カテゴリチップ（コノテーション `#3E8C79`/`#E6F2EE`、コロケーション `#2D518C`/`#EAF0F8`、レジスター `#5A6675`/`#EDF1F6`）と番号丸の色が design.md「Design Tokens」に一致する
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - _Depends: 6.3, 8.1_
  - _Boundary: reading/NoticeRail_

- [x] 8.4 (P) WordDetailCard（多面的な単語詳細カード）
  - Header（見出し語/IPA/発音/品詞/レジスター/コノテーション/頻度/習熟度）＋常時表示 Core（意味/用例/コロケーション/ニュアンス/イラスト）＋折りたたみ MORE（語源/意味のネットワーク/語のファミリー/イディオム/文法/メタファー/誤用）を描画し、発音再生を提供する
  - 欠落属性は破綻なくスキップし、利用可能な項目のみ表示する
  - 観測可能な完了条件：MORE 各項目が展開／収納でき、`more` 欠落時もカードが破綻せず発音再生が機能する
  - 視覚的一致：WordCard フレームに対応し、見出し語（serif 42px）／IPA／品詞・レジスター・コノテーションのチップ／★頻度（`--primary` + 2px 字間）／習熟度バッジ／CORE・MORE 区切りが design.md「Design Tokens」に一致する
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 7.6_
  - _Depends: 6.1, 6.2_
  - _Boundary: wordcard/WordDetailCard_

- [x] 9. 学習導線 UI（セットアップ・復習・ダッシュボード・単語帳）
- [x] 9.1 (P) SetupScreen（学習条件設定）
  - レベル選択（A2〜C2 から1つ）・テーマ複数選択・新出比率/長さスライダ・対象語エディタ（自動選定候補の除外/追加）を提供し、生成実行で条件を引き渡す
  - 必須条件（レベル・対象語1語以上）未充足時は生成せず不足項目を通知する
  - 観測可能な完了条件：必須未充足で生成がブロックされ不足通知が出る／充足時に SessionPlanner 経由で生成リクエストが発火する
  - 視覚的一致：Setup フレームに対応し、レベルセグメント（選択時 `#3D6CB0`/`#EEF3FA`）／テーマピル（18px）／2スライダ／対象語チップ（除外は取り消し線）／生成ボタンが design.md「Design Tokens」に一致する
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 2.7_
  - _Depends: 4.1, 6.2_
  - _Boundary: setup/SetupScreen_

- [x] 9.2 (P) ReviewSession（間隔反復復習）
  - 復習対象語を順に提示し進捗（現在位置/総数）を表示、各語を新しい文脈例文で提示、解答表示で意味・主要コロケーション・関連情報を提示する
  - 4評価（もう一度/難しい/普通/簡単）に各 `FsrsScheduler.simulate` の次回区間を併記し、評価で再スケジュール＋習熟度進捗反映、残り回数目安を提示する
  - 観測可能な完了条件：評価選択で次回復習日が再計算され ReviewLog に追記、習熟度進捗と残り回数が更新表示される
  - 視覚的一致：Review フレームに対応し、進捗バー／文脈カード／正解ターゲット強調（bg `#DCE8F6`・下線 `--primary`）／習熟度ドット列／4評価ボタン（もう一度=テラコッタ・難しい=グレー・普通=青・簡単=緑）の配色が design.md「Design Tokens」に一致する
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_
  - _Depends: 3.2, 3.4, 4.1, 6.3_
  - _Boundary: review/ReviewSession_

- [x] 9.3 (P) DashboardScreen
  - `DashboardSnapshot` を描画：挨拶・本日復習必要数・習熟度内訳バー・読みかけ文章（進捗率＋続き開始）・週次推移・期限リスト（復習開始）・ストリーク・最近読んだ文章
  - 観測可能な完了条件：読みかけ文章から続きを再開でき、期限リストから復習を開始できる
  - 視覚的一致：Dashboard フレームに対応し、習熟度内訳バー（4色）／読みかけ CTA（左 7px `--primary`）／週次棒グラフ（`#DCE6F2`/`#A9C2E2`/`#3D6CB0`/`#EBEEF2`）／復習リスト／最近読んだ文章の2カラムレイアウトと配色が design.md「Design Tokens」に一致する
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_
  - _Depends: 4.4, 6.3_
  - _Boundary: dashboard/DashboardScreen_

- [x] 9.4 (P) WordbookScreen（単語帳）
  - 学習者の単語を習熟度状態併記で一覧し、習熟度フィルタと検索を提供、選択で WordDetailCard を表示する
  - 観測可能な完了条件：フィルタ／検索結果が反応的に更新され、単語選択で詳細カードが開く
  - 視覚的一致：単語帳はモック専用フレームを持たないため、ナビ（単語帳）と共有部品・design.md「Design Tokens」に準拠し、習熟度ドット／チップ／カードが他画面と一貫する
  - _Requirements: 11.1, 11.2, 11.3_
  - _Depends: 6.3, 8.4_
  - _Boundary: wordbook/WordbookScreen_

- [x] 10. 統合配線とフロー結線
- [x] 10.1 生成→検証→TTS→Reading-ready パイプライン結線（段階的レディネス）
  - Setup→SessionPlanner→GenerationOrchestrator→検証→PassageRepository 永続化で本文を即描画し、TtsSynthesis の音声到着まではプレーヤーを loading 表示にする（Flow 1）
  - 観測可能な完了条件：本文は検証直後に閲覧・lookup 可能となり、音声準備完了後にプレーヤーが操作可能になる
  - _Requirements: 3.1, 3.6, 7.1, 12.3_
  - _Depends: 4.3, 5.2, 8.1, 9.1_

- [x] 10.2 読解中の再認→FSRS 反映の結線
  - ReadingScreen のトークンイベント→RecallEventService→SchedulingRepository/ReviewLogRepository→MasteryProjector 再射影を結線する（Flow 3）
  - 観測可能な完了条件：読解中の lookup / 読了が当該語の Stability と習熟度表示へ反映され、日次クールダウンで二重計上されない
  - _Requirements: 1.3, 1.5, 3.4, 9.5_
  - _Depends: 3.3, 3.4, 8.1_

- [x] 10.3 復習評価→再スケジュール→ダッシュボード反映の結線
  - ReviewSession 評価→FsrsScheduler 再スケジュール→ReviewLog 追記→MasteryProjector 再射影→DashboardProjector 反映を結線する（Flow 2）
  - 観測可能な完了条件：復習評価後にダッシュボードの本日数・内訳・期限リストが更新される
  - _Requirements: 1.4, 9.5, 10.1, 10.2, 10.5_
  - _Depends: 9.2, 9.3_

- [x] 10.4 永続化ハイドレーション・再訪復元・エラー degrade の結線
  - ストア未ハイドレーション中はスケルトン表示でゲートし、再訪時に習熟度・進捗・設定を復元、生成/TTS/永続化エラー時の degrade（音声準備中・本文継続・export 促し）を結線する
  - 観測可能な完了条件：再訪で前回の続き（読みかけ・設定・習熟度）が復元され、TTS 失敗時も本文読解と再認が継続する
  - _Requirements: 13.1, 13.2, 13.3, 13.4_
  - _Depends: 5.3, 5.4, 6.3, 6.4_

- [x] 11. 検証（統合・E2E・性能）
- [x] 11.1 (P) 統合テスト：生成パイプライン・復習サイクル・マイグレーション
  - 生成→検証→修復→永続化→TTS→Reading-ready（段階的レディネス）、復習評価→再スケジュール→ログ→再射影→ダッシュボード、Dexie マイグレーションと anonymous→userId 移行を統合テストする
  - 観測可能な完了条件：3 パイプラインの統合テストが通過し、マイグレーション後も不変条件が保たれる
  - _Requirements: 3.1, 9.5, 13.4_
  - _Depends: 10.1, 10.3, 10.4_
  - _Boundary: integration tests_

- [x] 11.2 (P) E2E：読解・音声追従・主要導線（PC/モバイル）
  - 状態別注釈・凡例・単語選択→詳細・文字サイズ・和訳モード切替、再生/シーク/速度/声切替での追従ハイライト（iOS Safari 含む）、Setup→生成→読解→復習導線と固定プレーヤーを E2E 検証する
  - 観測可能な完了条件：PC/モバイル両レイアウトで主要導線が完走し、シーク/速度/声切替後もハイライトが正トークンに追従する
  - _Requirements: 4.1, 4.4, 4.5, 4.6, 5.1, 7.2, 7.3, 7.4, 7.5, 12.2, 12.3, 12.4_
  - _Depends: 10.1, 10.2_
  - _Boundary: e2e tests_

- [x] 11.3* (P) 性能・信頼性テスト
  - 生成＋TTS レイテンシ積み上げと段階的レディネスの体感、大量語彙での `dueBefore`/`lowStability` クエリと `useLiveQuery` 再描画コスト、export→import ラウンドトリップの SRS/ログ完全性を計測する
  - 観測可能な完了条件：受容可能な追従ハイライト遅延（rAF＋二分探索 O(log n)）と export/import 完全一致を計測結果で確認できる
  - _Requirements: 13.4_
  - _Depends: 11.1_
  - _Boundary: performance tests_

- [x] 11.4 (P) ビジュアル一致検証（モックフレーム対応）
  - 各画面（Dashboard / Reading / WordCard / Review / Setup と iPhone Reading のモバイル）を `英単語学習サイト.dc.html` の対応フレームに対しスクリーンショット／ビジュアル回帰で比較し、design.md「Design Tokens」の配色・タイポグラフィ・角丸・影・余白・状態別注釈エンコードとの差分を検証する
  - 基準ビューポート（PC フレーム幅・iPhone 414×842）でレンダリングしたスナップショットをベースライン化し差分を閾値内に収める。状態別注釈（新出／学習中／定着・再登場／コロケーション／気づき番号）と習熟度色・カテゴリチップがトークン値と一致することをアサートする
  - 観測可能な完了条件：6 フレームに対応する各画面のビジュアル回帰がベースライン差分閾値内で通過し、注釈・習熟度色・カテゴリチップがトークン値に一致する
  - _Requirements: 4.2, 4.3, 4.4, 12.2_
  - _Depends: 11.2_
  - _Boundary: visual regression tests_
