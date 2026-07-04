# Lexia 学習体験 包括レビューと改善実装計画

- 作成日: 2026-07-05
- 対象コード: `main` @ `7196d56`（2026-07-04 時点の作業ツリー）
- 作成方法: マルチエージェントレビュー — 8 サブシステムの精読（発見 97 件）、学習科学リサーチ、学習者ペルソナ 5 視点による追加問題の発掘（63 件 → 重複統合 49 件）、うち重要度上位 36 件の敵対的コード検証（36 件全件が実在確認・棄却 0 件）、テーマ別執筆、完全性監査（指摘 10 件を反映済み）。本文中のコード参照（`ファイル:行`）は監査時に約 30 箇所をスポットチェックし正確性を確認している。

---

## エグゼクティブサマリ

本ドキュメントは、Lexia を「学習者にとって使いやすく・学びやすいか」という観点で徹底的にレビューし、テーマ A〜E（ユーザ指摘）とテーマ F（レビューで新たに発見・検証した 36 件）について、現状の問題 → あるべき姿 → 改善の方向性 → 実装計画（対象ファイル・受け入れ基準・テスト方針付き）をまとめたものである。末尾に 3 フェーズの実装ロードマップと、学習方針の根拠となる学習科学エビデンス集を付す。

### 最重要の発見 — 学習ループそのものが壊れている

個別の使いにくさ以前に、「文章を読む → 単語に出会う → 復習して定着する → 次の文章に再登場する」という中核ループを成立させていない欠陥が複数確認された。

1. **生成した語が即「復習期限」になる**（A-1-2, critical）。生成時にシードされる語はすべて `dueAt: 0` で保存されるため、読んだだけの語が永久に「期限到来」となり、2 回目以降の生成で新出語がほぼ提案されず、ホームの「今日の復習」件数も生成のたびに水増しされる。
2. **「今回織り込む単語」は「指定しない」が作れない**（A-1-1）。ホームが常に候補 12 語をプリフィルして送信するため、空指定時の自動選択パスはデッドコードであり、さらにレベル変更後は「表示した単語」と「実際に織り込まれる単語」が無言で食い違う。
3. **生成品質は「モデル任せ」で、指示も検証も存在しない**（テーマ B）。プロンプトの品質指示は実質 1 点のみで、イディオム・定型表現への言及はゼロ。バリデータは品質を一切検証せず、CEFR 語彙ゲートは本番で常時無効。B-3 の実態確認の結論: **難易度に応じた構文複雑度の制御は実装されていない**（レベルは語彙選択にしか効いていない）。
4. **解説の浅さはデータ構造の問題**（テーマ C）。イディオムは裸の文字列配列（`idioms: string[]`）で由来を格納する場所がなく、語源は形態素と見出し語が連結されない散文、コロケーションはヘッド形（型＋スロット）を持たない。プロンプト改善だけでは直らず、WordData の構造体化が必要である。あわせて C-5 で「Lexia 学習方針」を FSRS（目標保持率 0.90）・想起練習先行・新語密度上限 2% などの正準値として明文化した。
5. **初回起動が詰む**（F-1, critical)。API キー未設定のときサーバは対処法込みのエラーを返しているが、クライアントが 2 段階でそれを破棄し「時間をおいて再試行してください」と表示するため、新規ユーザは復旧手段に到達できない。
6. **読書行動が記録されていない**（F-2/F-3）。読書位置は保存されず「続きを読む」・進捗バーは飾りで、streak は評定・読了ボタン押下の日しか継続しない。日付境界はすべて UTC のため、日本の学習者は朝 9 時まで「前日」扱いになる（F-4）。
7. **静かな品質劣化**: 注釈生成が出力 4000 トークン上限で無音全滅し長文ほど「気づき」ゼロになる（F-6）、デザイン指定の Web フォントが一切ロードされていない（F-7）、和訳オフでも本文右 38% が空白のまま（F-8）。

### テーマ別の要点

- **テーマ A（生成の設定・制御）**: 症状の大半は「候補プリフィルの常時送信」と「`dueAt: 0` シード」の 2 点に集約される。プリフィルを全廃して `targetWordIds` を手動追加語のみに変え、自動選択は生成時に解決する（A-1-1）。リセットは自動選択語を永続化しない設計に変えることで完全化する（A-2-1）。加えて newWordRatio を「復習枠/新出枠」の二枠計画として実装し直す（A-1-3、現状 0% で候補ゼロになるバグを含む）。
- **テーマ B（文章の質）**: プロンプト改善（B-1 イディオム/コロケーション、B-2 定型表現のクォータ付き織り込み、B-3 レベル別構文プロファイル）に加え、効果を測定・担保するための計測基盤（B-4 CEFR 語彙ゲート復旧）と生成基盤の健全化（B-5 モデル・サンプリング・トークン予算・語数保証）を独立項目として立てた。改善後プロンプトの文面案（英語）を各項に含む。
- **テーマ C（解説の深さ・学習設計）**: `IdiomEntry`（意味・由来・比喩の橋渡し）・`EtymologyV2`（形態素分解と見出し語への連結・同語根語）・`CollocationEntry`（ヘッド形＋スロット）への構造体化と、表示・プロンプトの三層改修。C-4 は難構文への文単位の構文ノート（`sentenceNotes`）を新設する。C-5 は学習方針文書 `docs/learning-policy.md` の制定と、方針に反している現実装（未 reveal 評定可・Undo なし・due 定義の不一致等）の是正。
- **テーマ D（レイアウト・操作性）**: 右レール崩れは単一バグではなく 5 つの構造的原因（座標系不一致・カード内 CSS 破綻・高さ再計測欠落・幅制約欠如・情報過密）の複合と特定した。クリック可否の視覚言語を定義し（D-2）、ホーム→単語解説ジャンプはオーバーレイ + `/w/:wordId` ルートで実現する（D-5）。追加検出としてモバイル/中間幅の破綻（D-6）、待ち時間フィードバック欠如（D-7）、モーダル/コントラスト/Undo などの a11y・安全性基盤（D-8）を含む。
- **テーマ E（画像・アイコン・蓄積）**: 画像プロバイダはプロバイダ記述子テーブルに再設計して Grok（xAI）を追加し、fast/quality の用途別プロファイルを導入する（現状は quality が常時 `low` 固定）。favicon/manifest は存在しないため PWA 対応込みで新設する（E-2）。単語解説・イラスト・候補は Dexie への cache-first 化で再訪時の再生成待ちをなくす（E-3）。
- **テーマ F（追加発見）**: 検証済み 36 件を影響順に 10 グループで詳述。上記 5〜7 のほか、バックアップ/エクスポート導線ゼロ（F-5）、機能しない朗読プレイヤーバーの常駐、復習セッションのキーボード操作不能・評定 Undo なし等を含む。

### 実装ロードマップの骨子

- **Phase 1（2〜3 週間）— 「詰み・洪水・無音失敗」の解消と計測下地**: F-1 エラー顕在化 → A-1-2 dueAt 是正 → A-1-3 二枠化 → B-5 第 1 弾 → F-6 暫定 → E-3 単語カード cache-first → D 第 1 波 → `/w/:wordId` 基盤 → C-5a 学習方針文書 → F-7 フォント + ビジュアルベースライン再生成。
- **Phase 2（6〜8 週間）— 学習体験の中核改善**: 4 ストリーム並行（α 学習ループ/SRS 正準化、β 生成の設定・制御、γ 生成品質バッチ 1、δ 読解 UI とモーダル/トースト基盤）。
- **Phase 3（6 週間〜）— 基盤・拡張**: WordData 構造体化（C-1/2/3 一括)、プロンプトバッチ 2（B-3 + C-4 + F-6 本命)、E-1 Grok、エクスポート v2 と画像 Blob 分離、仕上げ群。
- 着手前に確定すべき **先行設計判断 D1〜D8**（SRS due の二面定義、wordCache スキーマバージョニング、プロンプト変更の 2 バッチ集約、collocationId 契約ほか）と**横断リスク R1〜R7** をロードマップ §3 に定義した。

---

## 目次

1. **テーマ A: 生成の設定・制御** — A-1-1 プリフィル廃止と生成時自動選択 / A-1-2 dueAt=0 シード廃止 / A-1-3 復習・新出の二枠化 / A-1-4 続き章の単語再選択 / A-2-1〜A-2-4 リセット完全化と除外語の可視化 / A-3-1〜A-3-3 難易度粒度・単語帳からの導線・試験級併記
2. **テーマ B: 生成される文章の質** — B-1 イディオム/コロケーション / B-2 定型表現 / B-3 難易度別構文複雑度【実態確認の結果を含む】 / B-4 CEFR 語彙ゲート復旧 / B-5 生成基盤の健全化
3. **テーマ C: 解説の深さ・学習設計** — C-1 イディオムの由来 / C-2 語源の形態素連結と意味ネットワーク / C-3 コロケーションのヘッド形 / C-4 構文解説 / C-5 Lexia 学習方針の制定と実装是正
4. **テーマ D: レイアウト・操作性** — D-1 右レール崩れ / D-2 クリック可否の視覚言語 / D-3 単語帳 / D-4 文章サムネイル / D-5 復習単語ジャンプ / D-6 モバイル破綻 / D-7 待ち時間フィードバック / D-8 安全性・アクセシビリティ基盤
5. **テーマ E: 画像生成・アイコン・蓄積** — E-1 Grok 追加と品質/速度切替 / E-2 アプリアイコン / E-3 蓄積キャッシュ
6. **テーマ F: 追加発見された問題** — F-1〜F-8 詳述 / F-9 小改善群 / F-10 未検証の参考問題
7. **実装ロードマップ** — 優先度マトリクス / 3 フェーズ / 先行設計判断 D1〜D8 と横断リスク R1〜R7 / フェーズ別検証
8. **付録: 学習科学エビデンス集** — C-5 の根拠資料（間隔反復・想起練習・ILH・形態素分析・定型表現・二重符号化・構文と i+1・動機づけ）
9. **付録: レビュープロセスと統計**

---

## テーマA: 生成の設定・制御

本テーマは「今回織り込む単語」欄の既定動作（A-1）と「リセット」の完全性（A-2）を中心に、検証で確認された難易度指定・単語帳導線の追加問題を含む11項目で構成する。根本原因は (1) ホームが常に候補12語をプリフィルして `targetWordIds` として送信・永続化するアーキテクチャ（`src/ui/app/routes.tsx:343-358`, `src/ui/setup/SetupScreen.tsx:167-171`, `routes.tsx:444-445`）と、(2) 生成シード語が `dueAt: 0` で即「復習期限到来」になる SRS シード設計（`src/state/controllers/newState.ts:21`）の2点に集約され、A-1/A-2 の症状の大半はこの2点から派生している。

### A-1-1: 「今回織り込む単語」の既定空化 — プリフィル廃止と生成時自動選択への一本化

**現状の問題**

ホームはマウント時に必ず `WordSuggestionService.suggest` を実行して候補12語（`CANDIDATE_LIMIT=12`、`src/ui/app/routes.tsx:56`, `routes.tsx:343-358`）を取得し、SetupScreen が「(候補 − 除外) + 手動追加」を `targetWordIds` として送信する（`src/ui/setup/SetupScreen.tsx:167-171`）。このため「指定しない」状態が実質作れず、UI ヒント「指定しない場合は、選んだレベルと趣向に合わせた文章を生成します」（`SetupScreen.tsx:465-467`）は実装と矛盾する。空指定時の自動選択パス `resolveTargetWordIds`（`routes.tsx:168-185`）は `targetWordIds` が常に非空のため、ホーム経由ではほぼ発動しないデッドコードである。さらにレベル・趣向を変更しても候補は再取得されず（`routes.tsx:310` の `candidateSetup` が SetupScreen 内の変更に追従しない）、生成ボタン押下時に `setupForGeneration`（`routes.tsx:388-398`）が suggestionKey 不一致を検知して裏で候補を無言差し替えるため、「ユーザが見て了承した単語」と「実際に織り込まれる単語」が食い違う（`routes.tsx:393`）。候補ロード中のローディング表示もない（`routes.tsx:343-358` は `refreshingCandidates` を立てない）。

**あるべき姿**

ホームを開くと「今回織り込む単語」欄は空で、ヒント文だけが表示される。ユーザが単語を手動追加した場合のみチップが増える。何も指定せず生成すると、難易度（CEFR）・趣向・SRS 状態（復習期限語＋新出語）から生成時点で単語が自動選択され、文章生成後の読書画面・結果画面で「今回織り込んだ単語」として提示される。設定変更と表示単語の不整合、無言差し替え、ローディング空白は構造的に発生しない。

**改善の方向性**

- 案X（プリフィル維持＋同期修正）: 候補プリフィルを残し、レベル/趣向変更時にデバウンス付き自動再取得を追加する。→ 毎回ホームを開くたびに LLM 提案（数秒）を待つコストが残り、A-2-1 のチップ復活問題の温床（`targetWordIds` への自動語混入）も残る。
- 案Y（既定空・生成時自動選択、推奨）: プリフィルを全廃し、`targetWordIds` の意味を「手動追加語のみ」に変更する。自動選択は生成時に `resolveTargetWordIds` で解決し、手動語とマージする。ユーザ要望 A-1 の文言そのままであり、A-1-4・A-2-1 の主因も同時に消える。補助として「自動選択をプレビュー」ボタン（任意押下でのみ suggest 実行・チップ表示）を残す。

案Yを採用する。プロンプト変更は不要である（空指定時も生成前にクライアント側で単語を解決するため、`server/llm/schema.ts:320-323` の「no target words」分岐、`schema.ts:846-874` の提案プロンプトはそのまま使える）。

**実装計画**

- [ ] `src/types/domain.ts:466`: `SetupConfig.targetWordIds` の JSDoc を「手動追加語のみ。自動選択語は含めない」に変更する（型変更なし）。
- [ ] `src/ui/app/routes.tsx:343-358`: マウント時の自動 suggest useEffect を削除する。`candidates`/`candidateSetup`/`lastSuggestionKey`/`setupForGeneration`（`routes.tsx:388-398`）/`isUneditedAutoSelection`（`routes.tsx:93-95`）を撤去する。
- [ ] `src/ui/app/routes.tsx:168-185`: `resolveTargetWordIds` を「手動語を保持しつつ、不足分を suggest で補充してマージする」実装に変更する。条件 `if (setup.targetWordIds.length > 0 || excludedWordIds.length > 0) return` を廃し、常に `mergeWordIds(manual, suggested)`（`routes.tsx:110-123` を再利用）で計画数（A-1-3 の `targetWordPlanFor` 参照）まで補充する。suggest には手動語を `excludedWordIds` に合流させて重複提案を防ぐ。
- [ ] `src/ui/app/routes.tsx:412-437`: `runArticlePipeline` で解決後の単語リストを `effectiveSetup` に入れて生成には使うが、`setLastSetup`（`routes.tsx:444-445`）には手動語のみの setup を渡す（自動語の永続化廃止。A-2-1 の前提）。
- [ ] `src/ui/setup/SetupScreen.tsx:130-171`: `candidates` prop 依存を「プレビュー時のみ」へ縮小し、既定表示を「手動追加チップ + 追加フォーム + ヒント文」にする。ヒント文（`SetupScreen.tsx:465-467`）は「指定しない場合は、復習が必要な単語と新しい単語を自動で選んで織り込みます」に更新する。
- [ ] 「自動選択をプレビュー」ボタンを追加し、押下時のみ `refreshCandidates`（`routes.tsx:360-376`、`refreshingCandidates` スピナーあり）を実行してチップ表示する。プレビュー中のロード表示は既存 `refreshingCandidates` を流用する。
- [ ] 生成完了後の読書画面右レールに自動選択語が既に表示されること（`uniqueStudyWords`、`routes.tsx:213-222`）を確認し、「自動選択」バッジを付ける。
- [ ] 受け入れ基準: (1) 初回ホーム表示で suggest API が呼ばれない、(2) 何も追加せず生成すると計画数どおりの単語が織り込まれる、(3) 手動追加語は必ず織り込み対象に含まれる、(4) レベル変更→即生成でも表示と実態の食い違いが起きない（表示していないので定義上不成立）。
- [ ] テスト方針: `src/ui/setup/SetupScreen.test.tsx` に「既定で対象チップが0件」「手動追加のみが targetWordIds に載る」を追加。`src/ui/app/routes.test.tsx` に「マウント時に suggest が呼ばれない」「生成時に resolveTargetWordIds が手動語＋自動語をマージする」を追加。`resolveTargetWordIds` はルートから純関数として切り出して単体テスト化する。

### A-1-2: 生成シード語の dueAt=0 廃止 — 「読んだだけの語」が即・復習期限になる問題

**現状の問題**

生成成功時、織り込んだ未知語は全て `newSchedulingState` で `dueAt: 0` のままシードされる（`src/state/controllers/newState.ts:21`、upsert は `src/state/controllers/generationController.ts:100-107,119-120`）。`dueBefore` は `dueAt <= now` を全件返すため（`src/infra/persistence/schedulingRepository.ts:18-24`）、シード語は永久に「期限到来（due）」であり、次回の候補枠を最優先で占有する（`src/domain/suggestion/wordSuggestionService.ts:90-104`）。結果、2回目以降の生成では新出語がほぼ提案されず同じ単語ばかり織り込まれ、ダッシュボードの「今日の復習」件数も生成のたびに水増しされる（`planReviewQueue` = `dueBefore`、`src/domain/session/sessionPlanner.ts:84-91`）。severity: critical。

**あるべき姿**

文章内で一度出会っただけの語は「翌日に再織り込みの機会が来る学習中の語」であり、生成直後から復習期限ではない。生成→翌日にホームの生成候補（再織り込み枠）に「復習」理由で載る。一方、stability 未定義の読了語は /review の想起テストキューには載らず（D1 の二面定義: 復習キューは評定履歴を持つ語のみ）、次の文章への再織り込みを通じて自然に復習される。当日中に再生成しても前回の語が枠を占有せず、新出語が計画どおり提案される。

**改善の方向性**

- 案X（提案側でフィルタ）: `dueAt=0` は維持し、suggest 側で「未レビュー（stability undefined）の語」を due 扱いから除外する。→ 復習キュー（/review）とダッシュボードの水増しが直らない。
- 案Y（シード時に初期期限を設定、推奨）: シード時に `dueAt = now + 1日` を設定する。初回学習ラダーの Hard=1日（`src/domain/srs/parameters.ts:53-58`）と整合し、「読んだ翌日に初回想起」という間隔反復の定石どおりになる。復習キュー・ダッシュボード・候補提案の3箇所が同時に正常化する。
- 併用（防御的実装）: 案Yに加え、suggest 側でも「同一セッション内でシードされた未レビュー語」を新出枠にカウントしない(A-1-3 の枠設計に含める)。

案Y＋併用を採用する。

**実装計画**

- [ ] `src/state/controllers/newState.ts:11-25`: `newSchedulingState(userId, wordId, now?: number)` にシグネチャ変更し、`dueAt: now !== undefined ? now + DAY_MS : 0`（`DAY_MS = 86_400_000`）とする。既存の呼び出し（`generationController.ts:100`、レビュー/lookup 経由のシード箇所を grep で全列挙）に `deps.now()` を渡す。
- [ ] 本項は C-5b の `isDueForReview`（stability を持つ語のみを /review キューの due 対象とする）と互換な形で実装する（roadmap 設計判断 D1 参照）。`dueAt` の初期期限はホームの生成候補（再織り込み枠）の優先度にのみ効かせ、stability 未定義語が /review キューへ混入する経路を再導入しないこと。
- [ ] `src/infra/persistence/lexiaDb.ts`: Dexie バージョンアップで一次マイグレーションを追加する — `scheduling` の `dueAt === 0 && reps === 0 && stability === undefined` の行を `dueAt = Date.now() + DAY_MS` に更新する（既存ユーザの水増し解消）。
- [ ] `src/domain/dashboard/dashboardProjector.ts:79-142`: 変更不要（dueBefore の結果が正常化されるため）だが、回帰確認テストを追加する。
- [ ] 受け入れ基準: (1) 生成直後に /review のキューへ対象語が現れない、(2) 生成直後にホームの「今日の復習 N語」が増えない、(3) 24時間後（フェイククロック）には生成候補（再織り込み枠）には due として現れるが、stability 未定義のため /review キューには現れない（D1 の二面定義に準拠）。
- [ ] テスト方針: `src/state/controllers/generationController.test.ts` にシード後の `dueAt` 検証を追加。`src/state/controllers/pipeline.integration.test.ts` で「生成→即 suggest」で前回語が due 枠に入らないこと、およびフェイククロックで24時間進めた後「suggest には載るが `isDueForReview` 準拠の /review キューには載らない」ことを検証。マイグレーションは lexiaDb のバージョンアップテスト（fake-indexeddb）で検証する。

### A-1-3: 復習枠と新出枠の二枠化 — newWordRatio の意味修正（0% で候補ゼロ問題を含む）

**現状の問題**

`wordSuggestionService` は `desiredNewCount`（新出語の希望数、`src/domain/generation/lengthSpec.ts:73-79` の定義）を提案「総数」の上限として使い（`src/domain/suggestion/wordSuggestionService.ts:33-36`）、due→weak が先に枠を埋めると LLM 新出提案を行わない（同 `:108`）。このため「新出単語の割合」スライダは実装上「提案総数の上限」であり、30% にしても2回目以降は新出ゼロ（A-1-2 と複合）、0% にすると `newWordsFor` が 0 を返し（`lengthSpec.ts:74`）`requested === 0` で復習語すら返さず（`wordSuggestionService.ts:70-71`）、対象単語なしの文章が生成される。復習/新出の構成比をユーザが制御する手段は `SuggestionInput`（`src/types/domain.ts:561-573`）に存在しない。

**あるべき姿**

newWordRatio は文字どおり「織り込む単語のうち新出語の割合」を意味する。0% なら復習due語・苦手語だけで構成された復習特化の文章、100% なら全部新出、30% なら復習7:新出3で計画される。復習語が足りなければ新出で補い、その逆も行う。

**改善の方向性**

`lengthSpec` に単語計画関数を新設し、suggest を二枠充填に書き換える一択である（比較対象なし。現行は仕様として成立していない）。

```ts
// src/domain/generation/lengthSpec.ts に追加
export interface TargetWordPlan {
  total: number;       // min(12, max(1, round(wordTarget / 40)))
  newSlots: number;    // round(total * newWordRatio)
  reviewSlots: number; // total - newSlots
}
function targetWordPlanFor(wordTarget: number, newWordRatio: number): TargetWordPlan;
```

**実装計画**

- [ ] `src/domain/generation/lengthSpec.ts:73-78`: `targetWordPlanFor` を追加し、`newWordsFor` は `plan.newSlots` の別名として残すか呼び出し元ごと置換する。`newWordRatio <= 0` でも `total > 0` を保証する。
- [ ] `src/types/domain.ts:561-573`: `SuggestionInput` の `desiredNewCount?: number` を `plan?: { reviewSlots: number; newSlots: number }` に置換する（旧フィールドは1リリース互換で残す）。
- [ ] `src/domain/suggestion/wordSuggestionService.ts:69-141`: (1) `requested === 0` 早期 return（`:70-71`）を撤去し、(2) due→weak は `reviewSlots` まで、LLM 提案は `newSlots` まで充填、(3) 一方の枠が埋まらない場合のみ他方へ繰り越す、(4) A-1-2 併用策として「stability undefined かつ reps 0 の語」は reviewSlots の充填対象から除外する。
- [ ] 呼び出し元 `src/ui/app/routes.tsx:168-185`（改修後の resolveTargetWordIds）に `plan` を渡す。
- [ ] 受け入れ基準: (1) ratio 0% で復習語のみ（新出0）の候補が返り文章が生成される、(2) ratio 100% で全枠 LLM 新出、(3) 30%・総枠10で復習7＋新出3（復習不足時は新出で補充）、(4) 候補ゼロで生成される事象が消滅する。
- [ ] テスト方針: `src/domain/suggestion/wordSuggestionService.test.ts` に枠充填のプロパティテスト（ratio 0/0.3/1.0 × 復習語 過多/不足）を追加。`src/domain/generation/lengthSpec.test.ts` に `targetWordPlanFor` の境界値（wordTarget 100/400/800）を追加。

### A-1-4: 長編物語の続き章 — 章ごとの単語再選択

**現状の問題**

「次の章を生成」は `storyContinuationSetup(lastSetup, ...)` が lastSetup を spread して `targetWordIds` を保持したまま（`src/ui/app/routes.tsx:229-240`）、`resolveTargetWordIds` が非空なら即 return する（`routes.tsx:168-169`）ため、全章に「最後にホームで生成したときの単語群」がそのまま再度織り込まれる（`routes.tsx:818-820`）。章を進めても新しい単語を学べない。

**あるべき姿**

各章の生成時点で SRS 状態と難易度から単語を選び直す。復習due語は再登場してよい（むしろ望ましい）が、直前章で導入したばかりの未レビュー語や、同一ストーリーで既に織り込んだ新出語は避け、章ごとに新しい語彙に出会える。

**改善の方向性**

A-1-1 改修後の `resolveTargetWordIds` に委ねるのが最小差分である。`storyContinuationSetup` で `targetWordIds: []` にリセットし、既出語を避けるために「そのストーリーの全章の targetSpans から抽出した wordId」を suggest の除外リストへ渡す。

**実装計画**

- [ ] `src/ui/app/routes.tsx:229-240`: `storyContinuationSetup` の返り値に `targetWordIds: []`, `excludedWordIds: []` を明示する。
- [ ] `src/ui/app/routes.tsx:818-820` 周辺: ストーリーの既存章（`c.repos.passages` から storyId で取得）の `targetSpans.wordId` を集約し、`resolveTargetWordIds` の suggest 呼び出しに avoid リストとして渡す（`loadCandidates` の `avoidWordIds` 相当、`routes.tsx:316-319` のマージ方式を流用）。due 語は avoid から除外し再登場を許す。
- [ ] 受け入れ基準: (1) 3章連続生成で各章の新出語が重複しない、(2) due 語は章をまたいで再登場できる、(3) 章生成で lastSetup.targetWordIds が汚染されない。
- [ ] テスト方針: `src/ui/app/storyRoute.test.tsx` に「続き章2回で targetWordIds が毎回異なる」シナリオを追加。avoid 集約ロジックは純関数に切り出し `src/domain/story/` 配下で単体テストする。

### A-2-1: リセットの完全化 — 自動選択語の非永続化・チップ復活/二重表示の解消・副作用除去

**現状の問題**

(1) 生成時に自動選択語込みの `targetWordIds` が lastSetup として Dexie へ永続化され（`src/ui/app/routes.tsx:444-445`）、再訪時に SetupScreen の `added` 初期化（`src/ui/setup/SetupScreen.tsx:155-157`）が「candidates がまだ空の時点」で一度だけ走るため、前回の全12語が「手動追加チップ」として復活する。候補が非同期到着すると同一単語が候補チップと追加チップで二重表示され（`SetupScreen.tsx:479-508`、`data-testid` も `target-${w}` で衝突）、`hasManualEdits`（`SetupScreen.tsx:230`）が常に true になってリセットボタンが誤有効化される。リセットしても次の生成で再永続化→再復活するため「リセットが状態を残す」と体感される。severity: critical。(2) さらにリセットは `buildSetup(examTarget ?? DEFAULT_EXAM)` で未確定のフォーム全体を emit し（`SetupScreen.tsx:232-245`）、route がそれを lastSetup へ保存する（`routes.tsx:383-385`）ため、いじりかけのレベル・スライダ値や未選択時の DEFAULT_EXAM（英検2級、`SetupScreen.tsx:64,241`）まで黙って確定される。

**あるべき姿**

リセットを押すと、手動追加語と除外の2つだけが完全に消え、以後も勝手に復活しない。レベル・趣向・スライダ等の未確定フォーム値には一切触れない。同一単語のチップが二重に表示されることはない。

**改善の方向性**

主因（自動語の永続化）は A-1-1 の「lastSetup には手動語のみ保存」で消滅する。本項では残る3点 — added 初期化タイミング、リセットの永続化スコープ、testid 衝突 — を修正する。プレビュー機能（A-1-1）で candidates が再び共存し得るため、added の candidates 追従は独立に必要である。

**実装計画**

- [ ] `src/ui/app/routes.tsx:412-445`: 生成時の `setLastSetup` に渡す setup から自動選択語を除去し、手動追加語のみを `targetWordIds` として保存する（A-1-1 のタスクと同一。二重計上しないこと）。
- [ ] `src/ui/setup/SetupScreen.tsx:155-157`: `added` の一発初期化をやめ、`useEffect([candidates])` で `added = added.filter((id) => !candidateIds.has(id))` に再フィルタする。表示リストは `mergeWordIds` 相当の小文字比較で重複統合する。
- [ ] `src/ui/setup/SetupScreen.tsx:497-508`: 追加チップの `data-testid` を `target-added-${w}` に変更し候補チップと分離する。
- [ ] `src/ui/app/routes.tsx:378-386`: `resetTargetWords` を「現在永続化済みの lastSetup を読み、`targetWordIds: []` / `excludedWordIds: []` だけをパッチして保存」に変更する。SetupScreen 側（`SetupScreen.tsx:232-245`）はフォーム値を emit せず、単語フィールドのローカル状態初期化＋リセット発生の通知のみにする（`onResetTargetWords()` を引数なしへ）。
- [ ] `SetupScreen.tsx:64,241` の `DEFAULT_EXAM` フォールバックによる黙示的保存が起きないことを確認する（emit 廃止で構造的に消える）。
- [ ] 受け入れ基準: (1) 生成→ホーム再訪で追加チップが0件、(2) 同一単語のチップが2枚表示されるケースが存在しない、(3) リセット後に IndexedDB の lastSetup で examTarget/newWordRatio 等が変化していない、(4) リセットボタンは手動編集がある時のみ有効。
- [ ] テスト方針: `src/ui/setup/SetupScreen.test.tsx` に「initial.targetWordIds と candidates の非同期到着で二重チップにならない」「リセットが単語フィールド以外を emit しない」を追加。`src/ui/app/routes.test.tsx` に「生成→再マウントで added が空」の回帰テストを追加。

### A-2-2: リセット後も同じ提案が返る問題 — リセット仕様の明文化

**現状の問題**

`resetTargetWords`（`src/ui/app/routes.tsx:378-386`）は lastSetup の上書きと候補再ロードのみで、Dexie の scheduling 状態には触れない。過去に織り込んだ語が `dueAt=0` で常に due のため（`newState.ts:21` + `schedulingRepository.ts:18-24`）、リセット→再提案してもほぼ同じ単語リストが返り、「リセットしても変わらない」と体感される（`wordSuggestionService.ts:90-104` の due 最優先充填）。

**あるべき姿**

リセットの意味は「手動編集（追加・除外）の破棄」と明確に定義され、押した結果として復習枠＋新出枠の新しい提案が返る。学習履歴（SRS）はリセットで消えない — これは仕様として UI 文言に明記される。

**改善の方向性**

根本原因は A-1-2（due 洪水）と A-1-3（新出枠ゼロ）であり、両者を直せばリセット後の提案は自然に「due の復習語＋新しい新出語」になる。scheduling を消す「完全初期化」オプションは学習履歴の破壊であり既定のリセットに含めるべきでない。設定画面に別途「学習データの初期化」（確認ダイアログ付き）として分離配置する。

**実装計画**

- [ ] A-1-2・A-1-3 実装後にリセット→提案の挙動を再検証する（本項は依存タスク）。
- [ ] `src/ui/setup/SetupScreen.tsx:444` 周辺: リセットボタンの title/ラベルを「手動で追加・除外した単語を消して自動選択に戻します（学習履歴は消えません）」に更新する。
- [ ] 任意（低優先）: 設定画面に「学習データを初期化」を追加する場合は `SchedulingRepository` に `clearAll(userId)` を追加し、確認ダイアログ必須とする。
- [ ] 受け入れ基準: (1) リセット直後のプレビュー提案に新出枠ぶんの未見語が含まれる、(2) due 到来済みの語は引き続き提案される（履歴は保持）。
- [ ] テスト方針: `pipeline.integration.test.ts` に「生成→リセット→suggest」で新出枠が埋まることを検証するシナリオを追加。

### A-2-3: 除外語（excludedWordIds）の可視化と個別解除

**現状の問題**

除外語は `initial.excludedWordIds` から Set に初期化され（`src/ui/setup/SetupScreen.tsx:154`）、suggest 呼び出しで候補から除去されるため（`routes.tsx:319`, `wordSuggestionService.ts:73`）、再訪時はチップ自体が表示されず、不可視のまま提案を抑制し続ける。ユーザは「なぜこの単語が出ないのか」を知る術がなく、解除手段は全消しのリセットのみ。「単語を更新」後も stale な除外が `buildSetup`（`SetupScreen.tsx:222`）で再永続化される。

**あるべき姿**

除外中の単語は折りたたみ式の「除外中の単語 (N)」一覧でいつでも確認でき、各語の×で個別解除、「すべて解除」で一括解除できる。解除した語は次回の提案・自動選択に復帰する。

**改善の方向性**

UI 追加のみで完結する（データは `SetupConfig.excludedWordIds` に既存）。世代管理による自動 GC は「ユーザが意図して除外した語が勝手に復活する」リスクがあるため採らず、可視化＋手動解除を推奨する。

**実装計画**

- [ ] `src/ui/setup/SetupScreen.tsx`: 対象単語セクション下に `<details>` ベースの「除外中の単語 (N)」を追加し、各チップに×ボタン（`excluded` Set から delete）と「すべて解除」を実装する。N=0 のとき非表示。
- [ ] 除外の永続化タイミングを生成時・リセット時に限定し（A-2-1 のスコープ修正と整合）、解除操作は次回生成時に確定する旨をヒント表示する。
- [ ] 受け入れ基準: (1) 過去に除外した語が一覧で見える、(2) 個別解除した語が次回プレビュー/生成の候補に復帰し得る、(3) リセットで除外一覧が空になる。
- [ ] テスト方針: `SetupScreen.test.tsx` に「除外→一覧表示→個別解除→buildSetup の excludedWordIds から消える」を追加。

### A-2-4: チップ操作モデルの可視化 — クリック＝除外/削除であることを示す

**現状の問題**

候補チップはクリックで除外トグル（`src/ui/setup/SetupScreen.tsx:175-181`, `:483-494`）だが、その操作モデルを示すテキスト・×アイコン・ツールチップがなく（title は「復習/苦手/新出」のみ、`SetupScreen.tsx:111-116`）、除外状態も打消し線＋グレーだけ（`SetupScreen.tsx:629-642`）。手動追加チップはクリックで即削除（`SetupScreen.tsx:183`, `:497-508`）と挙動が非対称で、誤操作に気づけない。

**あるべき姿**

チップを見ただけで「×を押せば外れる」「もう一度押せば戻る」が分かる。候補チップと手動チップの操作が対称である。

**改善の方向性**

A-1-1 で既定表示は手動チップのみになるため、対象は (a) 手動チップと (b) プレビュー時の候補チップ。両者とも「本体＋×アイコン」の2ホットスポット構成に統一する: ×クリックで除外/削除、除外状態のチップには「除外中・タップで戻す」の title と復元アイコン（↩）を付ける。手動チップの即削除はやめ、確認なしで消す代わりに直後に「元に戻す」スナックバー（5秒）を出す方式でもよいが、最小実装は×アイコン化のみとする。

**実装計画**

- [ ] `src/ui/setup/SetupScreen.tsx:479-508`: チップに `×` アイコン（`aria-label="{word} を除外"` / `"{word} を削除"`）を追加し、`title` を「クリックで除外（もう一度で戻す）」/「クリックで削除」に変更する。
- [ ] `SetupScreen.tsx:629-642`: 除外状態スタイルに ↩ アイコンと破線ボーダーを追加し、`title` を「除外中 — クリックで戻す」にする。
- [ ] 受け入れ基準: (1) 全チップに操作を示すアイコンと title がある、(2) `aria-pressed` と `aria-label` が状態を正しく反映する。
- [ ] テスト方針: `SetupScreen.test.tsx` で aria-label とトグル動作（除外→復元）を検証する。

### A-3-1: 難易度指定の粒度不足 — TOEIC 900 等の目標スコアを表現できない

**現状の問題**

ExamLevelPicker は固定チップのみでスコア自由入力がなく（`src/ui/setup/ExamLevelPicker.tsx:58-74`）、TOEIC の選択肢は 400/600/800/960 の4値（`src/domain/difficulty/examScale.ts:51-56`）。内部変換も 785–944 点を丸ごと B2 に写像するため（`examScale.ts:78-83`）、800点相当と940点相当が同一難易度になる。プロンプトへは CEFR と readabilityLevel しか渡らず（`server/llm/schema.ts:335-344`）、生スコアは不達。高度設定も CEFR 5値のみ（`src/ui/setup/SetupScreen.tsx:87,323-328`）で、バンド内の微調整（B2+/C1- 相当）が構造的に不可能。

**あるべき姿**

TOEIC 900 を目標とする学習者が「900」と入力でき、生成文章が「上位B2（C1 語彙が時折混ざる）」として 800 指定と体感的に区別できる難易度になる。

**改善の方向性**

- 案X（CEFR 帯を増やす）: 内部ピボットを B2+/C1- 等に細分する。→ `Cefr` 型が suggest・検証・SRS レベルフィルタ（`wordSuggestionService.ts:46-50`）まで波及し影響が大きい。
- 案Y（CEFR ピボット維持＋サブバンドヒント追加、推奨）: `Cefr` はそのまま、`GenerationRequest` に `levelDetail`（バンド内位置＋試験ラベル）を追加してプロンプトにのみ反映する。スコア自由入力は `ExamCriterion.value` が string のため型変更不要（`examToCefr` は既に任意スコアをパース可能、`examScale.ts:112-121`）。

案Yを採用する。

**実装計画**

- [ ] `src/ui/setup/ExamLevelPicker.tsx`: TOEIC/TOEFL/IELTS 選択時にスコア数値入力欄（TOEIC: 10–990）を追加し、入力値を `ExamCriterion{kind, value}` としてそのまま保持する。チップは近似値のクイック選択として残す。
- [ ] `src/domain/difficulty/examScale.ts`: `examToDifficultyTarget(criterion): { level: Cefr; subBand: 'low'|'mid'|'high'; examLabel: string }` を追加する。subBand はバンド境界（例: B2=785–944 を3等分し 785–837/838–891/892–944）からの位置で決定する。
- [ ] `src/types/domain.ts:491-511`: `GenerationRequest` に `levelDetail?: { subBand: 'low'|'mid'|'high'; examLabel: string }` を追加し、`src/domain/session/sessionPlanner.ts:54,58` の難易度解決で埋める。
- [ ] `server/llm/schema.ts:336-344`: `passageUser` の request JSON に `levelDetail` を含め、次の指示行を追加する:

  ```
  Calibrate difficulty WITHIN the CEFR band using levelDetail.subBand:
  "low" = the bottom third of the band, "mid" = the middle, "high" = the top third,
  with vocabulary and syntax approaching the next band up. levelDetail.examLabel names
  the learner's concrete goal (e.g. "TOEIC 900"): a B2 request with subBand "high"
  must read clearly harder than a plain B2 text — use upper-B2 lexis, occasional C1
  words in transparent contexts, and denser clause structure, while staying below C1
  overall.
  ```
- [ ] 受け入れ基準: (1) TOEIC 欄に 900 と入力でき、生成リクエストに `levelDetail: { subBand: 'high', examLabel: 'TOEIC 900' }` が載る、(2) 800 と 900 でプロンプト内容が異なる、(3) 既存の固定チップ選択は従来どおり動く。
- [ ] テスト方針: `src/domain/difficulty/examScale.test.ts` に subBand 境界値テスト（785/838/900/944）を追加。`src/domain/session/sessionPlanner.test.ts` で levelDetail の伝搬、`server/llm` のプロンプトスナップショットテストで指示行の存在を検証する。

### A-3-2: 単語帳から生成への導線欠如 — 苦手単語の集中織り込み

**現状の問題**

単語帳の行クリックは詳細カード表示のみで（`src/ui/wordbook/WordbookScreen.tsx:118,138-149`）、複数選択・「この語を次の文章に織り込む」・「選択語だけ復習」のアクションが存在しない。生成側の手動追加は幅120px（`src/ui/setup/SetupScreen.tsx:667`）の自由テキストに1語ずつタイプする方式（`SetupScreen.tsx:185-191`）で、既習語からの補完・ピッカーがない。唯一の間接経路は詳細カードの「知らなかった」→ Again 評定で due 化する裏技（`WordDetailCard.tsx:220-231`, `routes.tsx:1265-1273`）のみ。「今週はこの20語を潰す」という定番戦略が実行できない。

**あるべき姿**

単語帳で苦手語をチェックボックスで複数選択し、「選択した単語で文章を生成」を押すとホームの対象単語欄に選択語が手動追加語として積まれた状態で遷移し、そのまま生成できる。

**改善の方向性**

- 案X（単語帳から直接生成実行）: 単語帳に生成ボタンを置き即生成する。→ レベル・長さ等の確認機会がなく、生成設定の一元性が崩れる。
- 案Y（選択→ホームへ持ち込み、推奨）: `navigate('/', { state: { addWordIds } })` でホームへ渡し、HomeRoute が location.state を読んで SetupScreen の手動追加初期値に注入する。A-1-1 の「targetWordIds = 手動語のみ」と合流し、選択語は必ず織り込まれる。

**実装計画**

- [ ] `src/ui/wordbook/WordbookScreen.tsx`: 選択モード（「選択」トグル→各行チェックボックス→フッターに「選択した単語で文章を生成 (N)」）を追加する。props に `onWeaveWords?: (wordIds: string[]) => void` を追加し、結線は `src/ui/app/routes.tsx:1033-1059` の WordbookRoute で `navigate('/', { state: { addWordIds } })` を渡す。
- [ ] `src/ui/app/routes.tsx` HomeRoute: `useLocation().state?.addWordIds` を読み、SetupScreen の `initial.targetWordIds`（手動語）へマージして注入する。消費後は `history.replaceState` で state をクリアし再訪時の再注入を防ぐ。
- [ ] `src/ui/word/WordDetailCard.tsx:220-231` 付近: 「次の文章に織り込む」ボタンを追加し、同じ経路でホームへ遷移する（単語帳オーバーレイからの1語導線）。
- [ ] 受け入れ基準: (1) 単語帳で3語選択→ボタン→ホームで3語が手動チップとして表示、(2) そのまま生成すると3語全てが本文に織り込まれる、(3) ホーム再訪（state なし）で再注入されない。
- [ ] テスト方針: `WordbookScreen` の選択モードのコンポーネントテスト、`routes.test.tsx` に location.state 注入→targetWordIds 反映の結線テストを追加。

### A-3-3: 高度設定の CEFR 記号への試験級併記

**現状の問題**

高度設定の「単語レベル」select は 'A2'〜'C2' の生記号のみ（`src/ui/setup/SetupScreen.tsx:87,323-327`）、目標連動バッジも CEFR 表記のみ（`SetupScreen.tsx:304`）、ExamLevelPicker の換算行は試験間換算だけで CEFR に触れない（`src/ui/setup/ExamLevelPicker.tsx:80`）。初心者は「B1 = 英検2級相当」を知る手掛かりがない。一方 `examScale.ts:34-40` の DISPLAY 表と `cefrToExam`（`examScale.ts:123-125`）が既に公開されており流用可能。

**あるべき姿**

高度設定の選択肢が「B1（英検2級 / TOEIC 550–784 相当）」のように馴染みある尺度併記で表示され、換算行にも CEFR 記号が併記される。

**改善の方向性**

`examScale.cefrToExam` を使った表示文字列の合成のみで完結する。新ロジック不要。

**実装計画**

- [ ] `src/ui/setup/SetupScreen.tsx:323-327`: option ラベルを `${cefr}（英検${cefrToExam(cefr).eiken}・TOEIC ${cefrToExam(cefr).toeic} 相当）` に変更する（eiken が 'n/a' の C2 は「英検対象外」と表示）。
- [ ] `SetupScreen.tsx:304`: 目標連動バッジを「目標連動 B1（英検2級相当）/ 標準」に変更する。
- [ ] `src/ui/setup/ExamLevelPicker.tsx:80`: 換算行の先頭に `CEFR ${cefr}` を追加する。
- [ ] 受け入れ基準: 高度設定・バッジ・換算行の3箇所全てで CEFR と試験級の対応が読める。
- [ ] テスト方針: `SetupScreen.test.tsx` / `ExamLevelPicker.test.tsx` のラベル文字列アサーションを更新・追加する。

### 優先度と依存関係

実装順序は以下とする。

1. **A-1-2（critical・独立）**: dueAt=0 シードの廃止。提案・復習キュー・ダッシュボード全ての品質前提であり、最初に単独で出荷する。
2. **A-1-3（critical 級・A-1-2 に依存）**: 二枠化。A-1-2 とセットで初めて「新出語が提案される」状態が完成する。
3. **A-1-1（major・A-1-3 に依存）**: 既定空化。生成時自動選択の計画数を A-1-3 の `targetWordPlanFor` から得るため後行させる。A-2-1 の主因除去・A-2-2 の前提・無言差し替え/ローディング問題の消滅を兼ねる。
4. **A-2-1（critical・A-1-1 と同時実装）**: リセット完全化の残タスク（added 再フィルタ・永続化スコープ・testid）。A-1-1 と同一 PR で入れるのが安全である。
5. **A-1-4（major・A-1-1 に依存）**: 続き章の単語再選択。改修後の `resolveTargetWordIds` を前提とする。
6. **A-2-2（major・A-1-2/A-1-3 に依存）**: 検証と文言更新のみ。1〜2 の完了後に実施する。
7. **A-3-2（major・A-1-1 に依存)**: 単語帳導線。「targetWordIds = 手動語のみ」の意味変更後に着手する。
8. **A-3-1（major・独立）**: 難易度サブバンド。他項目と競合しないため 1〜4 と並行実装可能である。
9. **A-2-3 / A-2-4 / A-3-3（minor・A-1-1 の UI 確定後）**: 除外語一覧・チップ操作可視化・CEFR 併記。SetupScreen の最終レイアウトが決まってからまとめて実施する。

依存の要点: A-1-2 → A-1-3 → A-1-1 →（A-2-1, A-1-4, A-3-2）が主鎖であり、A-3-1・A-3-3 は独立枝、A-2-2・A-2-3・A-2-4 は主鎖完了後の仕上げである。

---

## テーマB: 生成される文章の質

本テーマの結論を先に述べる。生成文章の質が低い根本原因は単一ではなく、(1) プロンプトが JSON 形式遵守に偏り文章品質の指示がほぼ皆無であること、(2) バリデータが品質を一切検証せず「モデル任せ」であること、(3) 品質を測るはずの CEFR 語彙ゲートが本番で常時無効であること、(4) 既定モデル・サンプリング・トークン予算という生成基盤自体が品質を制約していること、の4層が重なっている。B-1〜B-3 のプロンプト改善だけでは効果が測定も担保もできないため、計測基盤（B-4）と生成基盤（B-5）を独立項目として立てる。

### B-1: イディオム・コロケーションを活用した自然で質の高い文章生成

**現状の問題**

生成プロンプト PASSAGE_SYSTEM（server/llm/schema.ts:266-325）を精読した結果、文章の質に関する指示は「ターゲット語の supplied core.collocations を再利用せよ」（server/llm/schema.ts:315-318）の一点のみである。`idiom`・`phrasal verb`・`natural`・`set phrase` に類する語は本文生成指示に一度も出現しない（`idiom` は翻訳スパンの refType 列挙 server/llm/schema.ts:284 のみ）。指示の大半はトークン化（schema.ts:271-274）・スパン形式（schema.ts:290-293）・制約充足（schema.ts:295-313）という機械的整合性に費やされ、ターゲット語なし生成では「empty targetSpans/collocationSpans/noticeCues で一貫したテーマの文章を書け」（schema.ts:322-323）とだけ指示され品質の手掛かりがゼロになる。

さらにバリデータ側は品質を一切検証しない。collocationSpans の検査は範囲チェックのみで（src/domain/generation/passageValidator.ts:191-196 のコメント自身が `// CollocationSpans: range only.` と明言）、検査項目の全リスト SpanViolationKind（passageValidator.ts:20-29）は位置・整合系の9種のみである。プロンプトは「collocationSpans should be NON-empty」（schema.ts:320）と言うが、空でも違反にならず、collocationId が core.collocations 由来かの照合もない。修復ループの REPAIR_HINT（src/domain/generation/generationOrchestrator.ts:66-79）にも品質系フィードバックは存在しない。つまりモデルがコロケーションを1つも織り込まず、イディオムゼロの平板な文章を返しても、検証はすべて通過する。

**あるべき姿**

学習者が読む文章は「単語リストを散文に偽装したもの」ではなく、ネイティブが書いたと感じる自然な英文である。Erman & Warren (2000) が示すとおり自然な英語談話の 50-58% は定型的連鎖で構成されるため、レベル相応の高頻度イディオム・フレーズ動詞が語数に比例した本数（250語なら2個以上、1000語なら6-7個）織り込まれ、ターゲット語は必ず supplied コロケーションの中で登場する。織り込まれた表現はすべてスパンとして自己申告され、注釈パスで必ず解説が付き、右レールで学習対象として提示される。量が不足すれば修復ループが具体的フィードバック付きで再生成させる。

**改善の方向性**

選択肢は (a) プロンプト指示の追加のみ、(b) プロンプト指示＋自己申告スパン＋バリデータ検証の一気通貫、の2つ。(a) は実装が軽いが「指示はあるが守られない」現状の readability 指示（B-3 参照）と同じ轍を踏む。**(b) を推奨する**。既に targetSpans/collocationSpans で確立している「自己申告→再アンカー→検証→修復」のパイプライン（providers.ts:386-410 の reanchorSpans、generationOrchestrator.ts:124-127 の repairFeedback）をそのまま流用でき、追加スパン種 `expressionSpans` を1つ足すだけで B-2 とも共用できる。

なお collocationId の照合契約は、C-3 が導入する `CollocationEntry.id`（kebab-case の安定ID）とロードマップ D4 の決定「B-1 実装時から id ⇄ 旧文字列フォールバックで書く」に従う。すなわち B-1 の時点から、collocationId は「構造化済み語データなら supplied entry の `id`、旧形式（プレーン文字列の collocations）ならコロケーション文字列そのもの」の二形を等価に受け付ける照合として実装し、Phase 3（C-3 構造化本番投入）でプロンプト・バリデータを書き直さずに済むようにする。

**実装計画**

- [ ] `PassageOutput` 型（src/types/domain.ts）と PASSAGE_JSON_SCHEMA（server/llm/schema.ts）に `expressionSpans: { span, surface, category: 'idiom' | 'phrasal_verb' | 'set_phrase', meaningJa }[]` を追加する
- [ ] passageUser（server/llm/schema.ts:328-347）の request JSON に `idiomQuota = max(2, round(approxWords / 150))` と `setPhraseQuota = max(2, round(approxWords / 200))`（B-2 用）を追加する
- [ ] PASSAGE_SYSTEM の Collocations 段落（schema.ts:315-323）を以下の Writing quality ブロックに置き換える:

```
Writing quality (as binding as the constraints above — a flat, mechanical passage is a FAILED passage):
- Write natural, native-like prose: vary sentence openings, keep one coherent narrative voice and
  a register that fits the intent, and connect sentences with appropriate discourse markers
  (however, meanwhile, as a result, on the other hand) so the text reads as authored prose,
  not a disguised word list.
- Idiomatic language quota: weave in at least `idiomQuota` (given in the request) DIFFERENT
  high-frequency idioms or phrasal verbs that fit the intent and are understandable at the
  requested CEFR level (e.g. B1: "come up with", "in the long run"; B2+: "take ... into account",
  "get to grips with"). Prefer items a learner will meet again in real texts; avoid rare,
  regional, or dated idioms.
- Self-report every idiom / phrasal verb / set phrase you deliberately used: add one entry to
  expressionSpans with { span, surface (the tokens joined, verbatim), category: "idiom" |
  "phrasal_verb" | "set_phrase", meaningJa (a short natural Japanese gloss) }. These spans are
  validated; missing or under-quota expressionSpans cause rejection and regeneration.
- Collocations: actively REUSE each target word's supplied core.collocations in the passage —
  a learner needs to see the word in its natural phrases. For every collocation you weave in, add
  a collocationSpan covering exactly its tokens, with headWordId = that word's wordId and
  collocationId = copy the collocation's id (or, for legacy word data whose collocations are
  plain strings, the collocation string itself) verbatim from that word's supplied
  core.collocations — never invent one. Every target word that has supplied collocations MUST
  appear inside at least one of them.
```

- [ ] reanchorSpans（server/llm/providers.ts:386-410）で expressionSpans も surface からトークン位置を再導出する
- [ ] **C-3/D4 の id 契約を参照した collocation 照合の実装**: 現状の reanchorSpans は `locate(passage.sentences, span.collocationId, ...)` と collocationId を表層文字列そのものとして照合している（providers.ts:399-407）。C-3 で collocationId が kebab-case の安定 id になるとこの照合は壊れるため、B-1 実装時から「collocationId を supplied core.collocations の構造化 entry（`id` → entry の表層テキスト）で解決し、解決できなければ collocationId 文字列そのものを表層として照合する（旧形式フォールバック）」の二段照合で実装する。バリデータ側の照合（後述 `collocation_id_unknown`）も同一の二段契約に従う
- [ ] passageValidator（src/domain/generation/passageValidator.ts:191-196 周辺）に新違反種を追加する: `expression_quota_unmet`（category 別本数がクォータ未満）、`expression_span_mismatch`（surface とトークン列の不一致）、`collocation_missing`（core.collocations を持つターゲット語に対応する collocationSpan がゼロ）、`collocation_id_unknown`（collocationId が、supplied core.collocations のどの構造化 entry の `id` とも一致せず、かつ（旧形式の場合）どのコロケーション文字列そのものとも一致しない。D4 の id ⇄ 旧文字列フォールバック契約に従う）。SpanViolationKind（passageValidator.ts:20-29）と REPAIR_HINT（generationOrchestrator.ts:66-79）に対応エントリを追加。REPAIR_HINT 文面例: `expression_quota_unmet: 'Weave in more high-frequency idioms / phrasal verbs / set phrases until the requested quotas are met, and self-report each one in expressionSpans.'` / `collocation_id_unknown: "Every collocationId must be copied verbatim from that word's supplied core.collocations — its id, or, for legacy word data, the collocation string itself; remove or fix invented ones."`
- [ ] 修復予算枯渇時の出荷ポリシー: isLengthOnly（generationOrchestrator.ts:134-136）を `isShippableResidual`（length系＋品質系のみなら出荷）に拡張し、残存した品質違反を `meta.qualityWarnings` として IndexedPassage に載せる（UI 表示はテーマDと連携）。品質違反でハードフェイルさせない
- [ ] 注釈パスへの接続: finalize（generationOrchestrator.ts:150-166）の annotatePassage 呼び出しに expressionSpans を渡し、buildCoverage（server/llm/schema.ts:509-537）の必須カバレッジに加える（category は申告値をそのまま使用）。これで織り込んだ全イディオムに explanationJa が保証される
- [ ] テスト: passageValidator.test.ts にクォータ未達/偽 collocationId/コロケーション欠落フィクスチャを追加。collocation 照合は「構造化 entry の id で一致」「旧形式の生文字列で一致」「どちらにも不一致→ collocation_id_unknown」の3ケースを必ず持つ。generationOrchestrator.test.ts にフェイクゲートウェイで「1回目クォータ未達→repairFeedback に expression_quota_unmet ヒント→2回目合格」のシナリオと予算枯渇時 qualityWarnings 出荷のシナリオを追加。schema.test.ts で idiomQuota 計算とプロンプト文面のスナップショットを更新
- [ ] 受け入れ基準: (1) モック検証で quota 未達が必ず repairFeedback 化される、(2) 実生成サンプル10本で expressionSpans 平均本数 ≥ クォータ、collocationId の 100% が supplied リスト由来（id または旧文字列のいずれかで解決可能）である、(3) 品質違反のみの残存では生成が失敗しない、(4) 構造化前の旧形式語データと C-3 構造化後の語データの両方で同一のバリデータ・reanchor コードパスが通る（Phase 3 での書き直し不要）

### B-2: 英語頻出の定型表現（set phrases / formulaic expressions）の織り込み

**現状の問題**

PASSAGE_SYSTEM（server/llm/schema.ts:266-325）と passageUser（schema.ts:328-382)に `set phrase` / `formulaic` / `fixed expression` に相当する指示は存在しない（grep 上 `phrase` は注釈カテゴリ列挙 schema.ts:391-409 と注釈例文 schema.ts:463 にのみ出現）。注釈パス ANNOTATION_SYSTEM（schema.ts:439-488）は「You annotate an already-written English reading passage」（schema.ts:440）とあるとおり既に書かれた文章の事後ラベリングであり、生成段階で定型表現を含める駆動力にはならない。結果、intent=business でもビジネス文書の定型（I am writing to... / I look forward to...）が使われるかは完全に偶然である。Pawley & Syder (1983) の nativelike selection 問題そのもので、学習者が現実で最も頻用する formulaic language に触れる設計になっていない。

**あるべき姿**

intent を選ぶと、そのジャンルでネイティブが実際に手を伸ばす定型表現が文章の「あるべき位置」に現れる。business ならメールの書き出し・結びの定型、toeic ならアナウンス・社内メモの定型、travel ならチェックイン・道尋ねの定型が、語数比例の本数（500語で2-3個）自然に織り込まれ、各表現に「この場面でこう使う」という注釈が必ず付く。学習者は単語だけでなく「場面ごと丸ごと使える表現の鋳型」を文章から獲得する。

**改善の方向性**

B-1 の `expressionSpans`（category: `set_phrase`）に相乗りするのが最小コストで一気通貫になる。intent 別の例示リストは、静的な PASSAGE_SYSTEM に全 intent 分を書くとプロンプトが肥大するため、**passageUser 側で当該 intent のリストのみ注入する方式を推奨する**（EXAM_INTENTS の examBias 注入 schema.ts:349-352 と同じパターン）。

**実装計画**

- [ ] server/llm/schema.ts に intent 別例示定数 `SET_PHRASE_HINTS: Record<Intent, string[]>` を新設する（各 intent 10-15 表現。business: "I am writing to inquire about", "Please find attached", "I look forward to hearing from you", "as per our discussion", "moving forward" / toeic: "Attention, passengers.", "Please note that", "We apologize for any inconvenience.", "Thank you for your patience." / travel: "I'd like to check in", "Could you tell me how to get to", "Is breakfast included?", "Have a safe trip." / daily: "It's been a while.", "You know what?", "No wonder", "That makes sense." / eiken・academic: "It is widely believed that", "This suggests that", "In conclusion", "in contrast to"）
- [ ] PASSAGE_SYSTEM の Writing quality ブロック（B-1 で新設）に以下を追加する:

```
- Formulaic language: every intent has conventional set phrases native speakers reach for. Include
  at least `setPhraseQuota` (given in the request) of them, chosen to fit the text type, and
  self-report each in expressionSpans with category "set_phrase". Set phrases must appear where
  they naturally belong — a greeting opens a letter, an announcement formula opens an
  announcement, a closing formula ends an e-mail. Do NOT sprinkle them at random.
```

- [ ] passageUser（schema.ts:328-382）に、examBias 注入（schema.ts:349-352）の直後で当該 intent のヒントを注入する:

```
Set-phrase suggestions for this intent (illustrative, not exhaustive — you may use others that
fit better): "I am writing to inquire about ...", "Please find attached ...", ...
```

- [ ] passageValidator の `expression_quota_unmet` 検査（B-1 で新設）に category=`set_phrase` の本数 ≥ setPhraseQuota を含める
- [ ] 注釈パス接続は B-1 と共通（expressionSpans が必須カバレッジ化されるため追加作業なし）。ANNOTATION_SYSTEM の EXPLANATION STYLE には既に phrase 例（schema.ts:463）があるため変更不要
- [ ] テスト: schema.test.ts で intent ごとのヒント注入をスナップショット検証。passageValidator.test.ts に set_phrase クォータ未達フィクスチャを追加
- [ ] 受け入れ基準: (1) 全6 intent でヒントリストが定義され user メッセージに注入される、(2) 実生成サンプル（intent=business, 500語）で set_phrase スパンが2個以上入り、書き出し・結びの定型が文書の該当位置に現れる、(3) 各 set_phrase に注釈 cue が付与される

### B-3: 難易度別構文複雑度 — 実態確認の結果と改善【要確認項目の確定】

**実態確認の結果（確定）**

「難易度に応じた構文指示がそもそも無いのではないか」という仮説は**不正確**である。確認された実態は以下のとおり。

1. **指示は存在し、伝搬経路も健全**: PASSAGE_SYSTEM に readabilityLevel 3段階の指示がある（server/llm/schema.ts:307-311、原文 "advanced = longer sentences may use relative clauses, participial phrases, abstract noun phrases, and denser connectors"）。設定値は sessionPlanner.ts:128 → GenerationRequest → schema.ts:335 の `req.readabilityLevel ?? readabilityForCefr(req.level)` でリクエスト JSON に確実に埋め込まれる。
2. **しかし強制力がない**: advanced ですら「may use（使ってもよい）」という許可止まりで、モデルが全編単文で書いても何の違反にもならない。倒置・分裂文・仮定法・非制限関係詞・同格など試験頻出の高度構文は一切列挙されていない。
3. **検証がゼロ**: passageValidator（src/domain/generation/passageValidator.ts:163-328）に文長分布・従属節数・構文レパートリーの検査は皆無であり、実効性は不可視。
4. **矛盾する固定指示**: 「Roughly one sentence per 12-15 words」（schema.ts:302）が readabilityLevel と無関係に全レベルへ適用され、easy（短い単文）とも advanced（長い複文）とも矛盾する単一リズムを強制している。
5. **写像の粗さ**: levelPreset.ts:15-19 は A2/B1→easy、B2→standard、C1/C2→advanced の3値写像で、C1 と C2 に同一指示が渡る。

結論: **ユーザの懸念「難易度に応じた読解しにくい文が入っていない可能性」は構造的に正しい**。指示は渡っているが、要求水準・具体構文・検証のいずれも欠けており、レベル差の実現はモデルの気まぐれに依存している。

**あるべき姿**

学習科学リサーチの原則「+1 は語彙に限定、構文は学習者レベル i に固定」に基づき、readabilityLevel が構文の上限と下限の両方を規定する。easy では受動態・関係詞を排した短文（平均 8-12 語/文）で未知語推測の文脈手がかりを壊さず、advanced では倒置・分詞構文・仮定法・分裂文・同格が意図的に配置された長文（平均 16-24 語/文）が生成される。難構文は `syntaxSpans` として自己申告され、その noteJa が C-4（構文解説 UI）の表示データになる。English Grammar Profile / CEFR-J の実証リストが示すとおり「レベル別構文リスト」はコーパス基盤で構築可能であり、空想的な仕様ではない。

**改善の方向性**

選択肢は (a) プロンプトの要求化のみ、(b) 要求化＋自己申告 syntaxSpans＋クライアント側軽量計測（平均文長）、(c) L2SCA 相当のフル構文解析器導入。(c) はブラウザで動く高精度パーサが必要で費用対効果が悪い。**(b) を推奨する**。平均文長は tokens から決定論的に算出でき、構文レパートリーは自己申告＋anchorText の verbatim 検証（noticeCues と同じ手法、passageValidator.ts:210-217 の cue_surface_mismatch と同型）で十分に担保できる。C1/C2 の差別化は語彙レベル（vocabularyLevel）側で既に表現されるため、readabilityLevel は3値を維持し写像変更はしない。

**実装計画**

- [ ] `PassageOutput` に `syntaxSpans: { sentenceIndex, pattern: 'nonrestrictive_relative' | 'participial' | 'inversion' | 'cleft' | 'subjunctive' | 'appositive' | 'other', anchorText, noteJa }[]` を追加する（server/llm/schema.ts の JSON スキーマ＋src/types/domain.ts。noteJa が C-4 の構文解説シードになる）
- [ ] PASSAGE_SYSTEM の Length・Readability 指示（schema.ts:301-311）を以下に置き換える（「12-15語/文」固定指示の撤廃を含む）:

```
- Length: the total number of words across all sentences MUST be close to the requested
  approxWords (aim within ±20%). Keep writing sentences until you reach that word count — do not
  stop early. meta.approxWords MUST equal the actual number of words you wrote. Sentence length
  follows the readability level below, NOT a fixed words-per-sentence rhythm.
- Readability (hard requirement, independent of vocabulary level):
  easy: 8-12 words per sentence on average; one main clause per sentence as a rule; connect ideas
    with and / but / because / so; NO passive voice, NO relative clauses, NO participial phrases.
    After a difficult word, prefer an appositive paraphrase ("a drought — a long period without
    rain —") so learners can infer meaning from context.
  standard: 12-16 words per sentence on average; a natural mix of simple, compound and complex
    sentences; you may use restrictive relative clauses, first/second conditionals, present
    perfect and basic passives; average at most one subordinate clause per sentence.
  advanced: 16-24 words per sentence on average, and across the whole passage you MUST use at
    least four of these five constructions, each at least once: (a) a non-restrictive relative
    clause, (b) a participial construction, (c) inversion or a cleft sentence ("Not only did ...",
    "It was ... that ..."), (d) an unreal conditional or subjunctive ("Had the plan failed, ..."),
    (e) an appositive noun phrase. Use nominalisation and dense connectors where natural, while
    keeping the passage coherent.
- Self-report syntax: for every construction above that you used on purpose, add an entry to
  syntaxSpans: { sentenceIndex, pattern, anchorText (a verbatim snippet of that sentence
  containing the construction), noteJa (one short Japanese reading hint, e.g. "倒置: Not only が
  文頭に出て助動詞 did が主語の前に移動する") }. At advanced readability, syntaxSpans MUST cover
  the required constructions; missing coverage causes rejection.
```

- [ ] passageValidator に2検査を追加する: `sentence_length_profile_mismatch`（平均語数/文が easy [6,13]・standard [10,18]・advanced [14,30] の帯域外。totalWords 計算 passageValidator.ts:291-306 と同じトークン走査で算出）と `syntax_repertoire_unmet`（advanced 時に syntaxSpans の distinct pattern が3種未満、または anchorText が当該文に verbatim 出現しない）。REPAIR_HINT（generationOrchestrator.ts:66-79）に対応文面を追加: `syntax_repertoire_unmet: 'At advanced readability, use the required constructions (non-restrictive relative clause, participial construction, inversion or cleft, subjunctive, appositive) and self-report each in syntaxSpans.'` / `sentence_length_profile_mismatch: 'Adjust average sentence length to the requested readability band: easy 8-12, standard 12-16, advanced 16-24 words per sentence.'`
- [ ] これらの違反は B-1 の `isShippableResidual` 対象に含め、予算枯渇時は qualityWarnings 付き出荷とする（読める文章を構文不足で捨てない）
- [ ] 注釈パス接続: finalize で syntaxSpans を annotatePassage の必須カバレッジ（category=`sentence_structure`）として渡し、noteJa を注釈の初期値として提示する（C-4 実装時にはこのデータをそのまま構文解説パネルに昇格させる）
- [ ] テスト: passageValidator.test.ts に「advanced 指定＋全編単文」フィクスチャで syntax_repertoire_unmet と sentence_length_profile_mismatch が出ることを検証。easy 指定＋平均20語/文フィクスチャで mismatch を検証。lengthSpec.test.ts は変更なし（文長帯はバリデータ側定数）
- [ ] 受け入れ基準: (1) advanced 実生成サンプル10本で平均文長 ≥ 15 語かつ必須構文 3 種以上を10本中8本以上が満たす、(2) easy 実生成サンプルで受動態・関係詞の出現が例外的（本文の 5% 未満の文）である、(3) syntaxSpans の noteJa が C-4 の UI から参照可能なデータとして IndexedPassage に保持される

### B-4: CEFR 語彙帯域ゲートの復旧 — B-1〜B-3 の計測基盤

**現状の問題**

語彙難易度検査は実装済みだが本番で完全に死んでいる。passageValidator.ts:275 の `const band = ctx.cefrOf?.(token.toLowerCase()); if (!band) continue;` は cefrOf 未注入なら全トークンをスキップし、known=0・cefrOffBandRatio=0 で違反ゼロになる（passageValidator.ts:281-287、閾値 CEFR_OUT_OF_BAND_TOLERANCE=0.15 は src/domain/srs/parameters.ts:79)。注入経路は container.ts:122,127 の `cefrOf: seams.cefrOf` だが、唯一の本番呼び出し src/main.tsx:25 は `createContainer(userId)` とシームなしで呼ぶため常に undefined であり、リポジトリ内に CEFR 辞書の実装も存在しない。設計コメント（passageValidator.ts:10 付近）は CEFR プロファイル検査を load-bearing と謳うが、実態は「Level: keep ALL non-target vocabulary at or below the requested CEFR level」（schema.ts:305-306）というプロンプト上の努力目標のみで、B1 設定に C1 語彙だらけの文章が来ても検出されない。

**あるべき姿**

Hu & Nation (2000) の 98% カバレッジ原則のとおり、未知語密度の管理は文脈学習アプリの生命線である。生成文の全トークンが静的 CEFR 辞書で帯域判定され、オフバンド率が閾値超過なら自動修復される。学習者には「この文章の語彙実測: B1（オフバンド 4%）」が提示され、B-3 の文長計測と合わせて「設定した難易度が本当に反映されている」ことがデータで確認できる。

**改善の方向性**

辞書ソースは3案ある。案1: CEFR-J Wordlist（約7,800レンマ、A1-C2 帯域付き、教育利用ライセンス。日本人学習者向けで本アプリの対象と一致）。案2: Oxford 3000/5000（再配布ライセンスが厳しく静的同梱に不向きのため不採用）。案3: 頻度近似（wordfreq の Zipf 値→帯域写像。例: zipf≥5.0→A2、4.3-5.0→B1、3.6-4.3→B2、3.0-3.6→C1、<3.0→C2）。**推奨は案1を主辞書とし、リスト外語を案3でフォールバック判定するハイブリッド**である。固有名詞・派生形の誤判定は「リスト外は頻度近似、それでも不明なら skip」という現行の寛容設計（band なしは continue）がそのまま吸収する。

**実装計画**

- [ ] 新規 `src/infra/cefr/cefr-bands.json`（レンマ→帯域の静的アセット、ビルド時バンドル）と `src/infra/cefr/cefrDictionary.ts`（`createCefrDictionary(): (token: string) => Cefr | undefined`。簡易レンマ化: -s/-es/-ed/-ing/-er/-est を剥がして再照合、失敗時は頻度近似へフォールバック）を追加する
- [ ] container.ts の seams（container.ts:57）で `cefrOf` の既定値を `seams.cefrOf ?? createCefrDictionary()` とし、main.tsx 無変更で本番注入されるようにする（テストは従来どおりシームで差し替え可能）
- [ ] IndexedPassage の meta に実測値 `vocabProfile: { offBandRatio: number, sampleSize: number }` を保存し、UI 表示（テーマD側）に提供する
- [ ] 閾値運用: 初期は現行 CEFR_OUT_OF_BAND_TOLERANCE=0.15（parameters.ts:79）のまま導入し、導入後2週間の生成ログでオフバンド率分布を計測、P75 が 0.10 未満であることを確認してから 0.10 に引き下げる
- [ ] テスト: cefrDictionary のユニットテスト（既知語の帯域スナップショット、屈折形レンマ化、リスト外語のフォールバック）。passageValidator.test.ts に「B1 設定＋C1 語 20% 混入フィクスチャ→cefr_out_of_band 違反」を追加。pipeline.integration.test.ts で本番相当の container 生成時に cefrOf が非 undefined であることを検証
- [ ] 受け入れ基準: (1) 本番ビルドで cefrOf が必ず注入され known > 0 になる、(2) B1 リクエストに対し C1/C2 語彙 20% の文章が修復ループに入る、(3) 辞書アセットの gzip 後サイズ ≤ 150KB

### B-5: 生成基盤の健全化 — モデル・サンプリング・トークン予算・語数保証

**現状の問題**

プロンプトを磨いても基盤が品質を制約する。4点が確認された。

1. **旧世代既定モデル**: providers.ts:88-91 で OpenAI 既定は `gpt-4o`。lengthSpec.ts:19-20 のコメント自身が「gpt-4o systematically under-produces」と既定モデルの弱点を自認している。
2. **サンプリング未制御**: providers.ts:129-150 のリクエストボディに temperature / top_p が両プロバイダとも一切ない（リポジトリ全体で `temperature` は0件）。全タスクがプロバイダ既定 1.0 で走り、創作（高め）と注釈・語義（低め）の使い分けができない。
3. **新モデルへ切替不能**: OpenAI パスは `max_tokens`（providers.ts:142)を送るが、新系列モデルは `max_completion_tokens` 必須のため、OPENAI_MODEL を上位モデルに変えると 400 で全滅する。
4. **トークン予算の物理的破綻**: `tokenBudgetFor = min(16000, 1000 + wordTarget * 9)`（lengthSpec.ts:56-70)に対し、UI は short_story 3000語まで許す（lengthSpec.ts:25-29）。3000語には約28,000トークン必要だが16,000に切詰められ、stopReason=max_tokens（providers.ts:428-429 相当の打切り検出）→ generationOrchestrator.ts:181-185 が**同一予算のまま**最大2回再試行して err で失敗する。実現可能上限は floor((16000-1000)/9)=1,666語。さらに語数許容帯は ±60%（lengthSpec.ts:22、実効 0.4x-1.6x）で、length 違反のみなら検証失敗でも出荷される（generationOrchestrator.ts:200-208）ため、指定1000語に対し400語が無通知で「正常品」として届く。

**あるべき姿**

学習者が選んだ語数はほぼその通り（±25%）に生成され、物理的に不可能な設定は UI が最初から許さないか、分割生成で実現される。文章生成は創作向きの温度・高品質モデル、注釈は低温度・高速モデルで走り、モデル更新が環境変数1つで安全にできる。指定と実際が乖離した場合はその事実が UI に明示される。

**改善の方向性**

トークン予算問題は (a) UI 上限を実現可能値 1,600語に切下げ、(b) max_tokens 失敗時に語数目標を自動縮退する適応リトライ、(c) 長文をチャンク分割生成して連結、の3案がある。(a) だけでは「3000語の短編」というユーザ価値を放棄する。**推奨は (b) を即時実装し、(c) を第2段として実装する二段構え**である。(c) は storyContext の章分割・priorSummaryJa 連結機構（schema.ts:353-373)が既にあるため、非ストーリーでも同じ継続コンテキスト方式を流用できる。

**実装計画**

- [ ] providers.ts の callModel（providers.ts:105-162）にタスク別パラメータ `{ temperature?: number }` を追加し、呼び出し箇所で指定する: passage 生成 0.8 / 注釈 0.3 / 語義・WordPack 0.4 / ストーリープラン 0.7。OpenAI の推論系モデル（temperature 非対応）向けに、モデル名が `o` 系・`gpt-5` 系の場合は temperature を送信しないガードを入れる
- [ ] providers.ts:142 の `max_tokens` を `max_completion_tokens` に変更する（gpt-4o でも受理されるため後方互換）。Anthropic 側（providers.ts:131)は `max_tokens` のまま
- [ ] modelFor（providers.ts:88-91）をタスク別環境変数対応にする: `LLM_MODEL_PASSAGE` / `LLM_MODEL_ANNOTATION` / `LLM_MODEL_WORDPACK`（未設定時は現行 OPENAI_MODEL / ANTHROPIC_MODEL にフォールバック）。既定モデルを現行上位世代に更新する
- [ ] 適応リトライ: generationOrchestrator.ts:181-185 の max_tokens 分岐で、再試行時に `wordTarget = min(wordTarget, 1600)` へ縮退した attemptReq を作り、縮退した事実を IndexedPassage の `meta.effectiveWordTarget` に記録する
- [ ] チャンク分割生成（第2段）: wordTarget > 1600 のとき ceil(wordTarget / 1200) 個のセグメントに分割し、各セグメントを priorSummaryJa 方式の継続コンテキスト付きで順次生成、sentences を連結してから全体を1回検証する。実装は generationOrchestrator に `generateChunked` を追加し、routes.tsx の結線は無変更（ポート内部で分岐）
- [ ] 語数保証の再強化: チャンク化の後に LENGTH_WORD_TOLERANCE を 0.6 → 0.25 に戻す（lengthSpec.ts:22）。length-only 出荷（generationOrchestrator.ts:200-208)時は `meta.lengthShortfall: { requested, actual }` を付け、読書画面に「指定 1000 語 / 実際 612 語」バナーを表示する（表示実装はテーマDと連携、データはここで用意）
- [ ] テスト: providers.test.ts でリクエストボディに temperature と max_completion_tokens が入ることをスナップショット検証、推論系モデル名で temperature が省略されることを検証。generationOrchestrator.test.ts に「max_tokens → 縮退再試行 → 成功」と「wordTarget=3000 → 3チャンク生成 → 連結後検証合格」のフェイクゲートウェイシナリオを追加。lengthSpec.test.ts の許容帯定数変更を反映
- [ ] 受け入れ基準: (1) OPENAI_MODEL を新系列モデル名にしても 400 エラーにならない、(2) wordTarget=3000・short_story が成功し実語数が 2250-3750（±25%）に収まる、(3) wordTarget=800 の実生成10本中8本以上が ±25% 以内、(4) 語数乖離時に meta.lengthShortfall が必ず記録される

### 優先度と依存関係

実装順序は以下とする。

1. **B-5（生成基盤）を最優先で先行実装する**。理由: B-1〜B-3 のプロンプト改善効果は、モデル世代・温度制御・十分なトークン予算が前提であり、gpt-4o + temperature 1.0 + 予算不足のままではプロンプトを磨いても効果測定がノイズに埋もれる。うち max_completion_tokens 対応・タスク別モデル/温度・適応リトライは小規模で即効性が高く、チャンク分割のみ第2段に回してよい。
2. **B-4（CEFR 辞書）を並行して実装する**。他項目と依存がなく独立に着手でき、B-1〜B-3 すべての受け入れ基準測定（語彙レベル実測）に必要な計測基盤である。
3. **B-1 と B-2 は同一 PR で実装する**。両者は同じスキーマ変更（expressionSpans）・同じバリデータ拡張・同じ注釈カバレッジ接続を共有しており、分割すると schema.ts / passageValidator.ts / providers.ts の同一箇所を二度触ることになる。B-1 の collocation 照合は D4 契約（C-3 の CollocationEntry.id ⇄ 旧文字列フォールバック）で最初から実装するため、C-3 本体（Phase 3）を待たずに着手でき、かつ Phase 3 でのプロンプト・バリデータ再修正は発生しない。B-5 のモデル更新後に実生成サンプルで品質を評価する。
4. **B-3 を最後に実装する**。B-1 で確立する「自己申告スパン＋再アンカー＋検証＋qualityWarnings 出荷」のパターンを syntaxSpans がそのまま踏襲するため、B-1 の後に置くと差分が最小になる。また syntaxSpans.noteJa は C-4（構文解説 UI）の前提データであり、**B-3 完了が C-4 着手の依存条件**になる。

依存関係の要約: B-5 → (B-1+B-2) → B-3 → C-4、B-4 は独立で全項目の計測を支える。B-1 の collocationId 照合は C-3/D4 の id 契約に前方互換（id＋旧文字列フォールバック）で書くため C-3 への逆依存はない。バリデータの違反種追加（B-1/B-3/B-4）はいずれも SpanViolationKind（passageValidator.ts:20-29）と REPAIR_HINT（generationOrchestrator.ts:66-79）の2箇所を伴うため、各 PR で必ず対で追加し、vitest のビルドが全体グラフで走る特性上（エクスポート漏れが全テストを壊す）、型追加時は `pnpm typecheck` を先に通すこと。

---

## テーマC: 解説の深さ・学習設計

本セクションは「解説が浅くて腑に落ちない」「学習ループが学習科学の定石から外れている」という2系統の問題を扱う。C-1〜C-3 は WordData のデータ構造・生成プロンプト・表示の三層を貫く改修、C-4 は読解支援パイプラインの拡張、C-5 は学習方針の明文化とそれに実装を合わせる是正である。

### C-1. イディオム解説に「なぜその意味になるのか」（由来・比喩の橋渡し）を追加する

**現状の問題**

イディオムの由来説明は、データ構造とプロンプトの両方で構造的に生成不可能になっている。

- データ構造: イディオムは裸の文字列配列である（src/types/domain.ts:433 `idioms: string[]`、server/llm/schema.ts:203 `idioms: { type: 'array', items: { type: 'string' } }`）。意味・由来・例文を格納するフィールドが型にもスキーマにも存在しない。
- 生成プロンプト: WORD_SYSTEM は「idioms and metaphor: fixed expressions and a short Japanese note on any metaphorical sense.」（server/llm/schema.ts:588）のみで、注は見出し語単位の単一 `metaphor` 文字列（schema.ts:205）に付く。イディオムごとの説明は要求されない。
- 表示: 単語カードは `{idioms.join(' / ')}`（src/ui/wordcard/WordDetailCard.tsx:330-334）で英語表現を「/」区切りで並べるだけ。日本語の意味すら表示されない。
- 読解画面の注釈パスは由来説明を積極的に禁止している: 「LENGTH: one short sentence ... ~20-45 Japanese characters」（schema.ts:474）、「For idiom/grammar_pattern give only the minimal non-literal twist, never a full gloss.」（schema.ts:476）。例示も「idiom "break the ice" -> 直訳ではなく「場の緊張をほぐす」固定表現。初対面や会議の冒頭で使う。」（schema.ts:461）と意味＋使用場面のみで由来を含まない。

**あるべき姿**

学習者が break the ice に出会ったとき、「船が氷を割って航路を開く→固まった場の空気を最初に壊す→『緊張をほぐす』」という字義→比喩→現在の意味の橋渡しを 1 タップで読め、丸暗記ではなく納得によって記憶できる。処理水準理論（Craik & Lockhart 1972; Craik & Tulving 1975）の通り、意味的な精緻化は保持を高める。読解中は本文の流れを止めないため、右レールには従来通り短文（意味のひねりのみ）を出し、クリック展開で由来説明が現れる二段構成とする。単語カードでは各イディオムが「表現 / 意味 / 由来 / 例文」のカードとして表示される。

**改善の方向性**

選択肢は (a) 既存の string[] のまま「表現 — 意味（由来）」を 1 文字列に詰め込む、(b) 構造体配列に変える、の 2 つ。(a) は表示制御・折りたたみ・将来の SRS カード化（イディオムのクローズ出題）が不可能になるため、**(b) 構造体化を推奨**する。読解画面側は explanationJa の短文制約を維持したまま、任意フィールド `detailJa` を追加する二段構成が、レールのレイアウト（1 アイテム約 94px 前提、src/ui/reading/NoticeRail.tsx:47）を壊さない。由来が学術的に不確かなイディオムは多いため、プロンプトで「通説として提示し断定しない」ことを明示し、幻覚由来の誤情報を防ぐ。

**実装計画**

- [ ] `src/types/domain.ts` — WordData.more.idioms を構造体配列に変更する:

```typescript
export interface IdiomEntry {
  /** 表現そのもの (e.g. "break the ice") */
  expression: string;
  /** 現在の意味（日本語） */
  meaningJa: string;
  /** 字義 → 比喩の橋渡し → 現在の意味。由来が不確かなら「〜と言われる」で通説を示す */
  originJa: string;
  exampleEn?: string;
  exampleJa?: string;
}
// WordData['more'] 内: idioms: IdiomEntry[];
```

- [ ] `server/llm/schema.ts` — WORD_MORE_JSON_SCHEMA の idioms（schema.ts:203）を上記構造のオブジェクト配列スキーマに置換（strict モードのため全プロパティ required、optional は nullable）。
- [ ] `server/llm/schema.ts` — WORD_SYSTEM の idioms 指示（588行）を以下に置換:

```text
- idioms: 0-4 entries, only genuinely common fixed expressions containing the headword.
  Each entry: { "expression", "meaningJa", "originJa", "exampleEn", "exampleJa" }.
  originJa MUST bridge the literal image to the idiomatic meaning in 1-2 Japanese
  sentences: literal reading -> metaphorical shift -> current meaning. Example for
  "break the ice": 「船が氷を割って航路を開くイメージ → 固まった場の空気を最初に壊す →
  「場の緊張をほぐす」の意味に。」 If the true origin is uncertain, give the standard
  folk explanation hedged with 「〜と言われる」— NEVER invent a confident false etymology.
```

- [ ] `server/llm/providers.ts` — normalizeWordData（providers.ts:494-523）に IdiomEntry の空値刈り取りと、**旧形式（string）を `{expression: s, meaningJa: '', originJa: ''}` に持ち上げる後方互換変換**を追加（Dexie wordCache に旧形式が残るため。E-3 のキャッシュ恒久化と整合させる）。
- [ ] `src/ui/wordcard/WordDetailCard.tsx` — idioms 表示（330-334行）を join から「表現（英・太字）/ 意味 / 由来（アイコン付き補足行）/ 例文」のカードリストに変更。summary（現在 `idioms[0]`）は「break the ice ほか2件」形式にする。
- [ ] `server/llm/schema.ts` — ANNOTATION_SYSTEM に任意フィールド `detailJa` を追加（noticeCues スキーマ schema.ts:150-163 に `detailJa: { type: ['string','null'] }` を追加）し、プロンプト（474-476行付近）へ以下を追記。476行の「never a full gloss」は「in explanationJa」にスコープを限定する:

```text
- detailJa (idiom / metaphor / grammar_pattern / sentence_structure cues only; null
  otherwise): 1-3 plain Japanese sentences, up to ~120 characters, expanding the cue.
  For idiom and metaphor explain WHY it means what it means: literal image ->
  metaphorical bridge -> current meaning, plus the typical situation. For
  grammar_pattern and sentence_structure explain how to parse the sentence. detailJa
  is shown only when the learner expands the cue, so explanationJa stays one short
  sentence; keep the "minimal non-literal twist" rule for explanationJa only.
```

- [ ] `src/types/domain.ts` — NoticeCue に `detailJa?: string` を追加。`src/ui/reading/ReadingGuideRail.tsx` — cue カードに「詳しく」トグルを追加し detailJa を展開表示（ピン留め時は自動展開）。
- [ ] 受け入れ基準: (1) resilient / break the ice 級の 10 語で生成した WordData の全 IdiomEntry に originJa が入り、字義→比喩→意味の 3 要素を含む。(2) 読解画面で idiom cue を展開すると detailJa が表示され、レールの初期レイアウト高が変わらない。(3) 旧形式キャッシュの単語カードがクラッシュせず表示される。
- [ ] テスト方針: normalizeWordData の新旧形式変換ユニットテスト（server/llm）。WordDetailCard に IdiomEntry フィクスチャ（src/ui/wordcard/gallery.fixtures.ts 拡張）を渡すレンダリングテスト。プロンプト回帰は手動評価シート（10 語 × origin の妥当性人手確認）を docs に残す。

### C-2. 語源の形態素分解と意味ネットワークを「見出し語に連結された構造」にする

**現状の問題**

- 語源: `etymology: { prefix?; root?; suffix?; noteJa? }`（src/types/domain.ts:424）で、形態素ごとの意味フィールドがない。プロンプト（server/llm/schema.ts:580-583）も「prefix/root/suffix ... plus noteJa」で、各形態素が見出し語のどの綴りに対応し意味がどう合成されるかを要求しない。表示は `[prefix, root, suffix].filter(Boolean).join(' + ')`（src/ui/wordcard/WordDetailCard.tsx:110-112, 313-316）で「re- + salire」式の裸連結＋自由記述 noteJa が分離して並ぶだけ。ユーザの「ラテン語の説明だけで対象単語と連結されない」はこのデータ構造に起因する。皮肉なことに memoryTips の etymology 種別（schema.ts:576-578）には「original spelling, language/source, original meaning, and the semantic bridge」という橋渡し必須指示が既にあり、語源フィールド本体より要求水準が高い。
- 意味ネットワーク: 5 配列すべて string[]（schema.ts:190-201）で関係の注釈を持てない。UI は synonyms/antonyms しか描画せず（WordDetailCard.tsx:318-324）、hypernyms/hyponyms/related は**生成トークンを消費しながら一度も表示されない**。summary ラベルは「類義 · 反義 · 上位/下位語」（319行）と実態と異なる表示をする。hasMore 判定（131-140行）も synonyms/antonyms しか見ない。各語はクリック不可で、CORE のニュアンス解説（synonymNuances, 294-305行）とも分断されている。

**あるべき姿**

resilient を開くと「re-（再び）+ sili（跳ぶ ← ラテン語 salire）+ -ent（〜の性質）→ 跳ね返って元に戻る → 回復力がある」という分解図が表示され、各形態素が見出し語の綴りにハイライト対応する。その下に「同じ語根の仲間: salient（跳び出る→目立つ）/ result（跳ね返ってくる→結果）」が並び、既に学習した語には既習バッジが付く（既有知識への接続。Nagy & Anderson 1984 は低頻度語の約 6 割が形態的に透明な派生語と推計しており、語根 1 つの知識が数十語に転移する）。意味ネットワークは各語に「buy より硬め」の一言注釈が付き、タップでその単語のカードへ遷移できる。

**改善の方向性**

etymology・semanticNetwork とも構造体化する。代替案として noteJa の書式をプロンプトで縛る（文字列のまま）方法があるが、綴り対応ハイライト・既習バッジ・関連語タップ遷移が不可能なため不採用。TOPRA モデル（Barcroft 2002: 初期の形式学習中の意味的精緻化強制は語形学習を阻害しうる）に従い、初遭遇時は語義のみ・語源分解は展開操作で見せる現行の CORE/MORE 二層は維持し、MORE の中身だけを構造化する。ただし C-2 の一部として、習熟段階が Learning 以上の語ではデフォルト展開する（後述チェック項目）。

**実装計画**

- [ ] `src/types/domain.ts` — etymology / semanticNetwork を以下に置換:

```typescript
export interface EtymologyPart {
  /** 形態素の表記 (e.g. "re-", "sali(re)", "-ent") */
  form: string;
  /** 見出し語中の対応綴り。音変化で対応が崩れる場合は null (e.g. "sili") */
  surfaceIn: string | null;
  /** 形態素の意味（日本語, e.g. "再び"） */
  meaningJa: string;
}
export interface EtymologyV2 {
  parts: EtymologyPart[];
  /** 合成 → 現在の意味への橋渡し 1 文（必須） */
  bridgeJa: string;
  /** 同語根語 2-5 件 */
  cognates: { word: string; noteJa: string }[];
  /** 由来言語 (e.g. "ラテン語 salire「跳ぶ」") */
  sourceJa?: string;
}
export type SemanticRelation = 'synonym' | 'antonym' | 'hypernym' | 'hyponym' | 'related';
export interface SemanticNeighbor {
  word: string;
  relation: SemanticRelation;
  /** 見出し語との差・関係の一言注釈（25 字以内, e.g. "buy より硬め"） */
  noteJa: string;
}
// WordData['more'] 内: etymology: EtymologyV2; semanticNetwork: SemanticNeighbor[];
```

- [ ] `server/llm/schema.ts` — WORD_MORE_JSON_SCHEMA（179-201行）を上記に対応させ、WORD_SYSTEM の該当指示（580-584行）を以下に置換:

```text
- etymology: { "parts", "bridgeJa", "cognates", "sourceJa" }. parts decompose the
  headword morphologically in order; "surfaceIn" is the exact substring of the headword
  that part corresponds to (null if sound change obscured it); "meaningJa" is the
  Japanese meaning of that part. bridgeJa MUST compose the parts into the modern sense
  as one arrow chain, e.g. for "resilient": 「re-（再び）+ sili（跳ぶ ← ラテン語 salire）
  + -ent（〜の性質）→ 跳ね返って元に戻る → 回復力がある」. cognates: 2-5 words sharing
  the root, preferring common words the learner likely knows (for spect: inspect /
  respect / spectator), each with a noteJa linking it to the shared root. If the origin
  is uncertain set parts to [] and say so in bridgeJa — never invent.
- semanticNetwork: a flat array of { "word", "relation", "noteJa" } with relation one of
  synonym / antonym / hypernym / hyponym / related. noteJa (<=25 Japanese chars) states
  how the word relates to or differs from the headword (nuance, register, or scope).
  [] if none. Do NOT list a word without a noteJa.
```

- [ ] `server/llm/providers.ts` — normalizeWordData に旧形式（{prefix,root,suffix,noteJa} / 5 配列）→ 新形式への持ち上げ変換を追加（parts へ機械変換、noteJa→bridgeJa、裸文字列→noteJa 空の SemanticNeighbor）。
- [ ] `src/ui/wordcard/WordDetailCard.tsx` — 語源行（313-316行）を分解図コンポーネント `EtymologyBreakdown` に置換: 見出し語を surfaceIn で色分けセグメント表示 → 下段に form/meaningJa の対応表 → bridgeJa の矢印チェーン → cognates チップ（既習語は習熟バッジ付き。習熟は scheduling から引く）。
- [ ] `src/ui/wordcard/WordDetailCard.tsx` — 意味ネットワーク行（318-324行）を relation 別グループ（類義/反義/上位/下位/関連）で全 5 種描画し、各語を「word — noteJa」のタップ可能チップにする。タップで `setActiveWord(word)`（既存の単語カードオーバーレイ遷移、src/ui/app/routes.tsx:1235-1295 の WordDetailRoute を再利用）。summary ラベル（319行）は実データから件数を生成（「類義3 · 反義2 · 関連4」）。hasMore 判定（131-140行）を semanticNetwork 全体で判定するよう修正。
- [ ] `src/ui/wordcard/WordDetailCard.tsx` — MoreRow のデフォルト開閉（61行 `useState(false)`）を props 化し、習熟段階 New/Learning の語では「語源」「覚えるコツ」を初期展開。metaphor 行のサマリ＝本文重複（340-344行）はサマリを先頭 20 字＋省略記号に変更。
- [ ] 受け入れ基準: (1) resilient で parts 3 件・全件 meaningJa あり・bridgeJa が矢印チェーン形式・cognates 2 件以上。(2) hypernyms/related しか持たない語でも MORE にネットワーク行が出る。(3) ネットワークの語をタップすると該当語の単語カードが開く。(4) 旧キャッシュ形式でも表示が崩れない。
- [ ] テスト方針: normalizeWordData 変換のユニットテスト。EtymologyBreakdown は surfaceIn=null 混在ケースのレンダリングテスト。gallery.fixtures.ts（77行の旧形式実例）を新形式に更新し、旧形式フィクスチャを互換テスト用に残す。

### C-3. コロケーションを「accept ＜提案＞」のヘッド形（型＋スロット）で提示する

**現状の問題**

- 型: `collocations: string[]`（src/types/domain.ts:420）。プロンプトは「Provide 1-3 meanings, 1-2 examples, and a few collocations.」（server/llm/schema.ts:570-571）のみで形式指定が一切ない。
- 表示: 生文字列をチップ表示するだけ（src/ui/wordcard/WordDetailCard.tsx:284-290）。「remain resilient」「a resilient system」のような具体例の羅列で、型（V+N / Adj+N）・スロットに入る語のカテゴリ・日本語訳が示されない。
- 一方、同じコードベース内に手本が既にある: 注釈パスの例示は「collocation "leverage + reputation" -> 目的語には活かせる資産（reputation / resources / network）が来る。」（schema.ts:459）とヘッド＋スロット充填語を実践しており、grammarPatterns も「depend on N」形式（schema.ts:586）。単語カード生成側だけが規約から取り残されている。
- 連携面: PASSAGE_SYSTEM は「collocationId = the collocation string taken from core.collocations」（schema.ts:316-323）と生文字列一致でリンクしており（src/types/domain.ts:170-173 `collocationId: string`）、構造化時に本文ハイライトとの対応が壊れる。

**あるべき姿**

コロケーション欄が「accept ＜提案・招待＞ — offer / invitation / proposal（〜を受け入れる）」のような行形式で並び、動詞なら目的語スロット、形容詞なら被修飾名詞スロットが〈 〉で見え、型が一目で分かる。日本語と発想が異なる組み合わせ（strong coffee = 濃いコーヒー）には「⚠日本語と発想が違う」バッジが付く（L1 非一致コロケーションは習得困難: Wolter & Gyllstad 2011。対照提示の有効性: Laufer & Girsai 2008）。定型連鎖は自然な英語談話の 50-58% を占め（Erman & Warren 2000）、チャンク単位の提示が流暢性の基盤になる（Pawley & Syder 1983）。

**改善の方向性**

構造体化一択である（文字列のまま書式だけ縛る案は、スロット例のチップ分割表示・L1 警告バッジ・将来のコロケーションカード出題が不可能）。collocationSpans との互換は、エントリに安定 id を持たせ、旧データはパターン文字列を id に流用するフォールバックで吸収する。

**実装計画**

- [ ] `src/types/domain.ts` — core.collocations を構造体化:

```typescript
export interface CollocationEntry {
  /** 安定 ID（kebab-case, e.g. "accept-proposal"）。collocationSpans が参照 */
  id: string;
  /** ヘッド＋スロット表記 (e.g. "accept ＜提案・招待＞", "＜経済が＞ recover") */
  pattern: string;
  type: 'V+N' | 'Adj+N' | 'N+of+N' | 'V+Prep' | 'Adv+V' | 'other';
  /** スロットに入る実例語 2-4 件 (e.g. ["offer","invitation","proposal"]) */
  slotExamples: string[];
  glossJa: string;
  exampleEn?: string;
  /** 日本語直訳と発想が異なる場合 true（対照バッジ表示） */
  l1Contrast: boolean;
}
```

- [ ] `server/llm/schema.ts` — WORD_DATA_JSON_SCHEMA の core.collocations を上記オブジェクト配列に変更し、WORD_SYSTEM（570-571行）へ以下を追記:

```text
- collocations: 3-6 entries of { "id", "pattern", "type", "slotExamples", "glossJa",
  "exampleEn", "l1Contrast" }. pattern shows the headword plus a slot in angle
  brackets naming the semantic category of the filler in Japanese, e.g.
  "accept ＜提案・招待＞" or "＜経済が＞ recover". slotExamples: 2-4 real high-frequency
  English fillers for that slot (offer / invitation / proposal). Only include
  combinations you are confident are standard high-frequency English — never invent
  fillers. Set l1Contrast true when the natural Japanese rendering differs from the
  literal word-for-word translation (e.g. strong coffee = 濃いコーヒー), and put the
  contrast into glossJa.
```

- [ ] `server/llm/schema.ts` — PASSAGE_SYSTEM（316-323行）の collocationId 指示を「collocationId = the "id" of the entry in core.collocations whose pattern the passage realizes」に変更。`server/llm/providers.ts` reanchorSpans（386-410行）と検証系の突合を id 照合＋旧文字列フォールバックに変更。
- [ ] `server/llm/providers.ts` — normalizeWordData に旧文字列 → `{id: slug(s), pattern: s, type: 'other', slotExamples: [], glossJa: '', l1Contrast: false}` の持ち上げを追加。
- [ ] `src/ui/wordcard/WordDetailCard.tsx` — チップ表示（284-290行）を行形式に変更: 1 行 =「**pattern**（type バッジ）— slotExamples チップ列 / glossJa」、l1Contrast=true なら警告バッジ。読解画面の ReadingGuideRail のコロケーションカードも同じ pattern 表記を使う。
- [ ] 受け入れ基準: (1) accept / decision / resilient で生成した全エントリが 〈 〉スロット付き pattern と 2 件以上の slotExamples を持つ。(2) 本文のコロケーション帯タップで該当エントリが単語カード内でハイライトされる（id 照合）。(3) 旧キャッシュの文字列コロケーションもチップではなく行形式で崩れず表示。
- [ ] テスト方針: normalizeWordData の持ち上げユニットテスト。reanchorSpans の id 照合＋旧文字列フォールバックのユニットテスト（旧 passage データを固定フィクスチャ化）。表示は l1Contrast / slotExamples 空のバリエーションでレンダリングテスト。

### C-4. 難構文の文に構文解説（文の読み方）を追加する

**現状の問題**

- 文単位の構文解説はデータにも UI にも存在しない。Sentence 型は tokens / translationJa / translationSpans のみ（src/types/domain.ts:145-153）、passage 出力スキーマにも構文項目がない（server/llm/schema.ts:80-107）。読解補助は和訳の表示/非表示だけ（src/ui/reading/SentenceTranslation.tsx:101-133）。
- 唯一の経路である noticeCues の grammar_pattern / sentence_structure も 20-45 字 1 短文に制限され（schema.ts:474）、しかも構文系 cue は生き残りにくい: アンカー解決の findRun がラン長 6 トークンまでしか探索しないため（server/llm/providers.ts:310）、節・文全体を指す anchorText は位置解決不能で cue ごと無音破棄される（providers.ts:806-808）。
- 不連続構造を表現できない: SpanRef は連続範囲のみ（src/types/domain.ts:156-160）で、プロンプト例自身が挙げる「no sooner ... than」（schema.ts:464）は verbatim 一致せず破棄される。memo.txt にも「間が飛んでいる関係性もあると思うので、ハイライト＋下線が良さそう」と要望済み。
- 難易度連携がない: PassageAnnotationRequest は sentences / level / targetSpans / collocationSpans のみ（src/types/domain.ts:522-527）で、生成側が readabilityLevel=advanced で意図的に関係詞節・分詞構文を入れても（schema.ts:307-311）注釈側はそれを知らず、EXTRA cue は文あたり 1-2 個の上限（schema.ts:487）の下で構文解説は必須化されない。
- 視覚設計: 構文系 2 カテゴリは語彙系と同じ青（COLLOCATION 群、src/ui/theme/tokens.ts:119,133）に縮約され、「読み方の気づき」が「語彙の気づき」に埋没する。

**あるべき姿**

advanced 設定で生成された倒置文に対し、右セル（または文下の展開パネル）に「構文ノート」が付く: 型名（倒置: 否定副詞句＋助動詞前置）、主語・述語の位置、各節の役割ラベル、読み下し順の矢印チェーン、そして「なぜ読み誤りやすいか」。本文側では no sooner と than の両方が同じバッジで結ばれてハイライトされる。B-3（+1 は語彙に限定し構文は i に固定するのが原則。ただし B-3 の方針でユーザが難構文を明示的に望む場合）で難構文を入れるなら、その分の読解支援を必ず対で提供する。これは精緻化（elaboration）による理解支援（Yano, Long & Ross 1994）の応用であり、CEFR-J / English Grammar Profile 系のレベル別構文リストで「どのレベルにどの構文注釈が要るか」を決められる。

**改善の方向性**

実装候補は (a) 生成パスの Sentence に構文情報を直接持たせる、(b) 注釈パスを拡張して `sentenceNotes` を出力させる、(c) 第 3 の専用パスを新設する。**(b) を推奨**: 注釈パスは既に全文トークンと CEFR level を受け取っており（schema.ts:549-556）、生成パスに載せると検証・再生成コスト（validator 再突合）が増える。(c) は LLM 呼び出しが 1 回増えレイテンシ・コスト面で不利。(b) なら generationOrchestrator の finalize（generationOrchestrator.ts:150-166）の 1 呼び出しに同居できる。

**実装計画**

- [ ] `src/types/domain.ts` — 構文ノート型を追加し Passage に持たせる:

```typescript
export interface SentenceChunk {
  tokenStart: number;
  tokenEnd: number; // half-open
  /** 主語 / 述語動詞 / 従属節（譲歩） / 挿入句 など */
  roleJa: string;
}
export interface SentenceSyntaxNote {
  sentenceIndex: number;
  /** 構文の型名 (e.g. "倒置（否定副詞句＋助動詞前置）") */
  patternNameJa: string;
  /** 文の組み立てと読み誤りポイントの説明（1-3 文） */
  structureJa: string;
  /** 読み下し順の矢印チェーン */
  readingJa: string;
  chunks: SentenceChunk[];
}
// Passage に syntaxNotes?: SentenceSyntaxNote[] を追加（旧データは undefined で有効）
```

- [ ] `src/types/domain.ts` — PassageAnnotationRequest（522-527行）に `readabilityLevel` と `hardSentenceIndexes?: number[]`（生成パスが意図的に難構文を入れた文。PASSAGE_SYSTEM に自己申告フィールドを追加して取得）を追加。`server/llm/schema.ts` buildAnnotationMessages（549-556行）の user メッセージに両者を出力。
- [ ] `server/llm/schema.ts` — ANNOTATION_SYSTEM に sentenceNotes 出力を追加（出力スキーマ・プロンプト双方）:

```text
SENTENCE STRUCTURE NOTES: besides noticeCues, output "sentenceNotes" — one entry for
EVERY sentence a CEFR ${level} reader would find hard to parse: long subordination,
inversion, participial clauses, cleft sentences, nested relatives, heavy noun phrases.
When readability is "advanced" you MUST cover every listed hard sentence. Each entry:
- sentenceIndex
- patternNameJa: short Japanese label of the construction (e.g. 「倒置（否定副詞句＋助動詞前置）」)
- structureJa: 1-3 Japanese sentences on how the sentence is built — where the main
  subject and verb are, what each clause does, and why the sentence is easy to misread.
- readingJa: the natural decoding order as an arrow chain over meaning chunks, pairing
  the English chunk with its Japanese sense (e.g. 「No sooner had the meeting started
  → 会議が始まるやいなや / than the alarm rang → 警報が鳴った」).
- chunks: [{ tokenStart, tokenEnd, roleJa }] labelling 主語 / 述語動詞 / 従属節 /
  挿入句 over that sentence's tokens (half-open ranges).
Do NOT add notes for plainly simple sentences.
```

- [ ] 不連続スパン対応: `src/types/domain.ts` — NoticeCue に `extraSpans?: SpanRef[]` を追加。ANNOTATION_SYSTEM に「If the expression is DISCONTINUOUS (e.g. "no sooner ... than", "not only ... but also", separated phrasal verbs), set anchorText to the FIRST contiguous part and add "anchorTextParts": every contiguous part copied verbatim, in order; the app highlights and links all parts with one badge.」を追記。`server/llm/providers.ts` anchorCues（801-825行）で各 part を順に locateAnchor し、解決分を extraSpans に格納（先頭 part が解決できれば cue を保持）。
- [ ] `server/llm/providers.ts` — findRun（306-317行）の 6 トークン上限を撤廃し、`anchorText` が文の renderText 全体と一致する場合は `[0, tokens.length)` を返す特別扱いを追加（探索は「rendered.length > target.length で break」の既存ガードで発散しない）。
- [ ] UI: `src/ui/reading/` に `SyntaxNotePanel` を新設。PassageRenderer のグリッド行で syntaxNote を持つ文の EN セルに「構文」トグルバッジを表示し、展開で patternNameJa / structureJa / readingJa ＋ chunks の役割ラベルを色付き下線で本文にオーバレイ。extraSpans を持つ cue は全パートを同一 hover/pin グループ（readingUiStore の Spotlight Link 流用、src/state/stores/readingUiStore.ts:34-58）で点灯。
- [ ] `src/ui/theme/tokens.ts` — grammar_pattern / sentence_structure（119,133行）を COLLOCATION 群から分離し、構文専用色（例: 紫系）を新設。Legend（src/ui/shared/Legend.tsx:36-62）に「読み方の気づき」凡例を追加。**D-2 の Legend 同期タスクと同一ファイルを触るため、D-2 と統合して 1 回の変更で実施する**。
- [ ] 受け入れ基準: (1) readabilityLevel=advanced で生成したパッセージの倒置・分詞構文・関係詞多重文すべてに syntaxNote が付く。(2) 「no sooner ... than」を含む文で両パートが同時ハイライトされる。(3) 7 トークン超の anchorText を持つ sentence_structure cue が破棄されない（破棄率をログで計測し、構文系 cue の生存率 90% 以上）。(4) 旧 passage（syntaxNotes なし）が従来どおり表示される。
- [ ] テスト方針: findRun の長尺一致・文全体一致ユニットテスト。anchorCues の anchorTextParts 解決テスト（不連続 2 パート・片側不一致ケース）。SyntaxNotePanel のレンダリングテスト。注釈プロンプトの実出力は advanced/basic 各 3 パッセージの手動評価シートで確認。

### C-5. Lexia 学習方針（ドラフト）の制定と、復習ループ実装の方針への整合

**現状の問題**

方針が明文化されていないことと、実装が設計意図から乖離していることが複合している。

1. **方針文書の不在**: FSRS-6 採用根拠・目標保持率 0.90 は文書化済み（.kiro/specs/english-vocabulary-learning/research.md:23-34, src/domain/srs/parameters.ts:42）だが、「文章生成 × 間隔反復」というアプリ固有ループの方針 — 受動再認の重み、復習語の文章再登場周期、日次負荷、想起の方向・形式 — を定めた文書はどこにもない。PASSIVE_RECALL_DECAY=0.5 等は「UNVALIDATED — estimate」（parameters.ts:60-79）のまま検証計画がない。
2. **読解が記憶モデルに反映されない**: 設計は「単語タップ(lookup)=Again、タップなし読了=減衰 Good」（design.md:412）だが、lookup シグナルは一切発火されない（applyRecallSignal の呼び出しは read_through のみ、src/ui/app/routes.tsx:769。タップは詳細カードを開くだけ、src/ui/reading/ReadingScreen.tsx:188-190）。「読了として記録」は全対象語へ一括減衰 Good（routes.tsx:763-780）。
3. **クールダウンの穴**: 「知らなかった」（source='review' の Again、routes.tsx:728-736）直後に読了を押すと、クールダウン判定が source='passage' しか見ないため（src/domain/srs/recallEventService.ts:43, src/infra/persistence/reviewLogRepository.ts:24-32）、10 分後 due が数時間先へ上書きされる。
4. **「due」定義の分裂**: 生成時に全対象語が dueAt=0 でシードされ（src/state/controllers/newState.ts:21, generationController.ts:119-120）、復習キューは dueBefore(now) 全件（src/domain/session/sessionPlanner.ts:84-91）なので未学習シード語が混入。一方ホームの件数は stability あり＋dueAt<endOfToday（src/domain/dashboard/dashboardProjector.ts:93-95）で、判定時刻も母集合も異なるため「今日の復習 8 語→開始すると 5 枚」等の不一致が恒常化。due 語が requested 数を満たすと新語提案も止まる（src/domain/suggestion/wordSuggestionService.ts:108）。
5. **復習セッションの制御手段の欠如と構造欠陥**: 評定のたび useLiveQuery が再発火し ReviewSession が再マウント（routes.tsx:992-1016）、進捗が壊れる。Again 語は dueAt=now+10 分でキューから消え、セッション内再出題されない。「解答を見る」前に評定できる（src/ui/review/ReviewSession.tsx:195-213 に reveal ガードなし。テストが未 reveal 評定を仕様として固定: ReviewSession.test.tsx:90-110）。Undo なし（評定前状態は保存されず ReviewLog は append-only、src/state/controllers/reviewController.ts:48, src/types/ports.ts:132-135）。枚数上限・分割・並び順制御・スキップ・条件別復習・開始前の枚数/所要時間見積りが皆無。完了時は即ホーム遷移でサマリなし（ReviewSession.tsx:100-104, routes.tsx:1028）、空キューでは「0 語を確認しました」（ReviewSession.tsx:73-84）。評定書き込みは fire-and-forget（routes.tsx:1018-1026）。
6. **復習素材が想起練習として弱い**: 毎回同じ WordData 固定例文（routes.tsx:969-976）、語形不一致時は無意味なダミー文（routes.tsx:274-276）。方向は EN→JA 受容のみ。
7. **既知語を外せない**: 学習シグナルは「知らなかった」(rating=1 固定) のみで、「知っている」申告・suspend・削除の手段が皆無（WordDetailCard.tsx:220-231, routes.tsx:1265-1273, src/types/domain.ts:72-92 に suspended フラグなし, src/types/ports.ts:117-124 に delete なし）。読了で全対象語が自動シードされるため（recallController.ts:38）、既知語がキューを占有し続ける。
8. **再織り込みの脱落**: due 語再織り込みは CEFR 帯フィルタ（wordSuggestionService.ts:46-50, 80行）で level 不明語・レベル差 2 以上の語が静かに落ち、「文脈で再遭遇して定着」の核ループから外れる。レビュー経由シード語は level を持たない（newState.ts:11-26）。
9. **フィードバック不全**: 読了ボタンは押しても無反応（トースト・完了表示・disabled なし、routes.tsx:944, ReadingScreen.tsx:362-366）。習熟ドットは 5 点固定で長期間 0 のまま（ReviewSession.tsx:56, 88-93）。

**あるべき姿**

学習者は 10-12 分の 1 セッションで「復習（想起）→ 新パッセージ読解 → 読了」を完結でき、読解中の単語タップは自動的に「まだ覚えていない」シグナルとして記録され、明示復習では必ず「思い出してから答えを見る」プロトコルが守られる。復習開始前には「今回 N 枚・目安 M 分」が提示され、見通しを持って始められる。ホームの数字とセッション枚数は常に一致し、数日空けても復習は上限枚数で区切られて再開障壁にならない。分からなかった語ほど早く（10 分ラダーで同セッション内に）再遭遇し、覚えた語は「知っている」と申告して即座にループから外せる。これら全ての挙動が 1 本の方針文書に根拠付きで定義され、実装・設計・定数がそこから参照される。

**改善の方向性**

まず方針文書を確定し（これが以後の実装判断の仕様になる）、次に「due 定義の一本化」→「復習セッション是正」→「読解シグナル配線」の順で実装を方針に合わせる。方針は以下のドラフトを `docs/learning-policy.md` として採用し、parameters.ts のコメントと .kiro/specs の design.md から参照する。

#### Lexia 学習方針（ドラフト） — docs/learning-policy.md 案

**基本原理（採用する学習科学の知見）**
1. **想起先行**: 復習は再読ではなく検索練習で行う。想起テストは再読より長期保持で優る（Roediger & Karpicke 2006; Karpicke & Roediger 2008; Dunlosky et al. 2013 は practice testing を有用性「高」、rereading を「低」と格付け）。UI は解答表示前の評定を禁止する。
2. **間隔反復は FSRS-6**: SM-2 比で同一保持率を 20-30% 少ない復習で達成（open-spaced-repetition ベンチマーク; 理論基盤は Wozniak & Gorzelanczyk 1994 の二成分記憶モデル）。分散効果は最頑健の記憶現象（Cepeda et al. 2006, 2008）。拡張間隔の本質は「遅延をおいた想起」自体である（Landauer & Bjork 1978; Karpicke & Roediger 2007）。
3. **偶発学習＋意図学習のハイブリッド**: 読解中の遭遇だけでは定着に 6-16 回以上の遭遇が必要で保持も弱い（Uchihara, Webb & Yanagisawa 2019 メタ分析 r=.34; Waring & Takaki 2003）。よって読解（meaning-focused input）と明示復習（language-focused learning）を役割分担させる（Nation の Four Strands, 2007/2013）。
4. **文脈は毎回変える**: 同一例文の再認は文脈ごと丸暗記になる。復習・再織り込みでは新文脈での再遭遇を優先する（符号化多様性; Involvement Load の evaluation 寄与最大: Laufer & Hulstijn 2001; Yanagisawa & Webb 2021）。
5. **受動再認を過大評価しない**: 読み流しは想起ではない。passage 由来クレジットは減衰付き・非昇格・クールダウン付きとし、昇格は明示レビュー成功のみ（現行 masteryProjector の原則を維持。Carpenter & Olson 2012 の過信問題）。
6. **+1 は語彙に限定**: 未知要素は対象新語に絞り、既知語率 ≥98% を守る（Hu & Nation 2000; Schmitt, Jiang & Grabe 2011）。難構文を導入する場合は構文解説（C-4）を対で付ける。
7. **負荷設計が継続を決める**: 復習バックログの雪だるまは離脱の主因。日次上限とセッション分割で「復帰初日が最も重い」逆インセンティブを排除する（習慣形成: Lally et al. 2010; 近接目標と自己効力感: Bandura & Schunk 1981; Locke & Latham 2002）。

**設定値（正準値。変更はこの文書の改訂を伴う。◎印は C-5a の CI 突合対象＝コード定数と一致必須）**

| 項目 | 値 | 根拠/備考 |
|---|---|---|
| ◎ desired retention | 0.90（設定範囲 0.80-0.95） | FSRS 標準。parameters.ts:42 |
| ◎ 初回表示ラダー | Again 10分 / Hard 1日 / Good 4日 / Easy 10日 | parameters.ts:53-58 を維持 |
| セッション内再学習 | Again/Hard 語はセッション末尾へ再挿入し 10 分ラダーを在セッション消化 | Landauer & Bjork 1978。実装: C-5c |
| ◎ 1 セッション上限 | 20 枚 | 負荷設計・原理 7。実装: C-5b（planReviewQueue） |
| ◎ 日次復習上限 | 60 枚（超過分は翌日に繰り越し。設定画面で 20-200 に変更可） | 原理 7。実装: C-5c（当日評定数を ReviewLog から集計） |
| ◎ 受動再認 | read_through = 減衰 Good（decay 0.5）、lookup = Again 相当。両者とも昇格なし・24h クールダウン（**全ソース横断**） | 原理 5。decay 0.5 は UNVALIDATED、較正対象。実装: C-5d |
| read_through 適用対象 | 「lookup / 知らなかった」が付かなかった語のみ | 二重計上防止。実装: C-5d |
| 再織り込み | stability が低い語を新規パッセージに優先再登場（目標: 定着まで文脈内再遭遇 3 回以上）。CEFR 帯フィルタは due 語には適用しない | 原理 3, 4。実装: C-5b |
| ◎ 新語導入 | 1 パッセージ 4-6 語（未知語密度 ≤2%）を **newWordRatio 既定値時の目安**とする。A-1-3 のスライダは 0〜100% を許容するが、実際の新語導入数は**日次新語上限 12 語でクランプ**する（A-1-3 と相互参照） | Hu & Nation 2000。実装: C-5b |
| 想起形式 | 当面 EN→JA 意味想起（解答表示ゲート必須）。段階 2 で文脈クローズ、段階 3 で JA→EN 産出を導入（段階 2 以降は CI 突合対象外） | Kang et al. 2007 |
| 復習例文 | 既出とは別の文脈を優先: 過去パッセージの別文 → 複数キャッシュ例文ローテーション → LLM 新文生成 → **最終フォールバックとして見出し語のみ提示**（ダミー文は全段で禁止） | 原理 4。実装: C-5c |
| ◎ leech | lapse 6 回以上で精緻化モード（語源分解・記憶フック生成へ誘導） | Atkinson & Raugh 1975; C-2 連携。実装: C-5c |
| 較正 | ReviewLog から実測保持率を四半期ごとに算出し、PASSIVE_RECALL_DECAY / クールダウン長を再推定 | parameters.ts の UNVALIDATED 注記を解消 |

**実装計画**

C-5a. 方針文書
- [ ] `docs/learning-policy.md` を上記ドラフトで新規作成（根拠文献リスト付き）。`src/domain/srs/parameters.ts` のヘッダコメントと `.kiro/specs/english-vocabulary-learning/design.md` の SRS 節から相互参照を張る。UNVALIDATED 定数（parameters.ts:60-79）に「較正手順: learning-policy.md §較正」と追記。
- [ ] `src/domain/srs/parameters.ts` に方針定数をエクスポート追加: `SESSION_REVIEW_LIMIT = 20`、`DAILY_REVIEW_LIMIT = 60`、`DAILY_NEW_WORD_LIMIT = 12`、`LEECH_LAPSE_THRESHOLD = 6`（C-5b/C-5c の実装タスクがこれらを参照する。定数の単一ソース化）。
- [ ] 受け入れ基準: 設定値表の ◎ 印項目（retention・初回ラダー・セッション上限 20・日次上限 60・新語上限 12・decay 0.5・24h クールダウン・leech 閾値 6）がすべて対応するコード定数と一致し、乖離があれば CI で検出できるよう文書内の値と定数を突合するテスト（docs 内の表をパースする軽量テスト、または定数から文書の表を生成）を追加。◎ なし項目（段階 2/3 と明記した想起形式等）は突合対象外と文書内に明記。
- [ ] テスト方針: 突合テストは `docs/learning-policy.md` の表の ◎ 行のみを対象にパースし、parameters.ts のエクスポート定数と照合するユニットテスト 1 本。

C-5b. 「due」定義の一本化と New 語の分離
- [ ] `src/state/controllers/newState.ts:21` — シード時の `dueAt: 0` をやめ、**A-1-2 と同一の `dueAt: now + DAY_MS`（86,400,000 ms）を採用する**（ロードマップ D1 の統合案。以前の Number.MAX_SAFE_INTEGER 案は破棄）。seeded / learning の判別は専用フラグを持たず **`stability === undefined` を seeded の判定条件**とする（src/types/domain.ts:79 の既存コメント「undefined ⇒ New」をそのまま正準化）。既存レコードの dueAt=0 補正を含む Dexie マイグレーションは **A-1-2 側の 1 回に集約**し、本タスクでは新規マイグレーションを追加しない。
- [ ] `src/domain/srs/` に共通述語 `isDueForReview(state, now)` を新設: **`stability !== undefined && dueAt <= now`**。seeded 語（stability 未定義）は dueAt の値にかかわらず復習対象外となる。`src/domain/session/sessionPlanner.ts:84-91` — planReviewQueue をこの述語＋dueAt 昇順＋上限 `SESSION_REVIEW_LIMIT`（20 枚）に変更。`src/domain/dashboard/dashboardProjector.ts:93-95` — dueTodayCount の判定を同一述語に統一。
- [ ] `src/domain/suggestion/wordSuggestionService.ts` — due 判定を同関数に統一し、シード語（stability 未定義かつ dueAt 到来）は「due」ではなく「継続導入枠」として別カウント。due 語充足による新語提案停止（108行）を「新語枠 N は常に確保」に変更。
- [ ] 日次新語上限: `src/state/controllers/generationController.ts` のシード処理で WordSchedulingState に `seededAt: number` を記録し（フィールド追加は A-1-2 の同一 Dexie マイグレーションに同居）、wordSuggestionService / generationController の新語数決定を `min(requested × newWordRatio, DAILY_NEW_WORD_LIMIT − 当日 seededAt 件数)` でクランプ。クランプ発動時は生成画面に「本日の新語上限（12 語）に達したため、この文章は復習語中心で生成」と表示（A-1-3 の newWordRatio スライダと相互参照 — スライダ値は 0〜100% 自由だが、この日次クランプが常に優先される）。
- [ ] `src/state/controllers/generationController.ts:107` 相当で、レビュー/「知らなかった」経由のシードにも必ず level を付与（wordSuggestionService.ts:46-50 の脱落原因を根絶）。あわせて fitsTargetLevel（46-50行）を「due 語には適用しない。level 不明語は除外しない」に変更。
- [ ] 受け入れ基準: (1) 生成直後に /review を開いても未読のシード語が出ない。(2) ホームの「今日の復習 N 語」と /review 開始時の総枚数が一致する（20 枚上限にかかる場合は「N 語中 20 語」を表示）。(3) 「知らなかった」でシードした語が期限到来時に次回生成の織り込み候補へ入る。(4) 当日の新語シード数が 12 に達したら以後の生成で新語が 0 になり、UI にクランプ理由が表示される。
- [ ] テスト方針: isDueForReview のユニットテスト（seeded＝stability 未定義/learning/期限前後）。sessionPlanner・dashboardProjector・wordSuggestionService が同一述語を使うことの統合テスト。日次新語クランプの境界テスト（当日 11 語シード済み＋requested 6 語 → 新語 1 語）。

C-5c. 復習セッションの是正（想起プロトコル・負荷制御・完了体験）
- [ ] 開始前確認画面: `src/ui/app/routes.tsx:987-1029` の ReviewRoute に、カード表示前の確認ステップを追加 —「今回 N 枚（全 due M 語中）・目安 T 分・[開始] ボタン」。T は `ceil(N × 15 秒 / 60)`（初期値 15 秒/枚。実測評定間隔の中央値が ReviewLog から取れるようになったらそれで置換）。「開始」を押すまでカードを表示しない。
- [ ] 日次復習上限: planReviewQueue の枚数を `min(SESSION_REVIEW_LIMIT, DAILY_REVIEW_LIMIT − 当日評定数)` に制限。当日評定数は `reviewLogRepository.since(userId, 当日 0 時)` の `source==='review'` 件数（src/infra/persistence/reviewLogRepository.ts:15-21 の既存 API で集計可。セッション内再挿入の 2 回目評定も 1 枚と数える簡便則）。上限到達時は確認画面で開始ボタンを無効化し「今日の上限 60 枚に到達。明日は N 語」を表示。上限値は設定画面で 20-200 に変更可能とし、既定 60 は parameters.ts の `DAILY_REVIEW_LIMIT` を単一ソースとする。
- [ ] `src/ui/app/routes.tsx:987-1029` — キューをセッション開始時（確認画面の「開始」押下時）に一度だけスナップショットし（useLiveQuery 購読をやめ useEffect 一回取得、または取得後 ref に凍結）、評定中の再マウントを根絶。進捗は「評定済み / 開始時総数」。
- [ ] `src/ui/review/ReviewSession.tsx` — (1) 評定ボタンを `disabled={!revealed}` にし、rate() に reveal ガードを追加。既存テスト（ReviewSession.test.tsx:90-110）を「未 reveal では評定不可」を検証する内容に反転。(2) Again/Hard 評定語をセッション内キュー末尾へ再挿入し、Good 以上が付くまでセッションを終えない（上限 2 周）。(3) 「1 つ戻る」Undo: 評定前の WordSchedulingState を直近 1 件保持し、Undo で upsert 復元＋ReviewLog に相殺エントリ（`source:'undo'`）を append（append-only を維持）。(4) スキップボタンと「ここまでで終了」ボタンを追加。
- [ ] leech 検出: 評定確定時に `lapses`（src/types/domain.ts:82）が `LEECH_LAPSE_THRESHOLD`（6）以上になった語へ leech マークを付け、完了画面に「覚えにくい語 N 件 — 語源と記憶フックで覚え直す」導線を表示。タップで該当語の単語カードを「語源」「覚えるコツ」展開状態（C-2 の MoreRow defaultOpen props）で開く。
- [ ] 条件別復習（最小実装）: `/review?words=w1,w2,...` クエリを ReviewRoute で解釈し、キューを指定語のみに絞る（上限・due 判定は通常と同一）。起動導線は A-3-2 の単語帳選択モードに「選択語を復習」ボタンとして追加する（受け側クエリ解釈は本タスクで先行実装可、導線接続は A-3-2 実装後）。「苦手のみ」「特定文章由来のみ」等の高度なフィルタは**段階 2 としてスコープ外**とする — まず語指定 1 種で条件別復習の利用実態を確認してからフィルタ軸を増やすため。
- [ ] 完了画面: 評定内訳（Again/Hard/Good/Easy 件数）、定着へ進んだ語、Again 語リスト、leech 語導線を表示し、次アクション 3 択 —「Again 語をもう一度（10 分ラダー消化）」「この語群で文章を生成（/generate へ語プリセット）」「ホームへ」— を提示。空キュー時は「復習対象はまだない。まず文章を読もう」＋生成 CTA と「次の復習は明日 N 語」を表示（ReviewSession.tsx:73-84 の 0 語完了表示を置換）。
- [ ] 評定永続化: routes.tsx:1018-1026 の fire-and-forget をやめ、書き込みキュー＋失敗時リトライ＋バナー通知にする。
- [ ] 復習素材: reviewItemFromState（routes.tsx:969-985）を方針表と同一の優先順「その語が登場した過去パッセージの別文（Dexie の passage から検索）→ WordData 複数例文ローテーション → **LLM 新文生成**（レビュー用単文の軽量プロンプトを server/llm に追加。失敗時は次段へ）→ **見出し語のみ（最終フォールバック）**」に変更し、ダミー文（routes.tsx:274-276）を削除。
- [ ] 習熟ドット: ReviewSession.tsx:56, 88-93 の「5 − 残回数」をやめ、「定着まであと N 回」テキスト＋ S の対数進捗バーに置換。
- [ ] 受け入れ基準: (1) 評定してもスケルトンが挟まらず進捗バーが単調増加。(2) 未 reveal では評定ボタンが押せない。(3) Again 語が同セッション内で再出題される。(4) 完了画面に統計と 3 つの次アクションが出る。(5) 空キューで「0 語を確認しました」が出ない。(6) 開始前確認画面に枚数と目安時間が表示され、「開始」を押すまでカードが出ない。(7) 当日 60 枚評定済みの状態では開始ボタンが無効化され翌日枚数が表示される。(8) lapses が 6 に達した語が完了画面の leech 導線に現れる。(9) `/review?words=` 指定時はその語だけが出題される。
- [ ] テスト方針: ReviewSession の状態機械（reveal→rate→再挿入→完了）のコンポーネントテスト。Undo の scheduling 復元ユニットテスト。ReviewRoute のスナップショット化は「評定後に再マウントされない」ことを testing-library の key 同一性で検証。日次上限の境界テスト（当日 59 枚評定済み → 1 枚だけ出題）。leech 閾値の境界テスト（lapses 5→6）。words クエリのフィルタリングテスト。

C-5d. 読解シグナルの配線と読了体験
- [ ] `src/ui/reading/ReadingScreen.tsx:188-190` — 単語詳細カードを開いたタイミングで `applyRecallSignal(wordId, {kind:'lookup'})` を発火（design.md:412, 438 の実装完遂）。同一語の連続タップは 24h クールダウンで 1 回に丸める。
- [ ] `src/domain/srs/recallEventService.ts:43` — クールダウン判定を「直近の**任意ソース**の scheduling 更新」に変更（reviewLogRepository.ts:24-32 の source フィルタを外した `lastUpdate` を追加）。これで「知らなかった」→読了の 10 分ステップ上書きが消える。
- [ ] `src/ui/app/routes.tsx:763-780` — completeReading の read_through 適用対象から、同セッション内で lookup / Again が付いた語を除外。
- [ ] 読了フィードバック: 押下中 disabled＋完了後は「読了済み ✓（N 語にクレジット、うち M 語は要復習）」にボタンを固定表示し、「復習へ」「次の文章を生成」への導線を出す。sessionStore.status（src/state/stores/sessionStore.ts:77-79）を ReadingScreen で購読する。
- [ ] 既知語申告: `src/types/domain.ts:72-92` WordSchedulingState に `suspended?: boolean` を追加し、WordDetailCard（220-231行の「知らなかった」の隣）と単語帳行に「もう覚えた（復習から外す）」を追加。suspended 語は isDueForReview・wordSuggestionService・シード（recallController.ts:38）から除外。単語帳にサスペンド一覧と復帰操作を用意。
- [ ] 受け入れ基準: (1) 読解中に単語カードを開いた語は読了時に Good クレジットを受けない。(2) 「知らなかった」→読了の順でも dueAt が 10 分のまま。(3) 読了ボタンが押下後に完了状態表示になり再押下できない。(4) 「もう覚えた」を押した語が復習キュー・提案・自動シードから消える。
- [ ] テスト方針: recallEventService のクールダウン横断判定ユニットテスト（review→passage、passage→passage、lookup 連打）。completeReading の除外ロジックのコントローラテスト。suspended の各出口（キュー/提案/シード）除外の統合テスト。

### 優先度と依存関係

| 優先度 | 項目 | 理由 |
|---|---|---|
| **P0** | C-5a（方針文書）→ C-5b（due 一本化）→ C-5c（復習セッション是正） | 学習ループの根幹が壊れており（再マウント・キュー汚染・想起プロトコル不全）、他のすべての「解説強化」の効果が復習で回収されない。C-5a は以後の実装判断の仕様となるため最初に確定する |
| **P0** | C-5d(読解シグナル配線) | C-5b の isDueForReview / suspended と同じ型・リポジトリを触るため C-5b 直後に連続実施 |
| **P1** | C-1 + C-2 + C-3（WordData スキーマ拡張として一括実施） | 三者は同一ファイル群（domain.ts の WordData、schema.ts の WORD_SYSTEM / WORD_DATA_JSON_SCHEMA、providers.ts の normalizeWordData、WordDetailCard.tsx）を変更するため、別々にやると 3 回のスキーマ移行と互換変換が発生する。**必ず 1 マイルストーンで実施**し、テーマ E-3（WordData キャッシュ恒久化）と同時にキャッシュキー/バージョンを設計する |
| **P2** | C-4（構文解説） | 注釈パス拡張として独立実施可能。ただし detailJa フィールド追加（C-1 の注釈側変更）と同じ ANNOTATION_SYSTEM・NoticeCue を触るため、C-1 の注釈側タスクと同時に着手するのが効率的。また B-3（難易度実態の確認）の結論（advanced で実際に難構文が出るか）を前提入力とする |

依存の要点: (1) C-5b の `isDueForReview` と `suspended` は C-5c/C-5d の前提。(2) C-5b のシード dueAt 変更（newState.ts:21）と `seededAt` 追加は **A-1-2 の Dexie マイグレーション 1 回に集約**して同時実施する — 同一箇所への変更を二度に分けない。(3) C-5c の「選択語を復習」導線は A-3-2 の単語帳選択モードに依存する（/review?words= の受け側は独立実装可）。(4) C-1/C-2/C-3 の構造体化は E-3 のキャッシュ設計（スキーマバージョン付与）と相互依存 — 先にキャッシュを恒久化すると旧形式データが増えるため、**スキーマ拡張を先、キャッシュ恒久化を後**にする。(5) C-4 の sentenceNotes は C-1 の detailJa と同一プロンプト・同一スキーマ変更に相乗りでき、C-4 の凡例変更（src/ui/shared/Legend.tsx）は D-2 の Legend 同期タスクと統合実施する。(6) C-3 の collocationId 安定化は B-1/B-2（生成品質・定型表現の織り込み強化）でコロケーション使用を増やす前に済ませると、本文ハイライト互換の手戻りがない。

---

## テーマD: レイアウト・操作性

本セクションはユーザ要望 D-1〜D-5 に加え、学習者視点レビューで検証済みとなった追加問題（モバイル/中間幅の破綻、待ち時間フィードバック、モーダル/コントラスト等のアクセシビリティ基盤）を D-6〜D-8 として扱う。読解画面右レールの「崩れ」は単一のバグではなく、(1) 座標系の不一致、(2) カード内部 CSS の破綻、(3) 高さ再計測の欠落、(4) 幅制約の欠如、(5) 情報過密という 5 つの構造的原因の複合であることをコードで特定した。

### D-1: 右レール（学習ガイド）のレイアウト崩れ

1. **現状の問題** — 崩れの構造的原因は次の 5 点である。

   **(a) 行アンカーの座標系不一致（最重要・行揃え機能が実質死んでいる）**: `useLineAnchors` はアンカー Y 座標を「プローズラッパー div 相対」で測る（`node.getBoundingClientRect().top - containerTop`、src/ui/reading/useLineAnchors.ts:51-61）。この `containerRef` は PassageRenderer だけを包む div に付く（src/ui/reading/ReadingScreen.tsx:301）。一方カードを `position:absolute` で置くコンテナは `aside.reading-rail`（ReadingScreen.tsx:372-375、padding 30px 26px）内の見出し 2 行直下にあり（src/ui/reading/ReadingGuideRail.tsx:536-550）、`placeGuideItems` は anchor.top を無補正で使う（ReadingGuideRail.tsx:223-242, 518）。プローズラッパーの上にはツールバー（ReadingScreen.tsx:234）・タイトル h1（256）・イラスト figure（260-298、aspectRatio 3/2・maxHeight 420）・main の padding 46px（227）が積まれるため、両コンテナの原点差 ≈500-600px の分だけ全カードが本文該当行より上（実質レール先頭寄せ）にずれる。e2e スナップショット `e2e/visual.spec.ts-snapshots/reading-grid-desktop-chromium-linux.png` でも第 1 文（y≈649）の語のカードがレール最上部（y≈95）に描かれている。さらにイラストはプローズラッパーの外にあるため、その読込による位置変動は ResizeObserver（useLineAnchors.ts:99-100、監視対象はプローズラッパーのみ）では検知されない。

   **(b) 吸収 notice 行の grid 破綻**: `absorbedNoticeStyle` が `gridTemplateColumns: 'auto minmax(0, .9fr)'` の 2 カラム grid で（ReadingGuideRail.tsx:679-693）、子は英語表現・カテゴリチップ・日本語解説の 3 span（同 383-385）。自動配置で解説が col1 の 2 行目に落ち、チップは圧縮されて CJK ラベルが 1 文字ずつ縦落ち、短い内容では stretch でチップ背景が間延びする。スナップショットでは英語表現 'closed the deal' が幅約 66px に押し込まれ不自然に折り返している。

   **(c) 高さ再計測の欠落**: 実測高さの `useLayoutEffect` は deps が `[aligned, builtGuide]` のみ（ReadingGuideRail.tsx:503-516）。ウィンドウリサイズでレール幅が変わりカードが伸びても heights は更新されず、`placeGuideItems` は旧高さ（`heights[item.id] ?? estimatedHeight`、同 239）で押し下げ量を計算するためカードの重なり・不揃いな隙間が発生する。初回描画も heights={} で当て推量（同 218-221）配置となり 1 フレーム重なる。

   **(d) 幅制約の欠如**: 広幅時 main:rail = 3:1（ReadingScreen.tsx:227, 372-375）でレール内容幅は 1025px 時 ≈204px。ヘッダは番号丸 21px + ボタン列 `flex:'none'`（▶28px + 「知らなかった」minWidth 86、ReadingGuideRail.tsx:320-355, 733-756）が約 120px を常時確保し、語ラベル（同 324）に overflow-wrap がないため 1025〜1250px でテキストがボタン下へはみ出す。miniチップ（652-662）には maxWidth がなく、routes.tsx:753 で collocations[0] の英語フレーズ全文が流し込まれ多段に潰れる。さらに 601〜1024px の中間帯（iPhone 横持ち・iPad 縦）は CSS のモバイル規則が ≤600px のみ（src/ui/theme/global.css:113, 175-177, 206-211）で JS の narrow 判定は ≤1024px（src/ui/reading/useIsNarrow.ts:19）という不一致により、レールが幅 34.5%（601px 直上で内容幅 ≈155px）の狭列に残ったまま横並びとなり確実に破綻する。

   **(e) 情報過密**: カード高（STUDY_WORD_MIN_HEIGHT=118 / NOTICE_MIN_HEIGHT=94、ReadingGuideRail.tsx:18-21）が本文行高 ≈37px（PassageRenderer.tsx:35, 94）の 3 倍あり、`placeGuideItems` の衝突回避が押し下げを累積させて 2 項目目以降の行対応が崩壊する。生成側は「各学習語＋各コロケーションに必須 cue、追加は文あたり 1-2 個」（server/llm/schema.ts:480-487、545-551 の "exhaustively"）のため 300 語で 30 枚超になり得るうえ、全カード常時全展開・折りたたみなし（ReadingGuideRail.tsx:551-585）、未エンリッチ語は語名だけの空カード（同 114-120）まで並ぶ。モバイル（≤600px）ではレール全体が本文の後ろに一括表示され、気づきバッジをタップすると本文最下部のレールへ scrollIntoView でテレポートし読書位置を失う（PassageRenderer.tsx:186-193, 238）。

2. **あるべき姿** — 広幅では各カードが対応する本文行の真横 ±1 行以内に置かれ、視線の水平移動だけで本文と解説が対応する。カードは既定 1〜2 行のコンパクト表示（番号・語/表現・一言）で、クリックで展開する。どの幅でもテキスト・チップがカード外へはみ出さない。リサイズ・イラスト読込・タイトル折返しでも配置が追随する。601〜1024px では無理な 2 カラムをやめ、モバイルではバッジタップでその場に解説ポップオーバーが開き、スクロール位置を失わない。

3. **改善の方向性** — 座標系は「(A) 共通祖先（`.reading-layout`）基準で測り、レール側が自身の原点差を減算する」案と「(B) レール側にプローズラッパーと同じ Y までのスペーサーを入れる」案がある。B はタイトル折返し・イラスト読込のたびにスペーサー高を再計算する必要があり事実上 A と同じ計測を別の形でやるだけなので、**A を推奨**する。密度問題は「(A) UI 側でコンパクト化（既定折りたたみ）」と「(B) プロンプトで cue 数に上限」があるが、cue データはテーマ C の解説強化にも使う資産なので**生成は網羅のまま UI 側コンパクト化を主とし、プロンプト上限は保険として弱く併用**する。中間帯は CSS ブレークポイントを JS の 1024px に統一し、≤1024px はレール下回し＋コンパクト化で対応する。

4. **実装計画**

   - [ ] **座標系統一**: `useLineAnchors` に `frameRef`（`.reading-layout` の div、ReadingScreen.tsx:224）を追加し、anchor.top を frame 基準に変更する（useLineAnchors.ts:54 の `containerTop` を frame の rect.top に差し替え。`containerRef` は `querySelectorAll` のスコープとして維持）。`ReadingGuideRail` の絶対配置コンテナ（536-550 の div）に ref を張り、`railOriginTop = railRect.top - frameRect.top` を計測して `placeGuideItems` へ `anchor.top - railOriginTop` を渡す。
   - [ ] **再計測トリガー拡充**: ResizeObserver を frame と rail コンテナにも張り、イラスト `img` の `onLoad`（ReadingScreen.tsx:263）でも `scheduleMeasure` を呼ぶ。各ガイドカードにも ResizeObserver（または `useLayoutEffect` deps にレール幅を追加）を張り、heights を常に実測で更新する。初回は同一フレーム内で measure→place を済ませる。
   - [ ] **grid 廃止**: `absorbedNoticeStyle`（679-693）を `display:flex; flex-wrap:wrap` に変更し、1 行目 = カテゴリチップ（`whiteSpace:nowrap; width:fit-content`）＋英語表現（`minWidth:0; overflowWrap:anywhere`）、2 行目 = 解説（`width:100%`）とする。
   - [ ] **幅制約**: `aside.reading-rail`（ReadingScreen.tsx:374）に `minWidth: 280` を追加。語ラベル（ReadingGuideRail.tsx:324）と全チップに `overflowWrap:'anywhere'`、miniチップに `maxWidth:'100%'` を設定。ヘッダ（320）に `flexWrap:'wrap'` を許可し幅不足時はボタン列を 2 段目へ落とす。コロケーションチップは C-3 のヘッド形短縮表示（例 `close ＜deal＞`）と連動して短文化する。
   - [ ] **コンパクトカード化**: 既定表示を「番号丸＋語/表現＋一言（意味の第一義 or カテゴリラベル）」の 1 行（高さ ≈44px）にし、カードクリックで展開（意味・チップ・記憶タグ・吸収 notice・ボタン群）。単語詳細カードは展開内の「解説を開く ›」ボタンに割り当てる（D-2 の操作割当てに従う）。未エンリッチ語はスケルトン 1 行のみ表示し空カードを出さない。
   - [ ] **ブレークポイント統一**: global.css のレール下回し規則（206-211）とレイアウト column 化（175-177）を `@media (max-width: 1024px)` に拡大し、`useIsNarrow`（1024px）と一致させる。
   - [ ] **モバイルその場表示**: `PassageRenderer` の `pin()`（186-193）に isNarrow を渡し、≤1024px では scrollIntoView せずバッジ直下にポップオーバー（`cue.explanationJa`＋カテゴリチップ＋閉じるボタン）をインライン描画する `InlineNoticePopover` を新設する。
   - [ ] **（保険）cue 密度プロンプト**: server/llm/schema.ts:545-551 の "exhaustively" 指示に上限を追記する。文面案:

     > Annotation budget: beyond the mandatory cues (one per study word and one per collocation of a study word), add a standalone noticeCue ONLY where it teaches something a learner at the target CEFR level would plausibly miss. Hard caps: at most ONE standalone cue per sentence, and at most ceil(wordCount / 40) standalone cues per passage. When candidates compete, prefer (1) idioms and set phrases, (2) collocations, (3) register or connotation notes, in that order. Never annotate expressions that are transparent at the target level.

   - **受け入れ基準**: 1280px・イラストあり・タイトル 2 行の文章で、各カード top と対応バッジの Y 差 ≤12px（Playwright で boundingBox 比較）。1025〜1250px と 768px でカード内テキスト・チップのはみ出しゼロ（スナップショット更新＋`scrollWidth <= clientWidth` 検査）。ウィンドウを 1600→1100px にリサイズ後、全カードで `top_i + height_i + 12 <= top_{i+1}`。モバイルでバッジタップ後の `window.scrollY` 変化 ≤50px。
   - **テスト方針**: `placeGuideItems` に「railOrigin 補正」「実測高さ反映」の unit テストを追加（ReadingGuideRail.test.tsx:108-126 の既存パターンを拡張）。Playwright に「行揃え精度」「リサイズ後の非重なり」「モバイルポップオーバー」の 3 シナリオを追加し、既存 visual スナップショットを更新する。

### D-2: クリック可能要素の視覚言語の定義と適用

1. **現状の問題** — 右レールでは (a) カード全体が `role=button` なのに `guideCardStyle` に cursor 指定がなく（ReadingGuideRail.tsx:590-598）、吸収 notice を持たない study カードは hover ガード（同 293-295）と active 判定（551-555）が notice 経由のみのためフィードバックが皆無。旧実装にあった `cursor:'pointer'`・`title` は統合時に失われた（NoticeRail.tsx:114, 118-120 / StudyWordsList.tsx:110 からの退行）。(b) クリック可能な吸収 notice ボタン（371-387、absorbedNoticeStyle 679-693）と非クリックの再登場ノート（reappearNoteStyle 758-768）がほぼ同一スタイルで、非インタラクティブな「学習語句」バッジ（621-629）・miniチップ（652-662）は押せそうなピル形状。(c) `role=button` のカード内にボタンがネストされ、内側ボタン（331-353, 371-387, 459-471）は click のみ `stopPropagation`（stopAndRun 263-266）で keydown を止めないため、Enter が親の `preventDefault`（311-317, 442-447）に横取りされ発音再生・「知らなかった」・ジャンプがキーボードで実行できない（旧 NoticeRail.tsx:182 の `onKeyDown stopPropagation` が欠落した退行。button-in-button は WAI-ARIA 違反）。(d) 凡例（src/ui/shared/Legend.tsx:36-62）は下線 3 種＋コロケーション＋青一色の丸数字しか説明せず、実物のカテゴリ 4 色バッジ（PassageRenderer.tsx:247、tokens.ts:116-134）・常時淡塗り（PassageRenderer.tsx:161-166、tokens.ts:176）・学習語句バッジ（PassageRenderer.tsx:304）と不一致。なお global.css には `:hover` ルールが 1 件もない。

2. **あるべき姿** — 画面のどこでも「押せるものは押せる見た目、押せないものは押せない見た目」が一貫する。カードにポインタを載せた瞬間に背景が変わり、本文側の対応語が点灯して双方向対応が分かる。何が起きるか（解説を開く/本文へジャンプ）がアイコンとラベルで事前に予測でき、キーボードでも全操作が完結する。凡例を見れば本文中の全 6 系統の色の意味が分かる。

3. **改善の方向性** — インラインスタイルでは `:hover`/`:focus-visible` を表現できないため、**global.css にインタラクティブ用共通クラスを定義して全画面で使い回す**方式を採る（コンポーネントごとの `useState` hover 管理は漏れが再発するため不採用）。視覚言語は次の 5 規則に固定する:
   - **R1**: クリック可能要素は `cursor:pointer` + hover 背景 `colors.surfaceHover`（新トークン、#EEF3F9）+ `:focus-visible` に 2px `colors.primary` アウトライン + `transition: background .12s`。
   - **R2**: 「詳細を開く」系は見出し語を `colors.primary` のリンク色にし、右端に chevron `›` を常設。
   - **R3**: 「本文へジャンプ」系は `⌖` アイコン＋`title="本文の該当箇所へ移動"` を付ける。
   - **R4**: ピル/チップ形状はインタラクティブ要素専用。非クリック情報（register・connotation・コロケーション・再登場ノート）は背景/枠なしのプレーンテキスト＋ラベルプレフィックス（例「コロケ: close ＜deal＞」）に降格する。
   - **R5**: 破壊的でない操作は 1 クリック、記録系操作は実行後フィードバック必須（D-8 と連動）。

4. **実装計画**

   - [ ] `src/ui/theme/tokens.ts` に `colors.surfaceHover: '#EEF3F9'` を追加し、`src/ui/theme/global.css` に `.interactive-card`・`.interactive-row`・`.interactive-chip`（R1 の hover/focus-visible/transition/cursor）を定義する。
   - [ ] ReadingGuideRail: `guideCardStyle` に `cursor:'pointer'` を追加し `.interactive-card` を付与。study カードの hover ガード（293-295）を撤廃し、notice の有無に関わらず `wordAnchorIdByKey` 経由で本文語スパンを spotlight する。カード右上に「解説 ›」ラベル（R2）を常設。吸収 notice ボタンに `⌖`＋title（R3）。再登場ノート・記憶タグ・miniチップは R4 に従いプレーン化（miniチップの絞り込みは C-3 のヘッド形表記と同時に実施）。
   - [ ] キーボード修正（最小修正を先行）: `stopAndRun` を keydown にも適用し、内側全ボタン（331-353, 371-387, 459-471）に `onKeyDown={(e) => e.stopPropagation()}` を追加する。第 2 段階で card の `role=button` を廃止し、見出し語 `<button>`＋内側ボタンの平坦な DOM に再構成して WAI-ARIA 違反を解消する（各ボタンに aria-label 付与）。
   - [ ] Legend 同期: src/ui/shared/Legend.tsx を実表示と同期し、(1) カテゴリ 4 色群（CONNOTATION 緑 / COLLOCATION 青 / REGISTER 灰 / IDIOM テラコッタ、tokens.ts:116-134）の淡塗り＋丸数字サンプル、(2) 学習語句バッジ（primary 青）、(3) 和訳側の新出下線、を追加する。Legend.tsx:53 の青一色サンプルを削除する。
   - [ ] 同一規則を単語帳行（WordbookScreen.tsx:185-195）・文章一覧行（LibraryScreen.tsx:110-122）・ホーム due 行（D-5）にも適用する。
   - **受け入れ基準**: `role=button`/`<button>` 要素の 100% が cursor:pointer と可視 hover を持つ（Playwright で全 role=button を hover し computed style 検査）。内側ボタンへフォーカスして Enter を押すと当該ボタンのアクションのみ発火し親カードのアクションは発火しない。axe の `nested-interactive` 違反ゼロ（第 2 段階完了時）。
   - **テスト方針**: testing-library で「知らなかった」ボタン Enter → `onMarkUnknown` 発火・`onSelectWord` 非発火を検証。Legend はカテゴリ 4 色の存在をスナップショットで固定。Playwright に @axe-core を導入し読解画面を検査する。

### D-3: 単語帳ページのレイアウト改善

1. **現状の問題** — (a) 一覧は単一フラットリスト（行 = ドット＋見出し語＋第一義＋要復習バッジ＋ステージ名、src/ui/wordbook/WordbookScreen.tsx:107-135）で、並び順は Dexie 主キー `[userId+wordId]` の偶然の ABC 順（src/ui/app/container.ts:125）。ソート UI・グルーピングはない。(b) 射影（src/ui/app/routes.tsx:1036-1051）は `dueAt` を boolean「要復習」に潰し（1048）、次回復習日・stability・出現回数を捨てる — FSRS が保持する学習データが UI にほぼ出ない透明性問題（WordDetailCard もステージバッジのみ、src/ui/wordcard/WordDetailCard.tsx:213-219、routes.tsx:1240-1243）と同根。(c) フィルタチップ（WordbookScreen.tsx:39-46）に件数バッジがない。(d) `useLiveQuery(...) ?? []` により初回ロード中に「該当する単語がありません」「全 0 語」がフラッシュ表示される（routes.tsx:1036-1051。LibraryRoute の `if (!passages) return <ScreenSkeleton />`、routes.tsx:1073 と非対称）。(e) 行 hover/focus のフィードバックがなく（rowStyle 185-195 は cursor のみ、global.css に :hover ゼロ）、詳細ダイアログ（138-149）に aria-modal・Escape・フォーカストラップがない。(f) 全行を無条件レンダリングし仮想化がない（113）。

2. **あるべき姿** — 開いた瞬間にスケルトンが出て 0 語フラッシュがない。学習者は「期限が近い順」に並べ替えて今日やるべき語を上から確認でき、各行に次回復習日（「今日」「明日」「7/12」）と意味（最大 2 義）が見える。単語カードを開けば「次回復習: 明日」「定着まであと 3 回」が読め、自分の記憶状態がシステムにどう見えているか分かる。フィルタチップの件数で自分の語彙の内訳（未学習 12 / 学習中 34…）が一目で分かる。行はホバーで反応し、Enter で詳細が開き Esc で閉じる。

3. **改善の方向性** — レイアウトは「ステージ別セクション」案と「ソート切替付き単一リスト」案を比較し、**ソート切替付き単一リスト＋フィルタ件数バッジを推奨**する（ステージはフィルタチップで既に絞り込めるため、セクション分割は期限順ソートと両立しない）。習熟度データの透明性は「一覧行（dueAt の相対表示）」と「単語カード（次回復習日＋残り回数）」の 2 層で露出し、復習履歴・負荷予測はダッシュボード側（F-9）に集約する。仮想化は語彙 1000 語規模までは `content-visibility: auto` で十分であり、react-window 等の導入は見送る。

4. **実装計画**

   - [ ] routes.tsx の WordbookRoute: `useLiveQuery` が未解決（undefined）の間は `<ScreenSkeleton />` を返す。`WordbookEntry` を拡張し `dueAt: number`・`stability?: number`・`glosses: string[]`（meaningsJa 上位 2 件）を追加する（1040-1050 の射影変更。boolean `due` は互換のため残置可）。
   - [ ] WordbookScreen: ソートセレクト（`abc` / `dueAsc`（期限が近い順・既定） / `stabilityAsc`（記憶が弱い順））を検索欄横に追加し、選択値を URL クエリ `?sort=` に保存する。各行右側に `dueAt` の相対表示（DashboardScreen.tsx:63-69 の `dueLabel` を共通化して再利用）を追加。gloss は 2 義まで `・` 区切り＋`textOverflow:ellipsis`。
   - [ ] **WordDetailCard への習熟度データ表示**: `WordDetailRoute` の scheduling 射影（routes.tsx:1240-1243、現状は stage のみ）を拡張し、`dueAt`・`stability`・`reps` を含む `scheduling` prop を WordDetailCard へ渡す。WordDetailCard のステージバッジ直下（src/ui/wordcard/WordDetailCard.tsx:213-219）に「次回復習: 明日」（共通化した `dueLabel` を再利用）と「定着まであと N 回」（C-5c の対数進捗バーと同一コンポーネントを埋め込み。C-5c 未完了の間はテキストのみ先行表示）を追加する。scheduling レコードのない未学習語では両表示とも出さない。
   - [ ] フィルタチップに件数バッジ（`words` から stage 別/由来別に集計、FILTERS 描画 84-103 を拡張）。
   - [ ] 行に `.interactive-row`（D-2）を付与。listCard 内の行に `content-visibility:auto; contain-intrinsic-size: 44px` を設定する。
   - [ ] 詳細オーバーレイ（138-149）を D-8 の共通 `ModalOverlay` に置換（aria-modal・Escape・フォーカストラップ・スクロールロック）。
   - [ ] **スコープ移管の明示**: 習熟度透明性のうち復習履歴（ReviewLog の時系列表示）と負荷予測（今後の due 件数見通し）は、単語帳一覧・単語カードには載せず F-9 の `/dashboard` ルート到達可能化タスクへ表示要件として移管する。移管する要件は「直近 10 件の ReviewLog リスト（日時・語・rating）」と「今後 7 日間の日別 due 件数ミニバーチャート（`schedulingRepository.dueBefore` の日別集計）」の 2 点。F-9 側の受け入れ基準にこの 2 表示を含めること。
   - **受け入れ基準**: リロード直後に「全 0 語」「該当する単語がありません」が 1 フレームも表示されない（Playwright で `wordbook-total` の初回出現値を検査）。ソート `dueAsc` で dueAt 昇順に並ぶ。学習済み語（scheduling レコードあり）の WordDetailCard に次回復習日と「定着まであと N 回」が表示され、未学習語では表示されない。1000 語ダミーデータでスクロールが 60fps（Playwright trace で確認）。Esc でダイアログが閉じる。
   - **テスト方針**: 射影の unit テスト（dueAt/glosses/scheduling prop が渡ること）、WordbookScreen のソート/件数バッジの component テスト、WordDetailCard の component テスト（scheduling あり/なしの表示分岐）、ローディングスケルトンの e2e。

### D-4: 文章ページのサムネイル付き一覧

1. **現状の問題** — 文章一覧はタイトル＋「意図 · CEFR」のみのテキスト行（src/ui/library/LibraryScreen.tsx:53-82）。各 Passage には生成イラストが `meta.sceneIllustrationUrl`（base64 data URL）として Dexie に永続化済みで（src/types/domain.ts:108-123、再生成時も routes.tsx:885-894 で書き戻し）、検索結果の `ArticleHit`/`StoryGroup` は PassageRecord/最新章レコードを丸ごと保持している（src/domain/library/passageSearch.ts:22-36）ため UI から即アクセス可能なのに一切使われていない。作成日（passageSearch.ts:98 でソートにのみ使用）・語数・読書進捗も非表示で、`ReadingProgress`（in_progress/completed、src/types/domain.ts:442-450、src/infra/persistence/progressRepository.ts:9-29）は永続化済みなのに LibraryRoute が progress リポジトリを参照しない（routes.tsx:1063-1083）。記事/物語の区別も「▸」1 文字（LibraryScreen.tsx:74-77）。どの文章を読み終えたか・due 語を含む文章の再読which が判断できず、生成コストをかけた文章が読み捨てになる。

2. **あるべき姿** — 一覧の各項目に場面イラストのサムネイルが並び、視覚記憶で「あの話だ」と即座に識別できる。タイトルの下に「日常会話 · B1 · 320語 · 6/28」のメタ行、右端に読了✓/読みかけ 45%/未読の状態。物語は最新章のサムネイル＋「物語 · 全3章」バッジで記事と明確に区別される。期限到来の復習語を N 語含む文章には「復習語 3」バッジが付き、再読が最も効率的な復習として選べる。

3. **改善の方向性** — サムネイル表示は「フルサイズ data URL をそのまま `<img>` に出す」案と「保存時に縮小サムネイルを別フィールドで持つ」案がある。フルサイズ data URL（数百 KB×件数）は一覧描画のデコード負荷が大きいため、**第 1 段階はフルサイズ＋`content-visibility` で即効実装し、第 2 段階で `PassageMeta.sceneThumbnailUrl`（canvas で 192×128 に縮小した data URL）を追加して切り替える**2 段構えを推奨する（E-3 の画像キャッシュ方針と整合）。domain 層の変更は第 2 段階まで不要で、第 1 段階は UI 追加のみで完結する。

4. **実装計画**

   - [ ] **第 1 段階**: LibraryScreen の行をカード型（左 96×64 サムネ `object-fit:cover; border-radius:8px`、なければカテゴリ色のプレースホルダ＋イニシャル）に変更。記事は `entry.passage.passage.meta.sceneIllustrationUrl`、物語は `entry.latest.passage.meta.sceneIllustrationUrl` を参照。メタ行に `INTENT_LABELS[intent] · {level} · {approxWords}語 · {作成日 M/D}` を表示。物語はバッジ「物語 · 全N章」で区別（「▸」廃止）。行に `content-visibility:auto` を設定。
   - [ ] LibraryRoute（routes.tsx:1063-1083）で `c.repos.progress` を useLiveQuery し `Map<passageId, ReadingProgress>` を LibraryScreen に渡す。行右端に「読了 ✓」「{percent}%」「未読」を表示し、in_progress は「続きから」の強調色にする。
   - [ ] **第 2 段階**: `PassageMeta` に `sceneThumbnailUrl?: string` を追加。生成/再生成完了時（routes.tsx:885-894 の書き戻し箇所）に canvas 縮小で生成して保存し、既存レコードは一覧初回表示時に遅延生成して upsert する。一覧はサムネフィールドを優先参照する。
   - [ ] **第 3 段階（任意）**: 各文章の学習語 ID 集合と `schedulingRepository.dueBefore(userId, now)` の積集合数を「復習語 N」バッジとして表示し、クリックで該当文章を開く（再読 read_through クレジット、src/domain/srs/recallEventService.ts:43-57 と連動する再読推奨導線）。
   - **受け入れ基準**: サムネなし文章でプレースホルダが崩れず表示される。一覧 100 件でスクロールがカクつかない。読了済み文章に✓が出る。検索時もサムネ付きカードのまま絞り込まれる。
   - **テスト方針**: passageSearch は変更しないため既存 unit を維持。LibraryScreen の component テスト（サムネ有無・進捗 3 状態の分岐）、visual スナップショット追加。第 2 段階の縮小関数は canvas をモックした unit テスト。

### D-5: ホーム「復習が必要な単語」からの単語解説ジャンプ

1. **現状の問題** — dueList の各行は素の `<div>`（onClick なし・cursor なし・button でない、src/ui/dashboard/DashboardScreen.tsx:212-236）で、ユーザ報告どおりクリックしても何も起きない。単語詳細（WordDetailCard）を出す `WordDetailRoute`（routes.tsx:1235-1295）は ReadingScreen（routes.tsx:961）と WordbookScreen（routes.tsx:1056）の `renderWordDetail` 注入経由のみで、単語詳細用 URL ルートは存在しない（src/ui/router.tsx:21-36）。WordbookScreen の選択もローカル state（WordbookScreen.tsx:51）のため「単語帳へ遷移して該当語を開く」経路も作れない。さらに DashboardScreen には訳語表示ロジックがある（同 29, 226-231）のに HomeScreen が glosses prop を持たず誰も渡さないため（src/ui/home/HomeScreen.tsx:19-28, 88-95）ホームでは英単語のみが並び、意味を思い出せない語ほど確認手段がない。dueList は全件レンダリングで上限がなく（src/domain/dashboard/dashboardProjector.ts:93-96、DashboardScreen.tsx:212）、復習が溜まるとホーム右レールを際限なく占拠する。

2. **あるべき姿** — ホームで「復習が必要な単語」の行（英単語＋日本語訳＋期限）をクリックすると、その場で WordDetailCard がオーバーレイ表示され、語源・コロケーション・習熟度を確認して Esc で戻れる。リストは上位 8 件＋「他 12 語を単語帳で見る」に丸められ、リンク先の単語帳は要復習フィルタが適用済みで開く。加えて各単語は `/w/negotiation` のような固有 URL を持ち、ブラウザのブックマーク・履歴・他画面からのリンクで直接開ける。

3. **改善の方向性** — 遷移方式は (a) ホームにオーバーレイ注入（WordbookScreen と同じ `renderWordDetail` パターン）、(b) `/wordbook?word=:id` ディープリンク、(c) 専用 `/w/:wordId` ルート新設の 3 案。**(a) を主とし、(c) をディープリンク基盤として併用することを推奨**する。(a) はホームの文脈（今日の計画を眺めている状態）を壊さず既存パターンの再利用で実装コスト最小。(c) は F-9 およびロードマップ 1-8 で先行実装する共有可能 URL の基盤であり、E-3（画像/音声のディープリンク前提機能）もこれに依存する。既存 `WordDetailRoute`（routes.tsx:1235-1295）を薄いページラッパーで包みルート 1 本を足すだけで済むため、専用ルートの設計コストは小さい。(b) の `?word=` クエリは役割が (c) と完全に重複するため採用しない（単語帳への導線は `?filter=due` のみ使用し、特定語を開く URL は `/w/:wordId` に一本化する）。

4. **実装計画**

   - [ ] **`/w/:wordId` ルート新設（F-9・ロードマップ 1-8 の実体タスク。本項が正）**: src/ui/router.tsx:21-36 の children に `{ path: 'w/:wordId', element: <WordPageRoute /> }` を追加する。routes.tsx に `WordPageRoute` を新設し、`useParams` で wordId を取得して既存 `WordDetailRoute`（routes.tsx:1235-1295）をページコンテナ（単語帳の listCard と同幅の中央寄せカード）で再利用する。`onClose` は履歴があれば `navigate(-1)`、直打ち等で履歴がなければ `navigate('/wordbook')`。未知 wordId（`useWordData` がエラー、または語データ取得失敗）の場合は「この単語は見つかりませんでした」＋「単語帳へ戻る」CTA の空状態を表示する（無限ローディング禁止）。オーバーレイ版（ホーム/読解/単語帳の `renderWordDetail`）は変更せず共存させ、`WordDetailRoute` 本体は両者から共有する。
   - [ ] DashboardScreen: dueList 行を `<button type="button">` 化し `.interactive-row`（D-2）を付与、`onSelectWord?: (wordId: string) => void` prop を追加してクリックで発火する。表示は上位 8 件に丸め、残数があれば「他 {M} 語を単語帳で見る」リンク（`onShowAllDue` prop）を末尾に置く。各行に「リンクをコピー」等は置かず、固有 URL が必要な文脈では `/w/:wordId` を参照する。
   - [ ] HomeScreen: `glosses`・`onSelectWord`・`onShowAllDue` を props に追加し DashboardScreen（88-95 の呼び出し）へ透過する。
   - [ ] HomeRoute（routes.tsx:295-660）: `selectedWordId` state を追加し、選択時に WordbookScreen と同じオーバーレイ構造（`role=dialog`、D-8 の ModalOverlay）で `<WordDetailRoute wordId={...} onClose={...} />` を描画する。glosses は dueList の wordId を `repos.wordCache` から useLiveQuery で join し `{ [wordId]: meaningsJa[0] }` を構築する（projector は変更しない）。`onShowAllDue` は `navigate('/wordbook?filter=due')`。
   - [ ] WordbookScreen/WordbookRoute: URL クエリ `?filter=due` を初期フィルタとして受け取る（`useSearchParams`）。`?word=:id` クエリは実装しない（特定語のディープリンクは `/w/:wordId` に一本化）。
   - **受け入れ基準**: ホームの due 行クリック → WordDetailCard が開き、Esc・背景クリックで閉じてホームの表示状態が維持される。行に日本語訳が併記される。due 9 件以上で「他 M 語」リンクが出て、遷移先の単語帳が要復習フィルタ適用済みで開く。キーボード（Tab→Enter）でも同じ操作が可能。`/w/{既知のwordId}` の URL 直打ちで WordDetailCard が単独ページとして表示され、閉じる操作で `/wordbook`（履歴なし時）へ戻る。`/w/{未知のID}` では 3 秒以内に「見つかりませんでした」空状態と単語帳への CTA が表示される。オーバーレイ版と `/w/:wordId` ページ版が同一語で同一内容（意味・語源・習熟度）を表示する。
   - **テスト方針**: DashboardScreen の component テスト（button 化・onSelectWord 発火・8 件丸め）。HomeRoute の glosses join は routes 結線のため e2e で検証（due 語を 1 件シードし、ホーム→行クリック→カード表示→Esc を通す）。`/w/:wordId` は e2e 2 本（既知 ID 直打ち→カード表示→閉じる遷移先、未知 ID→空状態）と、router テーブルにルートが存在することの unit テスト（appRoutes の path 検査）。

### D-6: モバイル・小画面レイアウトの破綻（追加検出）

1. **現状の問題** — 検証済みの破綻が 4 点ある。(a) **復習評定ボタンの崩壊**: 4 ボタン行は `display:flex; gap:10` 固定で flexWrap がなく（src/ui/review/ReviewSession.tsx:195、rateButtonStyle 296-304）、外側 padding 48px＋カード内側 padding 80px（同 109, 124）を引くと 414px では 1 ボタン約 64px。「知らなかった」（6 文字）が 1〜2 文字ずつ縦折返しする（コミット済みスナップショット `review-mobile-webkit-linux.png` で旧短ラベル時点でも折返しを確認済み。global.css に review 系のモバイル規則ゼロ）。誤タップは FSRS スケジュールを直接汚染する。(b) **WordDetailCard のモバイル非対応**: 見出し語 fontSize 42 固定・右カラム `flex:'none'`（src/ui/wordcard/WordDetailCard.tsx:171, 200）で 414px では見出し語と★列の間隙 3px まで詰まり、長い単語では右カラムが overflow で欠落する。閉じる×は約 20px（202-209）、スクロールロックなし（162-163 の内部スクロール端で背面が動く）。(c) **ホーム導線の埋没**: ≤900px で home-body が 1 カラム化すると DOM 順（src/ui/home/HomeScreen.tsx:77-98）により生成フォームが先、「続きを読む」「復習をはじめる」（DashboardScreen.tsx:170-172, 238-240）が最下部に落ちる。マストヘッドの「今日の復習 N語」Stat はタップ不可の div（HomeScreen.tsx:104-114）。(d) **タップ対象の過小**: 本文の気づき/学習語句バッジは 15×15px・fontSize 9 の role=button（src/ui/reading/PassageRenderer.tsx:244-252, 301-307）で、クリック可能な単語スパンの直後 1px に隣接し誤タップ頻発。文字サイズ A ボタン（ReadingScreen.tsx:620-628、padding なし）と×も WCAG 2.5.8 の最小 24px 未満。

2. **あるべき姿** — 414px で評定 4 ボタンが 2×2 グリッドに整列しラベルが折り返さない。単語カードは見出し語が画面幅に応じて縮み、×は親指で確実に押せる。モバイルのホームは開いた瞬間に「復習をはじめる」「続きを読む」が見え、マストヘッドの復習数もタップで /review へ飛べる。本文のバッジは見た目 15px のまま実効ヒット領域が 24px 以上ある。

3. **改善の方向性** — インラインスタイル中心の現構成では media query が使えない箇所が破綻源なので、**破綻している 4 箇所に className を付与し global.css の media query で上書きする**方針で統一する（CSS-in-JS 導入等の全面改修はしない)。タップ領域は DOM サイズを変えず `::after` 擬似要素の拡張で確保し、視覚デザインを維持する。

4. **実装計画**

   - [ ] ReviewSession: ボタン行に `className="review-rate-row"` を付与し、global.css に `@media (max-width:600px) { .review-rate-row { display:grid; grid-template-columns:1fr 1fr; } }` を追加。カード内側/外側 padding もモバイルで `20px 16px` に縮小する。
   - [ ] WordDetailCard: 見出し語を `fontSize: 'clamp(28px, 8vw, 42px)'`＋`overflowWrap:'anywhere'` に変更し、ヘッダ（168）に `flexWrap:'wrap'`。×ボタンに `width:44; height:44; display:grid; placeItems:center` を設定。オーバーレイは D-8 の ModalOverlay（スクロールロック内蔵）へ移行。
   - [ ] HomeScreen: `.home-ledger` に ≤900px で `order:-1` を与え進捗レールを生成フォームの上に出す（global.css:321-329 のブロックに追記）。Stat「今日の復習」を `<button>` 化し `onStartReview` を配線する。
   - [ ] global.css の `.notice-badge` に `position:relative` ＋ `&::after { content:''; position:absolute; inset:-6px; }` を追加して実効ヒット 27px を確保（学習語句バッジ・A ボタン・×も同様に最小 32×32 を保証）。
   - **受け入れ基準**: 414×842 スナップショットで評定ボタンのラベル折返しゼロ・WordDetailCard のヘッダ重なり/欠落ゼロ。モバイルホームの初期ビューポート内に「復習をはじめる」が表示される。全インタラクティブ要素の実効ヒット領域 ≥24×24px（Playwright で boundingBox＋擬似要素検査のカスタムアサーション）。
   - **テスト方針**: mobile-webkit プロジェクトの visual スナップショットを更新し、review/wordcard/home の 3 画面を追加。タップ領域はユニットでなく e2e の実測で担保する。

### D-7: 待ち時間・画面遷移のフィードバック欠如（追加検出）

1. **現状の問題** — (a) **生成の無フィードバック**: 生成押下で候補再取得→WordData 取得→本文生成（修復ループ最大 2 回）→注釈パスの直列 LLM パイプライン（routes.tsx:412-437, 439-496、src/domain/generation/generationOrchestrator.ts:138-214）が数十秒〜分単位走るが、UI はボタンが「生成しています…」＋disabled になるだけ（src/ui/setup/SetupScreen.tsx:536-538, 771-784）。スピナー・段階表示・目安・キャンセルがなく、`fetch` に AbortController もタイムアウトもない（src/infra/content/contentGatewayHttp.ts:120-135、src/ 全体に AbortController 不在）ためサーバがハングすると永遠に「生成しています…」のまま。生成中も他フィールドは編集可能で押下時スナップショット（SetupScreen.tsx:247-251）との齟齬も起きる。(b) **生成状態が HomeRoute ローカル**: `generating`/`generationError` は useState（routes.tsx:300-301）で、生成中に TopNav（常時活性）で他画面へ移るとエラーは誰にも表示されず（React 19 でアンマウント後 setState は no-op）、成功時は逆に別画面から突然リーダーへ強制遷移する（react-router 7.18 の navigate はアンマウント後も実行される）。(c) **ScrollRestoration 未使用**: data router 構成に `<ScrollRestoration>` がなく（src/ui/router.tsx:21-41、src/main.tsx:37-45）、生成完了後の `/p/:id` 遷移でフォーム最下部のスクロール位置が引き継がれ、記事の中腹から表示される。(d) **/p/:id ロード中の誤空状態**: ReadingRoute は解決前でも ReadingScreen を描画し（routes.tsx:672-694, 937-963）、「読む文章がありません。セットアップから文章を生成してください。」（src/ui/reading/ReadingScreen.tsx:175）が毎回フラッシュする。文言の「セットアップ」はナビに存在せず CTA もない。(e) **メタ行の内部コード生表示**: 読解ツールバーが `daily · LEVEL B1 · …` と enum/CEFR を生のまま表示（ReadingScreen.tsx:187, 236。一覧側は INTENT_LABELS で日本語化済みで不整合、src/ui/library/LibraryScreen.tsx:63）。

2. **あるべき姿** — 生成押下で「①テーマ確定 → ②語彙データ取得 → ③本文生成 → ④注釈付け」の段階と経過秒数、「通常 30〜90 秒」の目安、キャンセルボタンが出る。他画面へ移っても TopNav に進行インジケータが残り、完了時は「文章ができました — 開く」トースト（強制遷移しない）、失敗時はどの画面でもエラートーストが出る。全ルート遷移でページ先頭から表示され、文章を開くときはスケルトン→本文の順で誤メッセージが挟まらない。メタ行は「日常会話 · 英検2級 (B1)」のように設定時の語彙で表示される。

3. **改善の方向性** — 生成状態は react-query の mutation でも表現できるが、進行フェーズの逐次通知が必要なため**zustand の `generationProgressStore` を新設し、controller からフェーズイベントを発火する**方式を推奨する（既存の playerStore/readingUiStore と同型で学習コストが低い）。完了時挙動は「ホーム滞在中のみ自動遷移、他画面ではトースト」に変更する。

4. **実装計画**

   - [ ] `src/state/stores/generationProgressStore.ts` を新設（`phase: 'idle'|'words'|'passage'|'repair'|'annotate'|'done'|'error'`、`startedAt`、`error`、`resultPassageId`、`abortController`）。routes.tsx の `runArticlePipeline`/`onGenerate`（412-496）と generationController から各フェーズで set する。
   - [ ] `contentGatewayHttp.request`（120-135）に `signal?: AbortSignal` を貫通させ、既定 `AbortSignal.timeout(120_000)` と store の abortController を `AbortSignal.any` で合成する。キャンセル/タイムアウト時は phase='error' に落とし UI を復帰させる。
   - [ ] SetupScreen: 生成中はフォーム全体を `<fieldset disabled>` で包み、生成ボタン位置に進捗パネル（フェーズ名・経過秒・目安・「キャンセル」）を表示する。
   - [ ] AppShell/TopNav: store 購読で生成中はナビ右端にスピナー＋「生成中…」を表示。完了時、現在地がホーム以外なら遷移せずトースト「文章ができました — 開く」（クリックで `/p/:id`）を出す（トースト基盤は D-8 と共用）。エラーも同経路で表示する。
   - [ ] ルート直下（AppShell）に `<ScrollRestoration />` を追加する（react-router 7 data router 対応。効かない画面があれば `useLocation` 監視の `window.scrollTo(0,0)` でフォールバック）。
   - [ ] ReadingRoute: `passage` 未解決かつ `!notFound` の間は `<ScreenSkeleton />` を返す。空状態文言を「まだ文章がありません。ホームで最初の文章を生成しましょう。」に変え、`/` への CTA ボタンを付ける。
   - [ ] ReadingScreen の metaLine（187, 218）を `INTENT_LABELS` と examScale 逆変換（src/ui/setup/ExamLevelPicker.tsx の対応表を共通モジュール化）で「日常会話 · 英検2級 (B1) · 新出 3 / 復習 9」に変更する。
   - **受け入れ基準**: msw でレスポンスを 130 秒遅延させるとタイムアウトエラーが表示されフォームが再操作可能になる。キャンセル押下 1 秒以内に idle へ復帰する。生成中に /library へ移動→完了でトーストが出て、クリックで本文先頭（scrollY=0）から表示される。文章一覧→本文遷移で空状態文言が 1 フレームも出ない。
   - **テスト方針**: store のフェーズ遷移 unit テスト、abort 貫通の infra unit テスト（fetch モック）、e2e はハング/キャンセル/別画面完了の 3 シナリオ。

### D-8: 操作の安全性とアクセシビリティ基盤（追加検出）

1. **現状の問題** — (a) **モーダルのフォーカス管理皆無**: 単語詳細オーバーレイ（ReadingScreen.tsx:380-391 / WordbookScreen.tsx:138-149）は aria-modal なし・初期フォーカスなし・トラップなし・Escape で閉じない（Escape は readingUiStore.clearPin 専用、ReadingScreen.tsx:128-146）・スクロールロックなし。src/ui 全体で `.focus()`/inert/body overflow 操作は 0 件。(b) **破壊的操作の無確認・無取り消し**: 「知らなかった」は 1 タップで rating=1 が即永続化され（routes.tsx:728-736, 1265-1273 → src/state/controllers/reviewController.ts:36-49）、lapses+1 と stability 減衰が確定するがアンドゥも成功フィードバックもなく、失敗は黙殺される（WordDetailCard.tsx:141-151）。物語プランの「やり直す」も生成済みプラン＋進行中イラストを無警告破棄する（routes.tsx:628-635）。(c) **コントラスト AA 未達**: 和訳本文 14px が faint2 #8A95A3（実背景 #F6F8FA 上で 2.86:1、src/ui/reading/SentenceTranslation.tsx:29-41、tokens.ts:25-27）、メタ/訳語の faint 2.52:1、TopNav 非アクティブ 4.15:1、エラー文 3.09:1 — 通常テキスト基準 4.5:1 を軒並み下回る。(d) **復習のキーボード操作なし**: ReviewSession に keydown ハンドラが皆無で（src/ui/review/ReviewSession.tsx:66-218）、Anki 流の Space=解答表示・1〜4=評定ができない。(e) **機能しない朗読バーの常駐**: TTS バックエンド不在（server/llm/handler.ts:37-44, 140 で 404 → 必ず unavailable 化）なのに BottomPlayer が全ルートに描画され（src/ui/AppShell.tsx:103）、押しても無音で再生中表示になる▶（src/state/stores/playerStore.ts:134-138）や非対話の偽トグル（BottomPlayer.tsx:145）を提示し、モバイルでは全ページの約 18%（150px、global.css:156-158）を常時占有する。

2. **あるべき姿** — すべてのダイアログが開いた瞬間に内部へフォーカスし、Tab が内部を循環し、Esc で閉じ、背景は動かない。「知らなかった」を押すと「negotiation を記録しました — 取り消す」トーストが 5 秒出て誤タップを復元できる。和訳・ナビ・エラーの全テキストが AA 4.5:1 を満たす。復習は Space→数字キーだけで 1 枚 2 秒で処理できる。動かない朗読バーは表示されず、TTS 実装後に読解画面のみで復活する。

3. **改善の方向性** — 個別修正でなく**共通基盤 3 点（ModalOverlay・トースト＋Undo・コントラスト検証付きトークン）を先に作り、各画面を移行する**。フォーカストラップは自前実装（focusable 収集＋Tab ループ、50 行程度）とし外部依存を増やさない。Undo は「直前の WordSchedulingState を保持して復元」方式（reviewLog には打ち消しエントリを追記し履歴の整合を保つ）。

4. **実装計画**

   - [ ] `src/ui/shared/ModalOverlay.tsx` を新設（`role=dialog` + `aria-modal` + 初期フォーカス（最初の focusable か閉じるボタン）+ Tab トラップ + Escape で onClose + `document.body` の overflow:hidden ロック + 開元へのフォーカス返却）。単語詳細 2 箇所・物語設定（ReadingScreen.tsx:393-411）・D-5 のホームオーバーレイを移行する。
   - [ ] `src/ui/shared/Toast.tsx`＋`toastStore` を新設（成功/エラー/Undo アクション付き、5 秒自動消滅）。`markUnknown` 系（reviewController）で実行前 state を保持し、Undo で `scheduling.upsert(prevState)`＋reviewLog 打ち消しエントリ追記を行う。StoryPlanReview の「やり直す」（src/ui/setup/StoryPlanReview.tsx:249-253）には confirm ステップ（「プランを破棄して最初から作り直しますか？」）を追加する。
   - [ ] tokens.ts のコントラスト修正: 和訳本文を `inkSoft #5A6675`（5.85:1、AA 合格）へ変更し、`faint`/`muted` は #F6F8FA 上で 4.5:1 以上になる値へ暗色化、エラー文は `terracottaDeep` へ。`tokens.test.ts` に「テキスト用トークン×使用背景の全組合せで比 ≥4.5」を計算する unit テストを追加して回帰を防ぐ。
   - [ ] ReviewSession に keydown（コンポーネント内 useEffect、`Space/Enter`=解答表示、`1..4`=評定、busy 中は無視、入力欄フォーカス時は無効）を追加し、ボタンにキーヒント（`1 知らなかった` 等）を表示する。
   - [ ] BottomPlayer: TTS 実装（テーマ E 側）まで `status === 'unavailable' || !session.passage` なら AppShell で非描画とし、global.css の `padding-bottom` 予約は `body.player-visible` クラスで条件化する。偽トグル span（BottomPlayer.tsx:145）は削除する。
   - **受け入れ基準**: 全ダイアログで axe 違反（aria-modal/focus 系）ゼロ、Esc クローズ動作。「知らなかった」→Undo で stability/lapses/dueAt が実行前値へ戻る（Dexie 実測）。全テキストトークンのコントラスト unit テストが green。復習 10 枚をキーボードのみで完走できる（e2e）。TTS 不在環境で朗読バーが描画されず、モバイルの `.app-main` 下部予約が消える。
   - **テスト方針**: ModalOverlay はフォーカス移動を testing-library で検証。Undo は reviewController の unit＋Dexie 統合テスト。コントラストは純関数 unit。キーボード復習と朗読バー非表示は Playwright。

### 優先度と依存関係

実装順は「共通基盤 → レール構造修正 → 各画面適用」の 3 波とする。

| 順序 | 項目 | 理由・依存 |
|---|---|---|
| 1 | **D-2 の keydown/stopPropagation・cursor:pointer 復旧、D-7 の ScrollRestoration・/p/:id スケルトン、D-3 の 0 語フラッシュ修正** | いずれも 1 ファイル級の即効修正で他項目に依存しない。退行（旧レールからの機能喪失）の回復を最優先 |
| 2 | **D-8 の ModalOverlay・トースト基盤、D-2 の視覚言語トークン/共通クラス（surfaceHover・.interactive-*）、D-5 の /w/:wordId ルート** | D-3/D-4/D-5/D-6/D-7 の UI 改修すべてが前 2 基盤を利用する。/w/:wordId は F-9・ロードマップ 1-8 と同一タスク（実装計画は D-5 が正）で、E-3 のディープリンクが依存するため基盤と同じ波で先行実装する。既存 WordDetailRoute の再利用のみで他項目への依存はない |
| 3 | **D-1 レール構造修正（座標系統一 → grid/幅制約 → 再計測 → コンパクト化 → ブレークポイント統一/モバイルポップオーバーの順）** | テーマ D の中核。コンパクト化の操作割当ては D-2 の視覚言語（順序 2）が前提。cue 密度プロンプトはテーマ B/C のプロンプト改修と同一 PR で行う |
| 4 | **D-5 ホームジャンプ → D-3 単語帳 → D-4 文章一覧（並行可）** | 相互依存なし。D-5 のオーバーレイは ModalOverlay（順序 2）を、「他 M 語」導線は WordbookScreen の `?filter=due` 対応を使うため、D-3 より先に着手すると単語帳側の受け口を一度に作れる。D-3 の WordDetailCard 習熟度表示のうち「定着まであと N 回」バーは C-5c のコンポーネント完成後に結合する（先行時はテキストのみ）。D-4 第 2 段階（sceneThumbnailUrl）はテーマ E-3 のキャッシュ設計と同時に決定する |
| 5 | **D-6 モバイル一式、D-7 生成進捗/グローバル状態、D-8 コントラスト/キーボード/朗読バー** | D-6 は D-1 のブレークポイント統一後に実施するとレール系の media query を一本化できる。D-7 生成進捗はテーマ A（生成制御）の A-2 リセット改修と同じ SetupScreen を触るため同時期にまとめる。コントラスト変更は全画面スナップショット更新を伴うので最後に一括で行う |

全波を通じて、visual スナップショット（Playwright）の更新は各波の末尾で 1 回ずつ行い、差分レビューで意図しない崩れを検出する。

---

## テーマE: 画像生成・アイコン・蓄積

### E-1: xAI Grok 画像 API の追加と用途別の品質/速度切替

**現状の問題**

画像生成プロバイダは `server/llm/providers.ts` 内で openai / gemini の 2 値にハードコードされ、Grok(xAI) を差し込む口が存在しない。

- `server/llm/providers.ts:659` — `type ImageProvider = 'openai' | 'gemini';` の union 固定。
- `server/llm/providers.ts:665-668` — `resolveImageProvider` は `gemini`/`google`/`imagen` 以外の値をすべて `'openai'` に黙ってフォールバックする。`IMAGE_PROVIDER=grok` と書いてもエラーにならず OpenAI が使われ、誤設定が顕在化しない。
- `server/llm/providers.ts:726` — OpenAI 呼び出しの `quality: options.quality ?? 'low'` に対し、呼び出し側 `illustrateCharacter`（providers.ts:750-761）・`illustratePassage`（providers.ts:763-774）はどちらも `quality` を渡さないため、品質は常に最低の `low` 固定。
- `server/llm/providers.ts:681-685` — モデルは env `IMAGE_MODEL` 1 変数のみで、用途別（キャラ絵 vs シーン挿絵、下書き vs 清書）に変えられない。
- `server/llm/handler.ts:77-85, 117-125` — 画像 2 エンドポイント（`/api/passages:illustrate`, `/api/story:illustrate`）はリクエストボディで provider / quality を受け付けず、クライアント型 `PassageIllustrationRequest`（src/types/domain.ts:313）/ `CharacterIllustrationRequest`（src/types/domain.ts:296）にも該当フィールドがない。
- `server/generationApiPlugin.ts:78-88` — 起動時ログ `logKeySource` はテキスト LLM のキーのみ診断し、`IMAGE_PROVIDER` / `GEMINI_API_KEY` / `IMAGE_MODEL` に触れない。誤設定は初回画像生成の 503（providers.ts:671-679）まで発覚せず、しかも `storyPlanner.ts:231-233` が例外を握り潰して null を返すため、確認ゲートでは「イラストが無言で欠ける」形でしか現れない。
- `.env.example:22-29` — openai / gemini の記載のみ。
- `server/llm/providers.ts:741` — 返却 data URL の MIME を `data:image/png;base64,` に固定付与。Grok は JPG を返すため、そのまま流用すると MIME が嘘になる。
- `src/domain/story/storyPlanner.ts:210-234` — キャラ 1 体につき full_body → portrait を直列 2 回生成するため、遅いプロバイダだと確認ゲートの待ちが倍増する。高速プロバイダの選択肢が体験に直結する。

**Grok 画像 API の事実確認（Web 調査済み）**

- エンドポイント: `https://api.x.ai/v1/images/generations`。base URL `https://api.x.ai/v1` で OpenAI SDK/API 互換。
- モデル: `grok-2-image`（実体 `grok-2-image-1212`）。
- `response_format: "b64_json"` 対応 — 既存の base64 → data URL 変換（providers.ts:738-741, parseOpenAiImage 776-779）がそのまま使える。
- 出力フォーマットは **JPG**（data URL は `data:image/jpeg;base64,` にする必要がある）。
- **`quality` / `size` / `style` パラメータは非対応**（`n` は最大 10）。OpenAI と同じボディを送るとパラメータ起因のエラーまたは無視となるため、Grok 分岐では `size`/`quality` を送らない。アスペクト比の制御はプロンプト内指示で代替する。
- 料金: 情報源により標準 $0.02/枚〜$0.07/枚と幅がある（**要確認**: 実装時に docs.x.ai の料金表で確定すること）。速度はディフュージョンではなく自己回帰系で高速とされ、「fast プロファイル」用途に適する。
- Sources: [Image Generation | xAI Docs](https://docs.x.ai/developers/model-capabilities/images/generation), [Image Overview | xAI Docs](https://docs.x.ai/docs/guides/image-generations), [Models | xAI Docs](https://docs.x.ai/developers/models), [xAI Grok API Image Generation: Capabilities, Cost & Setup](https://www.atlascloud.ai/blog/guides/xai-grok-api-image-generation), [Grok API Pricing Explained (2026)](https://www.grizzlypeaksoftware.com/articles/p/grok-api-pricing-explained-every-model-every-cost-and-how-it-compares-2026-f1p7dvdu)

**あるべき姿**

学習者が物語を開始すると、確認ゲートに滞在している数秒〜十数秒の間にキャラクターイラスト（1 体 2 枚 × 人数分）が Grok で出揃い、「絵が出るまで待つか、絵を捨てて進むか」の二択を迫られない。一方、じっくり読む記事のシーン挿絵やアプリアイコンのような一点物は GPT (gpt-image-1) の `quality: high` で清書される。この用途別の使い分けは**設定を一切触らない既定状態で機能する**（キャラ絵 = fast、シーン挿絵 = quality が自動適用）。速度か品質かを全用途で固定したいユーザだけが設定で明示指定する。`.env` の誤設定（キー欠落・プロバイダ名 typo）は dev サーバ起動ログの 1 行と 503 エラーで即座に分かる。

**改善の方向性**

- 案A: 既存の if/else（providers.ts:703-741）に `grok` 分岐を 1 本追加する最小差分。→ 3 プロバイダ×（キー解決/モデル既定/リクエスト形/レスポンス parse/MIME）の分岐が 5 箇所に散らばり続け、4 つ目の追加でさらに悪化する。
- 案B: **プロバイダ記述子テーブル**を導入する。`{ baseUrl, keyEnvName, defaultModel, supportsSize, supportsQuality, mime, buildBody, parseResponse }` を openai / grok / gemini の 3 レコードで宣言し、OpenAI 互換系（openai / grok）は同一の fetch ブランチを共有する。変更が providers.ts 1 ファイルに閉じている現状なら移行コストは小さい。

**推奨は案B**。加えて「グローバル 1 値」をやめ、用途プロファイル 2 段（`fast` / `quality`）を env で宣言し、リクエスト単位の `imagePreference` で選択する。未知の `IMAGE_PROVIDER` 値はフォールバックせず 503 + 起動時警告で顕在化させる。

プロファイル選択の**解決優先順位は 1 本に固定**する:

1. リクエストボディの明示値 `imagePreference`（あれば最優先）
2. ボディに無ければ handler 側の**用途別既定**: キャラ絵エンドポイント = `fast`、シーン挿絵エンドポイント = `quality`

クライアントの `Settings.imagePreference` は三値 `'auto' | 'fast' | 'quality'`（既定 `'auto'`）とする。`'auto'` のときクライアントは**ボディに `imagePreference` を載せない**（→ 用途別既定が効く）。`'fast'` / `'quality'` のときのみ全用途にその値を明示送信する。これにより「既定 'fast' が全リクエストに載って用途別既定が死ぬ」矛盾を構造的に排除する。

**実装計画**

- [ ] `server/llm/providers.ts:659-685` — `ImageProvider` に `'grok'` を追加し、プロバイダ記述子テーブル `IMAGE_PROVIDER_SPECS: Record<ImageProvider, ImageProviderSpec>` を導入する。grok レコード: `baseUrl: 'https://api.x.ai/v1/images/generations'`, `keyEnvName: 'XAI_API_KEY'`, `defaultModel: 'grok-2-image'`, `supportsSize: false`, `supportsQuality: false`, `mime: 'image/jpeg'`。
- [ ] `providers.ts:665-668` `resolveImageProvider` — 既知エイリアス（`grok`/`xai` → grok、`gemini`/`google`/`imagen` → gemini、`openai`/未設定 → openai）以外は `ProviderError(503, 'Unknown IMAGE_PROVIDER: ...')` を投げる。
- [ ] `providers.ts:693-742` `generateImageDataUrl` — OpenAI 互換ブランチを記述子パラメタ化で共通化。`supportsSize`/`supportsQuality` が false のプロバイダには該当フィールドを送らない。741 行の固定 `image/png` を記述子の `mime` に置換する。
- [ ] Grok は size 非対応のため、Grok 選択時のみ `generateImageDataUrl` 内でプロンプト末尾にアスペクト指示を追記する（`buildCharacterIllustrationPrompt`（server/llm/schema.ts:767-806）/`buildPassageIllustrationPrompt`（schema.ts:813-844）自体は変えない）。追記文面案:
  - full_body: `"Compose the image as a vertical 3:4 portrait-orientation full-body illustration with the character fully in frame."`
  - portrait: `"Compose the image as a square 1:1 head-and-shoulders portrait, centered."`
  - シーン挿絵: `"Compose the image in a wide 16:9 landscape format, like a book illustration spread."`
- [ ] 用途プロファイル導入 — env に `IMAGE_PROVIDER_FAST` / `IMAGE_PROVIDER_QUALITY`（未設定時は既存 `IMAGE_PROVIDER` に両方フォールバック）、`IMAGE_MODEL_FAST` / `IMAGE_MODEL_QUALITY` を追加。quality プロファイルの OpenAI 呼び出しは `quality: 'high'`、fast は現行どおり `low`（Grok は quality 送信なし）。`Env` は `Record<string, string | undefined>`（providers.ts:54）なので型変更は不要。
- [ ] `src/types/domain.ts:296, 313` — `CharacterIllustrationRequest` / `PassageIllustrationRequest` に `imagePreference?: 'fast' | 'quality'` を追加。`server/llm/handler.ts:77-85, 117-125` でボディから受理して `illustratePassage` / `illustrateCharacter` → `generateImageDataUrl` に伝搬する。**handler 側の解決順**: ボディの明示値 > 用途別既定（`/api/story:illustrate` = fast、`/api/passages:illustrate` = quality）。この順序を handler 内の単一関数 `resolveImageProfile(body, endpointDefault)` に集約し、分岐を 2 エンドポイントに重複させない。
- [ ] `src/types/domain.ts:470-479` `Settings` に `imagePreference: 'auto' | 'fast' | 'quality'`（既定 `'auto'`）を追加し、設定 UI（AppShell 設定系 or SetupScreen の詳細設定）に三択（自動 / 速度優先 / 品質優先）を置く。`generationController.ts` のシーン挿絵リクエストと `storyPlanner.ts:210-234` のキャラ絵リクエストは、設定が `'auto'` のときボディに `imagePreference` を**含めず**（用途別既定に委譲）、`'fast'`/`'quality'` のときのみその値を載せる。
- [ ] `server/generationApiPlugin.ts:78-88` `logKeySource` に画像診断 1 行を追加: `[generation-api] image: fast=grok (XAI_API_KEY=length 84, model=grok-2-image) / quality=openai (OPENAI_API_KEY=length 51, model=gpt-image-1)` 形式。キー欠落・placeholder はテキスト側と同じフラグ表記。
- [ ] `.env.example:22-29` を 3 プロバイダ + 2 プロファイル + `XAI_API_KEY` の記載に更新。
- [ ] 受け入れ基準: (1) `IMAGE_PROVIDER=grok` + 有効キーで挿絵が `data:image/jpeg;base64,` として返り UI に表示される。(2) `IMAGE_PROVIDER=grk`（typo）で起動ログに警告が出て、画像リクエストは 503 + 明示メッセージ。(3) `imagePreference: 'quality'` のリクエストで OpenAI へのボディが `quality: 'high'` になる。(4) Grok へのリクエストボディに `size` / `quality` フィールドが含まれない。(5) **ユーザが設定を一切触っていない状態（`'auto'`）で、シーン挿絵リクエストが quality プロファイル、キャラ絵リクエストが fast プロファイルで処理される**（ボディに `imagePreference` が無く、handler の用途別既定が適用されることを確認）。(6) 設定を `'quality'` にすると、キャラ絵リクエストにも `imagePreference: 'quality'` が載り quality プロファイルで処理される。
- [ ] テスト: `server/llm/providers.test.ts`（既存）に fake `fetchImpl` 注入で追加 — 3 プロバイダそれぞれの URL / 認証ヘッダ / ボディ形 / MIME prefix の検証、未知プロバイダの 503、プロファイル解決の単体テスト（`resolveImageProfile`: ボディ明示値あり / なし × 2 エンドポイント既定、FAST/QUALITY env の優先順位）。

### E-2: アプリアイコン（favicon / PWA アイコン / manifest）の作成と設定

**現状の問題**

- `index.html:1-15` — `<head>` は charset / viewport / `<title>Lexia</title>` のみで `<link rel="icon">` が無い。ブラウザは `/favicon.ico` を 404 で受け、タブはデフォルトの地球アイコンになる。
- `public/` ディレクトリ自体が存在しない（リポジトリに .ico / アイコン用 SVG が皆無）。`vite.config.ts` に PWA プラグインなし、`src/main.tsx` に動的 favicon 設定なし、manifest も無いためホーム画面追加・PWA インストールが不可能。`gallery.html:1-12` も同様。
- ブランド要素は `src/ui/shared/TopNav.tsx:31-33` のテキストロゴ「Lexia.」のみで、タブ・ブックマーク・タスクスイッチャ上でアプリを識別できない。

**あるべき姿**

ブラウザタブ・ブックマーク・共有シート・ホーム画面追加のすべてで「Lexia」と一目で分かるアイコンが表示される。タブを 10 個開いていても紺（brand primary `#3D6CB0`）のレターマークで即座に見つけられ、モバイルでは「ホーム画面に追加」でスタンドアロンアプリとして起動できる。

**改善の方向性**

- 案A: 画像生成 API（E-1 の quality プロファイル）で 1024×1024 のラスターアイコンを生成し、各サイズへ縮小する。→ 一点物としては可能だが、16px まで縮めたときの判読性が制御できず、再現性（微修正のたびに別画像になる）も低い。
- 案B: **手書き SVG レターマークを一次ソース**にする。既存デザイントークン（`src/ui/theme/tokens.ts:16` `primary: '#3D6CB0'`、`tokens.ts:22` `ink: '#1E2630'`、`tokens.ts:41` `surfacePage: '#F6F8FA'`）とセリフ体ロゴ「Lexia.」に合わせ、角丸正方形（primary 地）に白セリフの「L.」を置く。PNG 各サイズは SVG から書き出す。

**推奨は案B**（小サイズ判読性・再現性・リポジトリ管理のしやすさ）。画像生成 API は「背景テクスチャ入りのストア用大判」など装飾版が欲しくなった場合の素材生成に限定して使う。その場合のプロンプト案（英語）:

> "A minimalist flat app icon for 'Lexia', an English vocabulary learning app. A single elegant serif capital letter 'L' followed by a small period, in warm white (#F6F8FA) on a deep calm blue (#3D6CB0) rounded-square background. Generous margins, subtle letterpress feel, no gradients, no shadows, no text other than the letterform, perfectly centered, square 1:1 composition."

**実装計画**

- [ ] `public/` を新規作成し、以下を配置: `favicon.svg`（一次ソース、`<rect rx>` 角丸 + セリフ「L.」）、`favicon.ico`（32px、ICO 変換）、`apple-touch-icon.png`（180px、角丸なしベタ地 — iOS 側が角丸を付けるため）、`icon-192.png` / `icon-512.png`（maskable 対応: セーフゾーン 80% 内にレターマーク収容）。
- [ ] `public/manifest.webmanifest` を新規作成: `{ "name": "Lexia", "short_name": "Lexia", "display": "standalone", "start_url": "/", "theme_color": "#3D6CB0", "background_color": "#F6F8FA", "icons": [192, 512 (purpose: "any maskable")] }`。
- [ ] `index.html` の `<head>` に追記: `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`、`<link rel="icon" sizes="32x32" href="/favicon.ico">`、`<link rel="apple-touch-icon" href="/apple-touch-icon.png">`、`<link rel="manifest" href="/manifest.webmanifest">`、`<meta name="theme-color" content="#3D6CB0">`。`gallery.html` にも favicon 2 行を追記。
- [ ] （任意）ダークテーマタブ対応: `favicon.svg` 内に `prefers-color-scheme: dark` の `<style>` を埋め、暗背景では地色を `#2D518C`（tokens.ts:17 primaryDeep）に切替。
- [ ] 受け入れ基準: (1) dev / `vite build` 後の preview で `/favicon.ico` と `/manifest.webmanifest` が 200 を返す。(2) タブに Lexia アイコンが表示される。(3) Chrome DevTools > Application > Manifest でエラー 0、インストール可能判定。(4) Lighthouse の installable 監査が pass。
- [ ] テスト方針: 画像アセットはユニットテスト対象外とし、`index.html` に `rel="icon"` と `rel="manifest"` の参照が存在することを smoke テスト（文字列アサーション）で担保。ビルド出力 `dist/` に 5 アセットが含まれることを CI の build ステップで確認する。

### E-3: 解説・イラスト・候補データの蓄積キャッシュ（cache-first 化）

**現状の問題**

「一度生成したものは二度と待たせない」が原則のはずが、最頻操作である単語カードで真逆になっている。書き込み済みの Dexie キャッシュが読まれない、という構造的欠陥が中心である。

- (a) **単語詳細カードが Dexie を読まない（critical）**: 本文中の単語クリック / 単語帳から開く `WordDetailRoute` は `src/ui/app/routes.tsx:1237` で `useWordData`（HTTP ゲートウェイ直行、`src/state/queries/contentQueries.ts:51-58`、staleTime 5 分のメモリキャッシュのみ、`src/main.tsx:34` の素の QueryClient で persister なし）を使う。Dexie へは routes.tsx:1245-1247 で「書くだけ」で、読み出しは一切ない。同ファイルに Dexie-first の `loadAndCacheWordData`（routes.tsx:148-161)が既存し読解レール（routes.tsx:745）・レビュー（routes.tsx:1003）で使われているのに、単語カードだけ使っていない。結果、リロード後や 5 分経過後に同じ単語を開くと毎回 LLM 生成（server/llm/providers.ts:458-471、maxTokens 1800）を数秒待つ（routes.tsx:1279「単語情報を読み込み中…」）。
- (a') **エラー状態が存在しない（検証済み）**: routes.tsx:1237 は `useWordData` から `data` のみ分割代入し `isError`/`refetch` を使わない。routes.tsx:1275-1285 の `!word` 分岐はローディング表示のみで、サーバ停止時はリトライ枯渇後も「読み込み中…」が出続け、再試行手段がない（contentGatewayHttp.ts:120-135 は throw、グローバルハンドラなし）。
- (b) **恒久キャッシュミスのループ（major）**: `wordDataNeedsRefresh`（routes.tsx:140-146）が memoryTips 欠落・etymology.noteJa 欠落・英語のみの synonymNuances を「要更新」と判定し、routes.tsx:156 / 1246 は**その場合 Dexie に保存しない**。LLM が新契約を満たさない応答を返した単語は永久にキャッシュされず、開くたびに再生成が走る。なお `server/llm/schema.ts:258` で memoryTips は required 済みだが、`schema.ts:186-188` の `noteJa` は `['string','null']` で null を許すため、null 応答がこのループを誘発する。
- (c) **ホーム候補のキャッシュ皆無（major）**: routes.tsx:343-358 の useEffect がマウント/設定変更ごとに `c.suggestions.suggest` を実行し、`src/domain/suggestion/wordSuggestionService.ts:106-123` は不足分を毎回 `gateway.suggestWords`（LLM、providers.ts:526-549）で取得。結果はローカル state のみで、ホーム再訪のたびに候補が数秒空になる。
- (d) **確認ゲート中のキャラ絵破棄（major）**: イラストは pendingPlan（React state）にのみストリーミング反映され（routes.tsx:468-487）、routes.tsx:549 `confirmPlan` はクリック時点のスナップショットを保存、直後の routes.tsx:582 `activeIllustrationRequest.current += 1` で進行中の反映を無効化する。生成完了前に「執筆開始」を押すと画像が捨てられ、キャラ詳細ページ訪問時に routes.tsx:1197-1207 が full_body + portrait を自動再生成（画像 API 2 回、費用二重）。
- (e) **シーン挿絵の欠落バックフィルなし（minor）**: シーン挿絵自体は `generationController.ts:166-188` で Dexie 永続化済みで再訪即表示（E-3 の要望を満たす唯一の箇所）。ただし生成時に画像 API が落ちた文章は挿絵なしのまま残り、リーダーの手動再生成（routes.tsx:862-900）以外に補完手段がない。
- (f) **復習キューの全件ブロッキング（major）**: routes.tsx:996-1016 が `Promise.all` で全 due 語の WordData 解決を待ってから表示し、未キャッシュ語・(b) の対象語が 1 語でもあると LLM 完了まで `ScreenSkeleton` のまま。
- (g) その他: `WordData.illustrationUrl`（src/types/domain.ts:411-412）は `WordDetailCard.tsx:240-242` の表示分岐だけ存在する生成経路なしのデッドフィールド。TTS はサーバルート自体が無く（handler.ts:37-44 のルート一覧に `/api/tts:*` が無く 140 行で 404）常時 degrade、音声キャッシュ以前の問題。

**あるべき姿**

一度でも開いた単語のカードは、リロード後でも機内モードでも 100ms 以内に開く。ネットワークは「初回生成」と「裏での補完」にだけ使われ、学習のテンポ（単語タップ → 読む → 閉じる → 次）を止めない。ホームは戻った瞬間に前回の候補が表示され、裏で静かに最新化される。復習は 1 枚目のカードがすぐ出て、めくるそばから次が先読みされている。生成に費用を払った画像は例外なく保存され、二度と同じ画像に課金しない。取得に失敗したときは「失敗した」と明示され、ワンタップで再試行できる。

**改善の方向性**

比較軸は「react-query の永続化プラグイン（persistQueryClient）導入」vs「既存の Dexie repos を queryFn に接続」。前者は全クエリ一括永続化だが、生成パッセージなど巨大レスポンスまで無差別に永続化され、既存の `wordCache` テーブル（lexiaDb.ts:103, 143）と二重管理になる。**推奨は後者**: 既に正しい実装（`loadAndCacheWordData`）が同一ファイルにあるので、それを唯一の取得経路に統一する。WordData はユーザ非依存の不変データなので `staleTime: Infinity` + Dexie 永続で原則ネットワーク不要とする。

WordData の契約が将来変わる問題（テーマ C の C-1/2/3 構造体化）とは、`wordCache` レコードへの **`schemaVersion` 導入（roadmap D2）** で切り離す。キャッシュには「どの版の契約で保存したか」を刻み、契約が変わったら版数バンプ + 読み出し時の持ち上げ + lazy 再エンリッチで吸収する。これによりキャッシュ恒久化（本項）は構造体化を待たずに先行リリースできる。

**Dexie スキーマ拡張案（v3）** — `src/infra/persistence/lexiaDb.ts:93-126` の `SCHEMA_VERSIONS` に追記（出荷済み v1/v2 は不変更）:

```ts
// SCHEMA_VERSIONS へ追加
{
  version: 3,
  stores: {
    // (c) 単語提案キャッシュ: setup 条件キーごとに 1 行
    suggestionCache: '[userId+suggestionKey], userId, updatedAt',
    // (g/TTS 先行定義) 合成音声・単語クリップの蓄積(TTS バックエンド実装後に使用)
    audioClips: '[userId+refType+refId+voiceId], userId, updatedAt',
  },
},
```

```ts
// 追加レコード型（lexiaDb.ts）
export interface SuggestionCacheRecord {
  userId: UserId;
  suggestionKey: string;            // routes.tsx:72 suggestionKeyFor(setup) と同一キー
  candidates: SuggestionCandidate[]; // wordSuggestionService の戻り値をそのまま
  updatedAt: string;                // ISO。TTL 判定用（既定 24h）
}
export interface AudioClipRecord {
  userId: UserId;
  refType: 'passage' | 'word';
  refId: string;                    // passageId または wordId
  voiceId: string;
  blob: Blob;                       // IndexedDB は Blob を直接格納可能
  updatedAt: string;
}
// 既存 WordCacheRecord（lexiaDb.ts:35-37）には非インデックス項目を追加（Dexie マイグレーション不要）:
//   schemaVersion?: number;        // WordData 契約の版数。非インデックス。undefined は v1 扱い
//   enrichmentPending?: boolean;   // 旧フォーマット由来。表示は可能、裏で再取得する
```

**実装計画**

(a)(a') 単語詳細の cache-first 化 + エラー UI:
- [ ] `routes.tsx:148-161` `loadAndCacheWordData` を改修: キャッシュヒット時は `wordDataNeedsRefresh` でも**即 return**（返却前に `enrichmentPending` 相当を判断）し、要更新分は fire-and-forget でバックグラウンド再取得 → `wordCache.put`。ネットワーク失敗時はキャッシュ値があればそれを返す（stale-if-error）。
- [ ] `routes.tsx:1237` を `useQuery({ queryKey: contentKeys.word(wordId), queryFn: () => loadAndCacheWordData(c, wordId), staleTime: Infinity })` に差し替え、書き込み専用 useEffect（routes.tsx:1245-1247）を削除。`contentQueries.ts:51-58` の `useWordData` は loader 注入型に変更するか、routes 側ローカルフックで置換。
- [ ] routes.tsx:1275-1285 の `!word` 分岐を loading / error に分割: `isError` 時は「単語情報の取得に失敗しました」+「再試行」（`refetch`）+「閉じる」を表示。
- [ ] 受け入れ基準: (1) 一度開いた単語の再オープンで `/api/words/` リクエストが 0 件（DevTools Network で確認）かつ表示まで体感即時。(2) リロード後も同様。(3) サーバ停止時、キャッシュ有→表示成功、キャッシュ無→エラー UI + 再試行ボタン。
- [ ] テスト: `loadAndCacheWordData` を fake repos + 呼び出し回数カウント付き fake gateway で単体テスト（ヒット時 0 回 / stale-if-error / バックグラウンド補完で put される）。

(b) 恒久キャッシュミスの解消 + schemaVersion 導入:
- [ ] `WordCacheRecord`（lexiaDb.ts:35-37）に非インデックス項目 `schemaVersion?: number` と `enrichmentPending?: boolean` を追加し、定数 `WORD_DATA_SCHEMA_VERSION = 1` を lexiaDb.ts に定義する。既存レコードは `undefined` = v1 として読む（Dexie マイグレーション不要）。
- [ ] routes.tsx:156 / 1246 の「needsRefresh なら put しない」を「常に put + `schemaVersion: WORD_DATA_SCHEMA_VERSION`、契約未達なら加えて `enrichmentPending: true`」へ変更。
- [ ] `loadAndCacheWordData` の読み出し側に版数ルールを実装: `record.schemaVersion ?? 1` が `WORD_DATA_SCHEMA_VERSION` 未満のレコードは、現行契約への持ち上げ（server/llm/providers.ts:494 `normalizeWordData` と同等の正規化をクライアント側 util として切り出し）を通して**即表示**し、裏で lazy 再エンリッチ → 現行版数で put する。Phase 3 の C-1/2/3（WordData 構造体化）実施時は `WORD_DATA_SCHEMA_VERSION` を 2 にバンプするだけで旧キャッシュが自動吸収される（roadmap D2）。これにより「スキーマ拡張が先・キャッシュ恒久化が後」という順序制約は不要になる。
- [ ] サーバ側恒久対策: `server/llm/schema.ts:186-188` の `noteJa` を非 null (`type: 'string'`) にし、プロンプト（schema.ts:573 付近の指示群）へ次を追記:
  > "The `memoryTips` (1-3 items) and `more.etymology.noteJa` fields are REQUIRED — never return null or omit them. Write `noteJa` and every `synonymNuances` entry in Japanese, explicitly connecting prefix/root/suffix to the target word's form and meaning."
- [ ] 受け入れ基準: (1) 契約を満たさない応答を返した単語でも 2 回目以降は即表示され、補完は非同期で行われる（毎回の LLM 再生成が消える）。(2) `schemaVersion` 無しの既存レコードが v1 として読まれ、表示・再エンリッチとも正常動作する。(3) `WORD_DATA_SCHEMA_VERSION` を仮に 2 へ上げたテストで、v1 レコードが即表示 + 裏で再取得 + put 後は版数 2 になる。
- [ ] テスト: fake repos で版数境界 3 ケース（undefined / 現行一致 / 現行未満）と enrichmentPending の付与・解除を単体テスト。

(c) ホーム候補のキャッシュ:
- [ ] Dexie v3 で `suggestionCache` を追加（上記スキーマ）。`src/infra/persistence/lexiaDb.test.ts` にマイグレーションテストを追記。
- [ ] routes.tsx:343-358 の `loadCandidates` を cache-first + SWR 化: `suggestionKeyFor(setup)`（routes.tsx:72）で get → ヒットすれば即表示、`updatedAt` が 24h 以内なら LLM 呼び出しをスキップ、超過時は表示したまま裏で `c.suggestions.suggest` → put。評定等で除外リストが変わりキーが変わった場合のみ同期取得。
- [ ] 候補リスト横に「候補を更新」ボタンを追加し、押下時のみ強制再取得（キャッシュ無視）。
- [ ] 受け入れ基準: 同一 setup でのホーム再訪時、suggest への LLM 呼び出し 0 回・候補は即表示。
- [ ] テスト: fake clock で TTL 境界、キー不一致時の再取得、強制更新の 3 ケース。

(d) 確認ゲート中キャラ絵の保存:
- [ ] routes.tsx:582 の `activeIllustrationRequest.current += 1` を confirm 時に実行しない（キャンセルはルート離脱時のみ）。イラスト到着コールバック（routes.tsx:468-487）を「pendingPlan があれば state 反映、confirm 済みなら `c.repos.stories` の該当 storyId レコードを put で追記更新」に変更。storyId は plan 生成時点で確定しているため可能。
- [ ] 受け入れ基準: イラスト完成前に「執筆開始」を押しても、完成画像が stories ストアに保存され、キャラ詳細ページ（routes.tsx:1197-1207）の自動再生成が発火しない。

(e) シーン挿絵の自動バックフィル:
- [ ] `src/state/session/sessionBootstrap.ts:65-80` `openPassage` 後に `meta.sceneIllustrationUrl` 欠落を検知したら、`generationController.ts:166-188` の `enrichPassageIllustration` をバックグラウンドで 1 回だけ起動（セッション内で passageId ごとに 1 回、失敗は無告知 degrade）。
- [ ] 受け入れ基準: 挿絵なしで保存された文章を開き直すと、閲覧中に挿絵が追補され Dexie に保存される。手動再生成ボタン（routes.tsx:862-900）は現状維持。

(f) 復習キューの遅延ロード:
- [ ] routes.tsx:996-1016 を再構成: キュー骨格は scheduling の due 列だけで即構築して 1 枚目を表示。WordData は「現在カード + 次カード」の 2 件だけ `loadAndCacheWordData` で先読みし、未着カードは項目内スケルトン表示。(a) の stale 許容により旧フォーマット語の評定ごと再取得も消える。
- [ ] 受け入れ基準: due 20 語・全て未キャッシュでも 1 秒以内に最初のカード枠が表示され、めくり操作が LLM 待ちでブロックされない。

(g) 付随整理:
- [ ] `src/types/domain.ts:411-412` の `illustrationUrl` に「生成経路未実装のプレースホルダ」doc コメントを追記する（削除は型の波及が大きく、単語イメージ生成を将来 E-1 のプロファイル上に載せる余地を残すため保持）。
- [ ] TTS はサーバルート実装（`/api/tts:synthesize`, `/api/tts/word`）が前提のため本テーマとは別チケットとし、本計画では v3 スキーマに `audioClips` テーブル定義のみ先行追加して受け皿を用意する（キー: `[userId+refType+refId+voiceId]`、格納は Blob）。
- [ ] （低優先・任意）サーバ側 WordData キャッシュ: WordData はユーザ非依存のため、`server/llm/handler.ts:136` の `getWordData` 前段に `wordId + スキーマ版数` キーのファイルキャッシュ（例: `server/cache/word-data/<wordId>.json`）を挟み、複数ブラウザ/プロファイル間でも初回生成を共有する。クライアント Dexie-first で大半は解決するため、効果測定後に判断する追加最適化と位置づける。

### 優先度と依存関係

| 順序 | 項目 | 優先度 | 依存 |
|---|---|---|---|
| 1 | E-3(a)(a')(b) 単語詳細 cache-first + エラー UI + 恒久ミス解消 + schemaVersion | 最優先（critical、体験・コスト両面の最大損失） | なし。routes.tsx / contentQueries.ts / lexiaDb.ts / schema.ts に閉じる。テーマ C（C-1/2/3 構造体化）との順序制約は schemaVersion 導入（roadmap D2）で解消済みのため先行リリース可 |
| 2 | E-3(f) 復習キュー遅延ロード | 高 | E-3(a) の `loadAndCacheWordData` 改修に乗る（直後に実施） |
| 3 | E-3(c) 候補キャッシュ + Dexie v3 マイグレーション | 高 | v3 追加は 1 回にまとめるため `audioClips` 先行定義（E-3(g)）と同時に行う |
| 4 | E-1 Grok 追加 + プロファイル切替 | 高（サーバ内で完結、E-3 と並行着手可能） | なし |
| 5 | E-3(d) キャラ絵破棄防止 | 中 | なし（E-1 完了後だと fast プロファイルで発生頻度自体も低下） |
| 6 | E-3(e) 挿絵バックフィル | 中 | E-1 推奨（fast プロファイルでバックフィルの費用/待ちが下がる）だが必須依存ではない |
| 7 | E-2 アイコン + manifest | 中（完全独立、いつでも実施可） | 生成 API で装飾版を作る場合のみ E-1 の quality プロファイル完成後が効率的 |

実装の骨子は「まず読み（cache-first）を直し、次に書き（v3 テーブル・画像保存）を増やし、最後にプロバイダの幅（E-1）と外装（E-2）を整える」順である。テーマ C との順序については、旧来の「WordData スキーマ拡張を先・キャッシュ恒久化を後」という制約は E-3(b) の `schemaVersion` 導入（roadmap D2）で不要になった: キャッシュ恒久化を先行させ、Phase 3 の C-1/2/3 構造体化時は `WORD_DATA_SCHEMA_VERSION` のバンプ + 読み出し時の normalizeWordData 相当の持ち上げ + lazy 再エンリッチで旧キャッシュを吸収する。E-3(a)(b) は 1 PR にまとめられる規模であり、これだけで学習セッション中の LLM 待ちの大半が消えるため、他項目に先行して単独リリースする価値がある。

---

## テーマF: 追加発見された問題

ユーザ既出テーマ（A〜E）の範囲外で、コードレビューにより新たに発見し、実コードで検証を通過した問題を学習体験への影響が大きい順に示す。末尾に影響の小さい項目（その他の小改善）と、検証枠から外れた未検証の参考問題を付す。

### F-1. APIキー未設定でも「時間をおいて再試行してください」と案内され、初回起動が行き止まりになる

**現状の問題**

サーバは APIキー未設定を自己診断し、`server/llm/providers.ts:79-86` の `requireKey` が `Generation API not configured: OPENAI_API_KEY is missing. Set it in .env.` という対処法込みのメッセージで 503 を throw し、`server/llm/handler.ts:176-177` がそれを `{ error: message }` としてレスポンスボディに載せている。しかしクライアントの `src/infra/content/contentGatewayHttp.ts:127-129` は `!response.ok` のときボディを一切読まず、ステータスコードだけで `ContentGatewayError` を作る（メッセージは同 137-139 の `fail()` で `request failed (503)` に固定）。さらに UI 側 `src/ui/app/routes.tsx:201-211` の `generationErrorMessage` は `error.message` をどの分岐でも表示せず、503→`unavailable` は 208 行で「生成サービスに接続できませんでした。時間をおいて再試行してください。」に丸められる。つまり診断情報が二重に破棄されている。`requireKey` は `callModel`（providers.ts:115）経由で生成・単語データ・提案・物語・注釈の全エンドポイントに効くため、初回セットアップで .env 未設定のユーザは全機能が同じ汎用文言で失敗し、何度待って再試行しても直らない。提案 API も汎用文言（routes.tsx:104-105）、単語データ失敗は無言フォールバック（routes.tsx:182-184, 193-195）である。加えて `providers.ts:94-97` の `mapUpstreamStatus` が上流の認証エラー・過負荷・5xx をすべて 503 に畳むため、「設定不備」と「一時障害」の区別はサーバ段階でも消失している。

**あるべき姿**

キー未設定で生成を実行したら、「生成サーバの API キーが未設定です。`server/.env` に `OPENAI_API_KEY` を設定してサーバを再起動してください」という原因と対処手順が画面に表示される。レート制限・一時障害・設定不備が異なる文言で区別され、設定完了後は再試行ボタン一つで復帰できる。さらに起動時にヘルスチェックで設定不備を検知し、生成を試みる前に設定画面へバナーで警告する。

**改善の方向性**

選択肢は (a) エラーボディの `error` 文字列をそのまま UI に伝搬する最小修正、(b) machine-readable なエラーコード体系を導入して kind を拡張する、の 2 案。(a) はサーバの英語メッセージが UI に生で出る・文言判定が脆いという欠点があるため、**(b) を推奨**する。サーバが `code: 'not_configured' | 'rate_limited' | 'upstream_auth' | 'upstream_error'` を返し、クライアントの `ContentGatewayErrorKind` に `not_configured` を追加、UI は kind ベースで日本語の対処文言を出す。あわせて `GET /api/health` を追加して起動時検知を行う。

**実装計画**

- [ ] `server/llm/handler.ts`: エラーレスポンスを `{ error: string, code: string }` に拡張。`ProviderError` に `code` フィールドを追加し、`providers.ts:83` の throw に `code: 'not_configured'` を付与。`mapUpstreamStatus`（providers.ts:94-97）を code 付与に改修（401/403→`upstream_auth`、その他→`upstream_error`）
- [ ] `server/llm/handler.ts` に `GET /api/health` を追加: `{ configured: boolean, provider: 'openai'|'anthropic' }` を返す（キー値そのものは返さない）
- [ ] `src/infra/content/contentGatewayHttp.ts` の `request()`: `!response.ok` 時に `response.json()` を try で読み、`body.code` があれば kind へマップ（`not_configured` を `ContentGatewayErrorKind` に追加）、`body.error` を `message` に格納。`kindForStatus` はフォールバックに降格
- [ ] `src/ui/app/routes.tsx` の `generationErrorMessage`（201-211）: `not_configured` 分岐を追加し「生成サーバの API キーが未設定です。server/.env に OPENAI_API_KEY（または ANTHROPIC_API_KEY）を設定してサーバを再起動してください。」を表示。`error.message` を「詳細」として折りたたみ表示
- [ ] 提案 API（routes.tsx:104-105）と単語データ取得の失敗（182-195）も同じ文言体系に統一。単語データの無言スワローは非ブロッキングのバナー表示に変更（読解は続行可能なまま）
- [ ] アプリ起動時（`src/main.tsx` の bootstrap またはホーム初回表示時）に `/api/health` を叩き、`configured: false` なら Setup 画面上部に常設の警告バナーを表示
- [ ] テスト: handler のエラーボディ code ユニットテスト、`contentGatewayHttp` のボディ解釈テスト（fetch モックで code あり/なし/非JSON ボディの 3 ケース）、`generationErrorMessage` の分岐テスト
- 受け入れ基準: キー未設定状態で生成実行→設定手順を含む文言が表示され「時間をおいて再試行」は出ない。429 は従来どおりレート制限文言。キー設定後の再試行で正常生成

### F-2. 読書位置が一切記録されず、「続きを読む」・進捗バー・保存位置復元が全面的に機能していない

**現状の問題**

`sessionStore.updateProgress(sentenceIndex)`（`src/state/stores/sessionStore.ts:67-71`）を読書中に呼ぶコードが存在しない。呼び出しは (a) 復元時の保存値再設定（`src/state/controllers/sessionBootstrap.ts:39,78`）と (b)「読了として記録」押下時の最終文一括セット（`src/ui/app/routes.tsx:776`）のみで、`src/ui/reading/ReadingScreen.tsx:93-94` は session から passage/activeWordId しか購読せず、スクロール・文単位の位置追跡も保存位置へのスクロール処理も皆無である。永続化（`progress.upsert`）も生成直後（`src/state/controllers/generationController.ts:122-124`、percent 0）・読了時（routes.tsx:778-779）・次章オープン時（routes.tsx:795-797）の 3 箇所だけ。結果として: ①ホーム CONTINUE カードの進捗バー（`src/ui/dashboard/DashboardScreen.tsx:165-173`）は生成時の 0% のまま動かない、②「保存位置へシーク」は store 更新のみで画面は常に先頭表示、③ライブラリ/URL から文章を開いても progress は書き込まれず `startedAt` は生成時刻のまま（sessionBootstrap.ts:74-75）のため、`dashboardProjector.ts:126-129` の `startedAt` 降順ソートは実質「最後に生成した未読了文章」を返し、ラベル「最近開いた文章」（DashboardScreen.tsx:157）と実態が乖離する。さらに `HomeScreen.tsx:93` と `routes.tsx:656` が CONTINUE の引数（passageId, sentenceIndex）を破棄し、resume（routes.tsx:603-604）は常に最新 in_progress を開く。

**あるべき姿**

読んでいる文の位置が自動追跡され、タブを閉じても保存される。翌日アプリを開くと CONTINUE カードに「昨日実際に読んでいた文章」が実進捗（例: 48%）付きで表示され、タップすると前回の文が画面中央に来た状態で再開する。「前回の位置から再開しました／先頭から読む」の選択も出る。毎朝 15 分の継続読書フローがワンタップで成立する。

**改善の方向性**

位置追跡の方式は (a) IntersectionObserver で可視文の最大 sentenceIndex を追跡、(b) スクロール率からの換算、(c) 明示的な「ここまで読んだ」ボタン、の 3 案。(b) は文との対応が不正確、(c) は学習者に操作負担を課すため、**(a) を推奨**する。永続化はデバウンス書き込み＋離脱時 flush。あわせて `ReadingProgress` に `lastOpenedAt` を追加し、CONTINUE のソートキーを「実際に開いた時刻」に切り替える。

**実装計画**

- [ ] `src/ui/reading/ReadingScreen.tsx`: 各文要素（grid は `sentence-row-N`、`src/ui/reading/PassageRenderer.tsx:505`。prose は文 span）に IntersectionObserver を張り、ビューポートを通過した最大 sentenceIndex を `session.updateProgress` に反映するフック `useSentenceTracking` を新設
- [ ] 永続化フック `useReadingProgressPersistence`（wiring 層）: sentenceIndex 変化を 3 秒デバウンスで `c.repos.progress.upsert`、`visibilitychange`/`pagehide` で即時 flush
- [ ] `src/types/domain.ts` の `ReadingProgress` に `lastOpenedAt: number` を追加し、`src/infra/persistence/lexiaDb.ts` をマイグレーション（既存レコードは `startedAt` で埋める）。`openPassage`（sessionBootstrap.ts:65-80）と `restoreReadingSession`（同 29-41）で `lastOpenedAt = now` を upsert する（現状は読み取りのみで書き込みゼロ）
- [ ] `src/domain/dashboard/dashboardProjector.ts:128` のソートを `lastOpenedAt` 降順に変更
- [ ] 復元スクロール: ReadingScreen マウント時に `progress.sentenceIndex > 0` なら該当行へ `scrollIntoView({ block: 'center' })` し、「前回の位置から再開しました」スナックバー＋「先頭から読む」リンクを表示
- [ ] `src/ui/home/HomeScreen.tsx:26,93` の `onContinue` シグネチャを `(passageId: string, sentenceIndex: number) => void` に修正し、`routes.tsx:656` は受け取った passageId で `openPassage` する（「押したカードと違う文章が開く」潜在バグの同時解消）
- [ ] テスト: sessionStore の updateProgress/pct ユニットは既存流用。IntersectionObserver はモックしたコンポーネントテストで「行通過→updateProgress 呼び出し」を検証。projector は lastOpenedAt ソートのユニット追加。e2e に「10 文目まで読む→リロード→10 文目付近表示・バー約 50%」シナリオ追加
- 受け入れ基準: 20 文の文章を 10 文目までスクロールしタブを閉じて再訪→10 文目付近が表示され CONTINUE バーが約 50%。ライブラリから昨日の文章を開いた後、ホームの CONTINUE 先頭がその文章になる

### F-3. streak・学習活動の記録が「評定 or 読了ボタン押下」だけに依存し、実際の学習行動を反映しない

**現状の問題**

streak と週間活動は `src/domain/dashboard/dashboardProjector.ts:99-122` で ReviewLog の存在日のみから算出される。ReviewLog を書くのは `src/state/controllers/reviewController.ts:42`（評定）と `src/state/controllers/recallController.ts:45`（読了ボタン→read_through）の 2 箇所だけで、文章の生成・読解・単語閲覧はログを残さない（generationController.ts:83-133 は reviewLog 非依存）。そのため「読了として記録」を押し忘れた日は真面目に読んでいても streak が 0 に戻る。付随する歪みが 2 つある: ①読解中の「知らなかった」は `applyReviewRating(rating=1)` 経由（routes.tsx:728-736, 1265-1273）で `source='review'` として記録され、復習実績と読書中マークが指標上区別できない。②単語タップを記録する `'lookup'` シグナルは型（`src/types/domain.ts:599`）とドメイン処理（`src/domain/srs/recallEventService.ts:47`）が実装済みなのに UI から dispatch する箇所がゼロで、設計と実装が乖離している。

**あるべき姿**

文章を開いて読んだ日・単語を調べた日も「学習した日」として streak が継続する。週間チャートは復習由来と読解由来を色分けし、「今週は読書ばかりで復習が薄い」といった自己認識に使える。streak は理不尽なペナルティではなく行動の正確な鏡になる。

**改善の方向性**

(a) 汎用 ActivityLog テーブルを新設して全行動を記録する案と、(b) 既存データソース（ReviewLog＋F-2 で導入する `ReadingProgress.lastOpenedAt`＋passage の `createdAt`）を projector 側で合成する案を比較すると、(b) はスキーマ追加が最小で過去データにも遡及適用できるため**第一段として (b) を推奨**。あわせて lookup シグナルを UI に結線し、「知らなかった」の記録系統を `source='passage'` に是正する。

**実装計画**

- [ ] `dashboardProjector.ts` の `DashboardInput` を用い、`activeDays` の構築（99-105 行）に `progress[].lastOpenedAt` と `passages[].createdAt` の日付も追加する（ReviewLog 単独依存の解消）
- [ ] ReadingScreen の単語タップ（activeWord 設定時）で `applyRecallSignal({ kind: 'lookup', wordId, at })` を dispatch（recallController 経由。連打の重複計上は recallEventService 既存のクールダウンに委ねる）
- [ ] 「知らなかった」導線（routes.tsx:728-736, 1265-1273）を、SRS 効果（間隔リセット＝rating 1 相当）は維持したまま `ReviewLogEntry.source='passage'` で記録する専用関数 `markUnknownFromReading` に置き換え
- [ ] 週間チャート（DashboardScreen.tsx:178-203）の `reviewCount` を source 別 2 系列（復習/読解由来）の積み上げバーに変更
- [ ] テスト: projector ユニットに「評定ゼロ・読書のみの日で streak 継続」「lastOpenedAt のみの日が activeDays に入る」ケースを追加。recallController に lookup 記録テスト追加
- 受け入れ基準: 文章を開いて読んだだけの日（評定 0 件・読了ボタン未押下）でも翌日 streak が継続。「知らなかった」を 5 回押しても週間チャートの「復習」バーは増えない

### F-4. 日付境界・曜日・streak がすべて UTC 基準で、日本の学習者は朝 9 時まで「前日」扱いになる

**現状の問題**

日境界は `src/domain/dashboard/dashboardProjector.ts:70` の `startOfDay = Math.floor(t / DAY_MS) * DAY_MS`（UTC 深夜）で計算され、「今日中に期限」判定（92-96 行）・週間活動（106-110 行）・streak（112-122 行）のすべてに使われる。UI 側も `src/ui/dashboard/DashboardScreen.tsx:63-69` の `dueLabel` が `Math.floor(dueAt / DAY_MS)` と `getUTCMonth()/getUTCDate()`、196 行の週間チャート曜日が `getUTCDay()` を使う。JST では UTC 日境界＝朝 9 時なので、0:00〜8:59 の復習は前日バケットに計上され、streak が切れて見える・「今日/明日」ラベルが最大 9 時間ずれる・深夜帯は曜日ラベルが 1 日ずれる。

**あるべき姿**

深夜 1 時に復習してもその日の活動として計上され、streak が継続する。「今日が期限」の件数・曜日ラベルが学習者の体感の 1 日と常に一致する。

**改善の方向性**

(a) `Date#getFullYear/getMonth/getDate` でローカル TZ を直接使う案と、(b) projector に `tzOffsetMinutes` を注入してテスト決定性を保つ案があり、projector は純関数として設計されている（now を引数で受ける）ため**(b) を推奨**。`startOfDay(t, tzOffsetMs) = Math.floor((t + tzOffsetMs) / DAY_MS) * DAY_MS - tzOffsetMs` とし、既存テストは offset=0 で不変に保つ。

**実装計画**

- [ ] `dashboardProjector.ts`: `DashboardInput` に `tzOffsetMinutes?: number` を追加し、`startOfDay` を offset 対応版に変更。利用箇所（83-84, 102, 108 行）を一括更新
- [ ] 呼び出し側（`loadDashboardSnapshot`、routes.tsx:593-601 付近）で `-new Date().getTimezoneOffset()` を渡す
- [ ] `DashboardScreen.tsx:63-69` の `dueLabel` の日数差計算・日付表示、196 行の曜日ラベルをローカル API（`getMonth/getDate/getDay`）に変更
- [ ] SRS の「今日中に期限」判定（projector 内 `endOfToday`）が同じ境界を共有していることを確認するリグレッションテスト
- [ ] テスト: `tzOffsetMinutes=540`（JST）で「JST 7/5 0:30 の評定が 7/5 の活動に計上され streak 継続」「UTC 基準では前日になるケースの否定」をユニットで固定。既存テストは offset 未指定（=0）で全通過
- 受け入れ基準: `TZ=Asia/Tokyo` で深夜 0:30 に評定→ホームの streak が途切れず、週間チャートの当日バーに計上される

### F-5. バックアップ/エクスポート導線が存在せず、export 実装も文章・イラスト・単語解説を含まない

**現状の問題**

`JsonSyncAdapter`（`src/infra/sync/exportImport.ts:29-84`）は実装・テスト済みだが、`src/ui/app/container.ts:101,113` で生成・公開されるだけで、src/ui・src/state のどこからも `sync.export/import` を呼ぶ画面・ボタンが存在しない（grep で UI 参照ゼロ。Blob ダウンロードや file input のプリミティブ自体が UI に皆無、`src/ui/router.tsx:21-36` に設定/データ管理ルートもない）。しかも export 対象は scheduling/reviewLog/progress/settings のみ（exportImport.ts:32-48）で、本文＋挿絵 data URL を持つ passages、キャラ画像を持つ stories、単語解説キャッシュの wordCache が含まれない。全データは IndexedDB のみに存在する（`src/infra/persistence/lexiaDb.ts`）ため、ブラウザデータ消去・プロファイル変更で学習資産が全損するのにユーザに自衛手段がない。単語帳（`src/ui/wordbook/WordbookScreen.tsx:48-152`）にも CSV/Anki 出力はない。さらに画像は base64 data URL でレコードに直格納されており（lexiaDb.ts:6-10 の設計コメント、キャラ再生成のたびに plan 全体を書き直す routes.tsx:1123 等）、export に含めると肥大する構造問題も抱える。

**あるべき姿**

設定/データ管理画面から「バックアップをダウンロード」「バックアップから復元」がワンクリックででき、復元後は文章一覧・イラスト・単語帳・進捗・streak がすべて戻る。単語帳は CSV / Anki 向け TSV でエクスポートでき、既存の Anki 運用と併用できる。

**改善の方向性**

3 段階で進める。(1) 既存 adapter を UI に結線する導線追加（最小・即効）、(2) `SYNC_FORMAT_VERSION 2` で passages/stories/wordCache を export 対象に追加（画像除外オプション付き）、(3) 画像を Blob として `images` ストアに分離し参照キー化（E-3 の蓄積強化の基盤にもなる）。CSV 出力は Wordbook 画面に独立追加する。

**実装計画**

- [ ] `/settings`（データ管理タブ）ルートを `router.tsx` に追加。「エクスポート」: `c.sync.export(userId)` → `URL.createObjectURL` → `<a download="lexia-backup-YYYYMMDD.json">`。「インポート」: `<input type="file">` → 確認ダイアログ（上書き警告）→ `c.sync.import`
- [ ] `exportImport.ts`: `SYNC_FORMAT_VERSION = 2`。`SyncPayload` に `passages/stories/wordCache` を追加。`export(userId, { includeImages: boolean })` で false 時は `sceneIllustrationUrl`・キャラ `imageUrl` 等の data URL フィールドを null 化。`import` は formatVersion 1 も受理する後方互換分岐
- [ ] WordbookScreen に「CSV エクスポート」を追加。列: headword / 品詞 / meaningsJa（`;` 区切り）/ 例文 en / 例文 ja / mastery / dueAt（ISO）。Anki 用 TSV は front=headword、back=意味＋例文の 2 列
- [ ] （中期）lexiaDb バージョン +1: `images` テーブル（id, blob, mime）を新設し、passages/stories は imageId 参照に移行。マイグレーションで既存 data URL を Blob 化して移送、表示は `URL.createObjectURL`
- [ ] テスト: JsonSyncAdapter v2 のラウンドトリップ（export→別 userId へ import→全テーブル一致）、v1 payload の互換 import、画像除外時のフィールド null 化、CSV 生成のスナップショットテスト
- 受け入れ基準: 別ブラウザプロファイルで import 後に文章一覧・挿絵・単語帳・進捗・streak が復元される。画像除外 export のファイルサイズが画像込みの 1/10 以下（挿絵 3 枚以上保有時の目安）

### F-6. 注釈パスが出力上限 4000 トークンで無音全滅し、長文ほど「気づき」ゼロの読み物になる

**現状の問題**

注釈パスの出力上限は `server/llm/schema.ts:561-563` の `annotationMaxTokens = Math.min(4000, 500 + sentenceCount * 150)` で、約 24 文（300〜350 語）で頭打ちになる。一方 `ANNOTATION_SYSTEM` は全表現の網羅・必須カバレッジ・文毎 1-2 個の追加 cue を要求し（schema.ts:445-448, 479-487, 545-547）、日本語解説 20〜45 字×数十個は容易に 4000 トークンを超える。切り詰め時は `server/llm/providers.ts:845` の `if (stopReason === 'refusal' || stopReason === 'max_tokens') return [];` で**空配列**になり、クライアントも `src/domain/generation/generationOrchestrator.ts:162-164` で黙って劣化受理する。結果、400 語級の文章ではターゲット語・コロケーションの必須カバレッジを含む注釈が丸ごと消え、エラーも警告も出ないため学習者・開発者とも気づけない。memo.txt の長文要望（400 語以上）を実現するほど悪化する。

**あるべき姿**

長文でも全文に注釈が付き、後半の文にも気づき解説が分布する。仮に注釈生成が失敗しても、読み物ページに「注釈の生成に失敗しました」バナーと「注釈を再生成」ボタンが出て、学習者が待ち時間ゼロの本文読解を続けつつ注釈だけ復旧できる。

**改善の方向性**

(a) クランプ撤廃/上限引き上げ（16000）は 1 行修正で即効だが単一リクエストの遅延増と再発リスクが残る。(b) 文範囲を 20 文単位のチャンクに分割して並列注釈しマージする方式は安定性・レイテンシとも優れる。(c) max_tokens 時に途中まで parse できた cue を救済する。**推奨は (a) を即時ホットフィックス、(b)+(c) を本命**として段階導入。失敗の無音化解消（UI 通知＋再生成導線）は方式に関わらず必須。

**実装計画**

- [ ] 暫定: `schema.ts:562` を `Math.min(16000, 800 + sentenceCount * 200)` に変更（30 文で約 6800 トークン）
- [ ] `providers.ts` の `annotatePassage`: `sentenceCount > 20` の場合に文配列を 20 文単位に分割し、必須カバレッジ項目を該当チャンクに振り分けて並列呼び出し、結果を sentenceIndex そのままでマージ（絶対インデックスを保持させるため下記プロンプト追記）
- [ ] チャンク用に `ANNOTATION_SYSTEM` へ追記する文面案:
  > You will receive a CONTIGUOUS SLICE of a longer passage. The sentenceIndex values given are absolute indices within the full passage — copy them into your cues exactly as given, never renumber from zero. Annotate ONLY the sentences provided in this request; do not refer to or invent sentences outside the slice.
- [ ] `providers.ts:845` の全滅処理を部分救済に変更: `max_tokens` 時は応答テキストから最後に完結した cue オブジェクトまでを切り出して parse し、得られた cue を返す。救済発生をサーバログに warning 出力
- [ ] レスポンスに `annotationStatus: 'complete' | 'partial' | 'failed'` を含め、クライアント（generationOrchestrator.ts:162-164 の劣化受理箇所）で `passage.meta` に記録。ReadingScreen に partial/failed 時のバナー＋「注釈を再生成」ボタンを追加し、再実行結果を `replacePassage` で反映
- [ ] テスト: `annotationMaxTokens` の境界ユニット、チャンク分割/マージのユニット（カバレッジ振り分け・絶対インデックス保持）、不完全 JSON 救済のユニット（末尾途切れ入力）
- 受け入れ基準: 35 文・450 語の生成で cue が後半 15 文にも分布し、必須カバレッジが全件充足される。注釈 API を強制失敗させると読み物ページにバナーと再生成ボタンが表示され、再生成で cue が復元される

### F-7. デザイン指定の Web フォントが一切ロードされず、ほぼ全ユーザにフォールバックフォントで表示される

**現状の問題**

`src/ui/theme/tokens.ts:181-188` は英文本文に Newsreader（セリフ）、UI に IBM Plex Sans、日本語に Noto Sans/Serif JP を指定するが、フォントを読み込む仕組みが存在しない。`index.html:1-15` に `<link>` なし、`src/ui/theme/global.css`（全 348 行）に `@font-face` ゼロ、package.json にフォント依存ゼロ、public/ ディレクトリ自体が不存在で、本番ビルド `dist/assets/index-J3pyru48.css` にも `@font-face` はない。`src/ui/shared/AnnotatedSpan.tsx:38` には 'Newsreader' のハードコードまである。Newsreader / IBM Plex Sans がローカルにある環境はまれで、実際にはほぼ全ユーザが OS 既定フォントで閲覧しており、本文 19px セリフの読書体験・見出し階層・書体設計が丸ごと機能していない。視覚回帰（e2e/visual.spec.ts:36）のベースラインもフォールバックフォントで撮影されている。

**あるべき姿**

どの環境でも読解本文が Newsreader のセリフ体、UI が IBM Plex Sans、日本語が Noto ファミリーで描画され、tokens.ts のタイポグラフィ設計どおりの読書体験になる。オフラインでも表示が安定する。

**改善の方向性**

(a) Google Fonts の `<link>` は実装最小だが外部依存・オフライン不可・接続先増、(b) @fontsource によるセルフホスト同梱はオフライン・将来の PWA 化（リマインダ導入時）とも整合、(c) フォント指定自体を撤回。デザイン意図を活かすため**(b) を推奨**する。

**実装計画**

- [ ] `pnpm add @fontsource-variable/newsreader @fontsource/ibm-plex-sans @fontsource-variable/noto-sans-jp @fontsource-variable/noto-serif-jp`（IBM Plex Sans は 400/500/600/700 のみ import）
- [ ] `src/main.tsx` 冒頭で各 CSS を import（`@fontsource-variable/newsreader/index.css` 等）。`font-display: swap` になっていることを確認
- [ ] @fontsource-variable のファミリー名（例: 'Newsreader Variable'）と `tokens.ts:181-188` / `AnnotatedSpan.tsx:38` / `global.css:73` の指定名を一致させる（tokens 側を実ファミリー名に更新し、AnnotatedSpan のハードコードは tokens 参照に置換）
- [ ] `gallery.html` にも同じフォント読み込みを追加し、視覚回帰ベースラインを全面再生成
- [ ] バンドル増分を計測: 日本語可変フォントが unicode-range 分割で遅延ロードされることを確認し、初回クリティカルロード増分を gzip 後 +300KB 以内に収める（超える場合は Noto を weight 限定の静的版に変更）
- [ ] テスト: e2e に `document.fonts.check('19px "Newsreader Variable"')`（および Plex）が true になるアサーションを追加
- 受け入れ基準: フォント未インストールの CI コンテナで読解本文の computed font-family が Newsreader 系になり、視覚回帰スクリーンショットにセリフ体が写る

### F-8. 読解本文レイアウトの構造欠陥 — 和訳オフでも右 38% が空白列、段落構造が存在しない

**現状の問題**

二つの独立した欠陥がある。①`src/ui/reading/PassageRenderer.tsx:509` の grid は `gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)'` を translationMode に無関係に常時適用し、和訳オフ時（`src/ui/reading/SentenceTranslation.tsx:104` が `mode === 'off'` で null を返す）は右セルが空 div として残る。既定設定は和訳オフ（settingsStore.ts:107）なので、初見ユーザはワイド画面（ReadingScreen.tsx:233、maxWidth 960）で英文が約 575px に圧縮され、右に無意味な空白列を見る。②段落構造がデータに存在しない: `PassageOutput.sentences` はフラット配列（`src/types/domain.ts:215-221`）、生成スキーマにも段落フィールドがなく（`server/llm/schema.ts:80-107`）、grid は一律 `marginBottom: 14`（PassageRenderer.tsx:512）、prose は全文単一流し込み（531-541）。400 語の記事でも談話の切れ目が視覚化されず、長文読解の負荷を上げ、B-1 で文章の質を上げても表示で損なわれる。

**あるべき姿**

和訳オフでは英文が本文幅を全て使い、快適な行長で読める。文章は導入・展開・転換・結論の段落ごとに広い余白で区切られ、トピックの切れ目が一目で分かる。和訳オンにすると従来どおり文単位の 2 列対訳になる。

**改善の方向性**

①は表示層のみの修正: `translationMode === 'off'` のとき grid を 1 列に切り替え右セルを非描画にする（renderAside の他用途がないことを実装時に確認）。②は生成スキーマに文ごとの `paragraphIndex` を追加し、境界に大きめ余白を描画する。既存保存済み passage は `paragraphIndex` なしでも従来表示にフォールバックさせ、マイグレーション不要とする。

**実装計画**

- [ ] `PassageRenderer` に `asideEnabled: boolean` prop を追加。false 時は `gridTemplateColumns: 'minmax(0, 1fr)'`・aside セル非描画。ReadingScreen から `translationMode !== 'off'` を渡す
- [ ] `schema.ts:80-107` の sentence オブジェクトに `"paragraphIndex": { "type": "integer" }` を追加（required に含める）。`src/types/domain.ts` の文型に `paragraphIndex?: number` を追加
- [ ] `PASSAGE_SYSTEM` への追記文面案:
  > Structure the passage into natural paragraphs of 2-5 sentences each, following the discourse flow (introduction, development, turn, conclusion). Set "paragraphIndex" on every sentence, starting at 0 and incrementing by 1 at each paragraph break. Never put every sentence in its own paragraph, and never return more than 6 sentences as a single paragraph.
- [ ] grid レイアウト: 次文の `paragraphIndex` が変わる行の `marginBottom` を 14→28 に。prose レイアウト: 段落ごとに `<p>`（margin 1em）で分割。`paragraphIndex` 欠落データは全文 1 段落として従来描画
- [ ] テスト: PassageRenderer のユニット（asideEnabled false で 1 列・aside 不在、段落境界行の余白 28、paragraphIndex 欠落時のフォールバック）。生成側は schema バリデーションテストに paragraphIndex の存在・単調非減少チェックを追加
- 受け入れ基準: 和訳オフで `sentence-row` が 1 列になり英文セルがコンテナ幅一杯になる（e2e で幅アサーション）。30 文の新規生成で段落が 4 個以上構成され、grid 表示に段落間の広い余白が現れる

### F-9. その他の小改善（検証済み・影響小）

いずれもコード検証済みだが単独の影響が小さいため、現状と改善案を簡潔に示す。

- **目標レベル既定値でゲート素通り**: `src/state/stores/settingsStore.ts:23-31` の `DEFAULT_SETUP.examTarget={eiken,'2'}` により必須選択ゲート（SetupScreen.tsx:104-109）が初回から無効。→ 初回は `examTarget: undefined` で起動し「目標レベルを選ぶと生成できます」を実際に機能させる。`DEFAULT_EXAM` の重複定義（SetupScreen.tsx:64）を settingsStore 側へ一本化
- **手動追加語の正規化なし**: SetupScreen.tsx:185-191 は trim と case-sensitive includes のみで、実装済みの `normalizeSelection`（`src/domain/suggestion/wordSuggestionService.ts:53-63`）が UI 未使用。→ `commitAdd` で lowercase/trim/dedupe/単一語チェックを適用し、複数語・非英字入力は警告表示
- **「前回と同じ条件で再生成」導線なし**: SetupScreen.tsx:253-542 は 8 セクション縦積みで生成ボタンが最下部（536-538）。→ カード冒頭に「前回の条件でもう一度生成」プライマリボタンを追加し、高度設定・ジャンルはアコーディオン化、生成ボタンを sticky 化
- **WordData.illustrationUrl/audioUrl が死にフィールド**: `src/types/domain.ts:411-412` と表示ブロック（WordDetailCard.tsx:240-244）があるが生成経路が存在しない（WORD_DATA_JSON_SCHEMA に両フィールドなし）。→ E-3 のキャッシュ設計と同時に単語イラスト生成エンドポイントを追加して wordCache に蓄積するか、フィールドと表示ブロックを削除して契約を正直にする
- **単語データ生成がレベル・趣向非考慮**: `server/llm/schema.ts:592-597` の buildWordMessages は wordId のみ。→ `GET /api/words/:id?level=B1&intent=business` を追加し、プロンプトに "Write examples[].en within CEFR ${level}±1 vocabulary. Prefer usage scenes matching the learner's focus (${intent}) when natural." を追記。キャッシュキーはレベル帯（A 帯/B 帯/C 帯）単位
- **和訳「文ごと」モードに一括開閉なし**: SentenceTranslation.tsx:108-131 は文数分の同一ボタンが並び、開閉状態はローカル state。→ ツールバーに「すべて開く/閉じる」を追加し、開閉 state を ReadingScreen へリフトしてセッション内保持
- **「知らなかった」1 件処理中に全カード disable**: ReadingGuideRail.tsx:290-291,346,464 で単一 `markingUnknownId` により全ボタン無効化。→ disable を同一 targetId のボタンに限定し楽観的更新＋失敗時ロールバック
- **単語詳細が URL アドレサブルでない**: router.tsx:21-36 に単語ルートなし、WordDetailRoute（routes.tsx:1235-1295）はオーバーレイ専用。→ `/w/:wordId` ルートを追加。**D-5（ホームからのジャンプ）と E-3（解説キャッシュ再訪）の前提基盤**
- **404/errorElement なし**: router.tsx:21-36 に catch-all がなく、未知 URL で react-router 既定の英語エラー画面。→ `path: '*'` の日本語 404（ホームへ戻るリンク付き、routes.tsx:1325-1343 の notFoundStyle とトーン統一）と errorElement を追加
- **アバター「K」がダミー**: AppShell.tsx:80-96 は aria-hidden の固定文字でクリック不可、設定画面自体が不存在。→ F-5 で新設する /settings への入口メニュー（名前・既定音声/速度・プロバイダ選択=E-1・データ管理）にする
- **週間チャート含む full ダッシュボードが到達不能**: DashboardScreen.tsx:178-203,258-277 は layout='full' 専用だがアプリ内利用は HomeScreen.tsx:88-95 の rail のみ。→ `/dashboard` ルートを追加して TopNav から到達可能にする（C-5 の進捗可視化方針と併せて配置決定）
- **レビュー画面が全単語の WordData 取得完了までブロック**: routes.tsx:996-1016 が Promise.all＋全件解決までスケルトン。→ scheduling state だけで即キュー表示し、WordData はカード表示時に遅延ロード（未取得はカード内スピナー）
- **NoticeRail/StudyWordsList のデッドコード二重実装**: NoticeRail.tsx（275 行）は本体から未参照でテストのみ維持、正しいアフォーダンス実装（cursor/title/keydown 停止、NoticeRail.tsx:114,120,182）が死にコード側にある。→ 良い挙動を ReadingGuideRail へ移植後、NoticeRail/StudyWordsList 本体と対応テストを削除し `studyWordLabel` は共有ユーティリティへ移動
- **視覚回帰ベースラインの陳腐化**: e2e/visual.spec.ts-snapshots が現行 ReadingGuideRail の番号丸（321,449 行）を含まない古い出力で撮影されており、崩れ検知として機能していない。→ F-7 のフォント導入後にベースラインを全面再生成し、CI で visual テストを必須化。崩れが写った画像を基準にしない運用ルールを明文化

### F-10. 未検証の参考問題（コード検証枠外・掲載時は要再確認）

以下は重要度低のため検証枠から外れた**未検証**の指摘である。実装前に個別のコード確認を要する。

- 学習リマインダ・通知（PWA/Web Push）が皆無で、SRS の「期限どおりに戻る」前提をアプリ外から支える手段がない（index.html にmanifest なし、vite.config.ts に PWA プラグインなし）
- 起動処理（src/main.tsx:20-48）に catch もフォールバック UI もなく、IndexedDB 不可環境で白画面のまま
- モバイル視覚回帰・E2E が実アプリの崩れを検知できない（gallery 静的モック撮影、review/setup ベースラインが旧デザイン）
- TopNav に復習 due バッジがなく、ホーム以外で今日の残タスクが見えない
- 習熟度の視覚エンコード（#C4CCD6 下線=1.62:1 等）が非テキスト基準 3:1 を下回り判別困難／文字サイズ変更が英文のみ・全 UI px 直指定／開閉トグルに aria-expanded なし（いずれも D 系のアクセシビリティ改修に合流させるべき項目）
- iOS Safari で 16px 未満の input/select がフォーカス時自動ズームを誘発（SetupScreen・Wordbook の各入力）
- 読解画面モバイルヘッダの戻るが `navigate(-1)` 固定で、直リンク・リロード直後にアプリ外へ飛ぶ
- 単語帳検索が headword＋第一義のみ対象で、第二義・コロケーションから逆引き不可
- 単発記事のトピック自由指定がない（固定 6 インテント）／「英検/TOEIC」が題材と難易度基準の二重の意味で登場し説明がない（A 系改修に合流）
- HomeScreen の onContinue 引数破棄（F-2 の実装計画に修正を織り込み済み）

### 優先度と依存関係

実装は 4 段階に分ける。段階内は並行可能、段階間は依存に従う。

**第 1 段（即時・独立ホットフィックス）** — 相互依存なし、各 1 PR で完結:
1. F-1 エラー伝搬と not_configured 表示（初回セットアップの詰み解消。全テーマの動作確認の前提として最優先）
2. F-6 暫定（annotationMaxTokens 引き上げ 1 行＋失敗バナー）
3. F-8① 和訳オフ時の 1 列化（表示層のみ）
4. F-7 フォント導入 → 完了後に F-9 の視覚回帰ベースライン再生成を続けて実施（フォント変更が全スクリーンショットを無効化するため、この順序が必須）

**第 2 段（読書・活動トラッキングの中核。順序依存あり）**:
5. F-2 読書位置トラッキング＋`lastOpenedAt` 導入（DB マイグレーションを含む基盤）
6. F-3 活動日合成・lookup 結線・source 是正 — **F-2 の `lastOpenedAt` に依存**
7. F-4 タイムゾーン対応 — F-3 と同じく dashboardProjector を改修するため、**F-3 と同一 PR または直後に実施**して二重改修を回避

**第 3 段（データ資産の保全と品質本命）**:
8. F-5 バックアップ UI 結線 → export v2 → 画像 Blob 分離の順に段階実施。画像分離は **E-3（イラスト蓄積）の基盤**なので E-3 着手前に完了させる
9. F-6 本命（チャンク分割注釈＋部分救済）— テーマ B/C の注釈プロンプト改修（C-1/C-4）と同時期に実施すると再検証が 1 回で済む
10. F-8② 段落構造 — 生成スキーマ変更を伴うため、**B-1/B-2 のプロンプト全面改修と同一バッチ**で実施し、スキーマ変更・再生成検証を一度にまとめる

**第 4 段（小改善・随時）**:
11. F-9 のうち `/w/:wordId` ルート追加は **D-5・E-3 の前提**なので両テーマ着手前に先行実施。/settings 新設（F-5 と共用）→ アバター入口・E-1 プロバイダ切替の順で積む。残り（正規化・一括開閉・404・デッドコード削除等）は独立タスクとして空き枠で消化

クリティカルパスは「F-1 → F-2 → F-3/F-4」（詰み解消→中核フロー復旧→指標の信頼回復）であり、この 3 段が完了して初めて streak・CONTINUE・進捗バーという継続動機づけの装置一式が学習者の実態を映すようになる。

---

## 実装ロードマップ

本ロードマップはテーマ A〜F の全 45 項目強を、(1) 優先度マトリクス、(2) 3 フェーズ、(3) 横断リスク・先行設計判断、(4) フェーズ別検証、の 4 部で統合する。最重要の統合判断は 2 点である。**第一**に、テーマ A（A-1-2/A-1-3）とテーマ C（C-5b）は同一箇所（`src/state/controllers/newState.ts:21` の `dueAt: 0` シードと `src/domain/suggestion/wordSuggestionService.ts:90-108` の due 判定）を別方針で改修する計画になっており、単一ワークストリーム「SRS due 再設計」に統合しないと二重マイグレーション・仕様の往復が発生する。**第二**に、生成/注釈プロンプト（`server/llm/schema.ts` 874 行）とパッセージスキーマの変更は B-1/B-2/B-3/C-1/C-4/F-6/F-8②/A-3-1/D-1(cue密度) の 9 項目が触るため、**2 バッチに集約**して LLM 出力の再検証を各 1 回で済ませる。

---

### 1. 優先度マトリクス（学習効果インパクト × 実装コスト）

配置基準: インパクトは「学習ループの成立・継続動機・語彙定着への直接寄与」、コストは「変更ファイル数・スキーマ/マイグレーション有無・LLM 再検証の要否」。

| | **実装コスト: 低** | **実装コスト: 中** | **実装コスト: 高** |
|---|---|---|---|
| **インパクト: 高** | **F-1**(APIキーエラー顕在化) / **A-1-2**(dueAt=0廃止) / **A-2-1**(リセット完全化※A-1-1と同時) / **B-5第1弾**(max_completion_tokens・temperature・適応リトライ) / **F-6暫定**(注釈上限引上げ+失敗バナー) / **C-5a**(学習方針文書) | **A-1-3**(復習/新出二枠化) / **A-1-1**(プリフィル廃止・生成時自動選択) / **E-3(a)(b)(f)**(単語カード cache-first・恒久ミス解消・復習遅延ロード) / **C-5b**(due定義一本化) / **C-5d**(lookup配線・suspended) / **F-2**(読書位置) / **F-3**(活動記録) / **B-4**(CEFR語彙ゲート復旧) / **D-7**(生成進捗・タイムアウト) / **D-6**(モバイル破綻) / **B-5第2弾**(チャンク生成) / **F-6本命**(チャンク注釈) | **B-1+B-2**(イディオム/定型表現の織り込み+検証) / **C-5c**(復習セッション是正) / **D-1**(右レール構造修正) / **C-2**(語源形態素分解・意味ネットワーク) |
| **インパクト: 中** | **A-1-4**(続き章の単語再選択) / **A-2-2**(リセット仕様明文化) / **F-4**(タイムゾーン) / **F-7**(Webフォント) / **F-8①**(和訳オフ1列化) / **D-2**(視覚言語・keydown復旧) / **D-4第1段**(サムネイル一覧) / **D-5**(ホーム→単語カード) / **F-5第1段**(バックアップUI結線) | **A-3-1**(難易度サブバンド) / **A-3-2**(単語帳→生成導線) / **C-1**(イディオム由来) / **C-3**(コロケーション構造化) / **D-3**(単語帳ソート・件数) / **D-8**(ModalOverlay・Toast・コントラスト) / **E-1**(Grok+品質/速度プロファイル) / **E-3(c)(d)(e)**(候補キャッシュ・キャラ絵保存・挿絵バックフィル) / **F-5第2-3段**(export v2・画像Blob分離) / **F-8②**(段落構造) | **B-3**(構文複雑度+syntaxSpans) / **C-4**(構文解説UI) |
| **インパクト: 低** | **A-2-3**(除外語可視化) / **A-2-4**(チップ操作可視化) / **A-3-3**(CEFR試験級併記) / **E-2**(アプリアイコン) / **F-9**(小改善群※`/w/:wordId` のみ先行) | — | — |

読み方: 高×低 = Phase 1 の即実施。高×中 = Phase 1 末尾〜Phase 2 の主戦場。高×高 = Phase 2 の中核（基盤整備後に着手）。中×高（B-3/C-4）は Phase 3。低×低は各フェーズの隙間で消化する。

---

### 2. フェーズ分け

#### Phase 1: 即効性の高い修正（目安 2〜3 週間）— 「詰み・洪水・無音失敗」の解消と計測下地

学習ループを壊している critical 級を独立 PR で連射する段階。すべて相互依存が薄く並行可能だが、**F-1 を最初**（以後の全動作確認の前提）、**F-7→visual baseline 再生成を最後**（全スクリーンショットを無効化するため）に置く。

| # | 項目 | 内容の要点 | 依存 |
|---|---|---|---|
| 1-1 | **F-1** | エラーコード体系（`not_configured` 等）+ `/api/health`。`server/llm/providers.ts:79-86` の診断が `src/infra/content/contentGatewayHttp.ts:127-129` と `src/ui/app/routes.tsx:201-211` で二重破棄される問題の解消 | なし（最優先） |
| 1-2 | **A-1-2** | `src/state/controllers/newState.ts:21` の `dueAt: 0` シード廃止（now+1日）+ Dexie 一次マイグレーション。**設計判断 D1 に従い、C-5b で導入する `isDueForReview` と矛盾しない形で実装**（下記 §3） | D1 確定後 |
| 1-3 | **A-1-3** | `targetWordPlanFor` 新設と提案の二枠化（`src/domain/suggestion/wordSuggestionService.ts:33-36,70-71,108` の修正）。ratio 0% 候補ゼロ問題の解消 | 1-2 |
| 1-4 | **B-5 第1弾** | `max_tokens`→`max_completion_tokens`（`server/llm/providers.ts:142`）、タスク別 temperature/モデル env、max_tokens 時の語数縮退リトライ（`generationOrchestrator.ts:181-185`）。チャンク分割は Phase 2 へ | なし |
| 1-5 | **F-6 暫定** | `server/llm/schema.ts:561-563` の注釈上限引上げ + `annotationStatus` 記録 + 失敗バナー/再生成ボタン | なし |
| 1-6 | **E-3(a)(a')(b)+(f)** | 単語カードを `loadAndCacheWordData`（`routes.tsx:148-161`）に統一、エラー UI 追加、「needsRefresh なら put しない」ループ解消（**設計判断 D2 の schemaVersion/enrichmentPending をこの時点で導入**）。続けて復習キュー遅延ロード（`routes.tsx:996-1016`） | D2 確定後 |
| 1-7 | **D 第1波** | D-2 最小修正（keydown stopPropagation・cursor 復旧）、D-7 の ScrollRestoration + `/p/:id` スケルトン、D-3 の 0 語フラッシュ修正、F-8①（和訳オフ 1 列化、`PassageRenderer.tsx:509`） | なし |
| 1-8 | **F-9 先行分** | `/w/:wordId` ルート新設（**D-5・E-3 の前提基盤**）+ 404/errorElement | なし |
| 1-9 | **C-5a** | `docs/learning-policy.md` 制定（Phase 2 全体の仕様となるため Phase 1 内で確定必須）。定数突合テスト付き | なし |
| 1-10 | **F-7 + baseline** | @fontsource セルフホスト導入 → visual スナップショット全面再生成。**E-2（アイコン+manifest）も独立作業としてここで消化可** | 1-7 完了後に撮影 |

**Phase 1 完了条件**: (1) APIキー未設定で対処手順込みの文言が出る（「時間をおいて再試行」が出ない）。(2) 生成直後に /review・「今日の復習」件数が増えず、2 回目の生成で新出語が計画数どおり提案される。(3) 一度開いた単語の再表示で `/api/words/` リクエスト 0 件（リロード後・サーバ停止時も表示可）。(4) 35 文の生成で注釈が後半文にも分布、または失敗が可視化される。(5) 新系列モデル名で 400 にならない。(6) visual baseline がセリフ体で再撮影済み。

#### Phase 2: 学習体験の中核改善（目安 6〜8 週間）— 4 ストリーム並行

**ストリーム α: 学習ループ/SRS の正準化（C-5 系 + F-2/F-3/F-4）**
- 順序: **F-2**（読書位置 + `ReadingProgress.lastOpenedAt` マイグレーション）→ **C-5b**（`isDueForReview` 述語の新設と sessionPlanner/dashboardProjector/wordSuggestionService の三点統一、`suspended` フラグ、シード語への level 付与）→ **C-5c**（復習セッション是正: reveal ガード・セッション内再出題・Undo・完了画面・キュー凍結）→ **C-5d**（lookup 配線・クールダウン横断化 `recallEventService.ts:43`・読了フィードバック・既知語申告）→ **F-3**（activeDays 合成・source 是正。**F-2 の lastOpenedAt に依存**）→ **F-4**（TZ 対応。**F-3 と同一 PR** で dashboardProjector の二重改修を回避）。
- C-5c の Undo と D-8 の Undo トーストは**同一機構**（reviewController に 1 回だけ実装）。

**ストリーム β: 生成の設定・制御（A 主鎖 + D-7）**
- 順序: **A-1-1 + A-2-1**（同一 PR。プリフィル廃止・`targetWordIds`=手動語のみ・リセット完全化。自動選択の計画数は Phase 1 の `targetWordPlanFor` を使用）→ **A-1-4**（続き章の単語再選択）/ **A-2-2**（検証と文言）/ **A-3-2**（単語帳→生成導線。`/w/:wordId` と location.state 注入）。
- **D-7 本命**（generationProgressStore・AbortSignal・進捗パネル・完了トースト）は A-1-1 と同じ SetupScreen/routes を触るため同時期にまとめる。

**ストリーム γ: 生成品質バッチ1（B 系）**
- **B-4**（CEFR 辞書。`src/ui/app/container.ts:57` の seam 既定値注入で `main.tsx` 無変更）は独立・並行。B-1〜B-3 の受け入れ測定の計測基盤なので**バッチ1 より先に完了**させる。
- **プロンプト/スキーマ バッチ1**: B-1+B-2（expressionSpans・クォータ・バリデータ・`isShippableResidual`）+ **F-8②**（paragraphIndex）+ **A-3-1**（levelDetail の passageUser 注入）+ **D-1 保険の cue 密度上限** を同一バッチで実施。SpanViolationKind（`passageValidator.ts:20-29`）と REPAIR_HINT（`generationOrchestrator.ts:66-79`）は必ず対で追加。**collocationId 照合は設計判断 D4 の「id ⇄ 旧文字列フォールバック」契約で実装**し、Phase 3 の C-3 構造化と互換にする。
- **B-5 第2弾**（1600 語超のチャンク分割生成 → `LENGTH_WORD_TOLERANCE` 0.6→0.25 復元、`lengthSpec.ts:22`）。

**ストリーム δ: 読解 UI（D 系）**
- 順序: **D-8 基盤**（ModalOverlay・Toast・コントラスト検証付きトークン）→ **D-1**（座標系統一→grid/幅制約→再計測→コンパクト化→ブレークポイント統一→モバイルポップオーバー）→ **D-5**（ホーム due 行→単語カード。ModalOverlay と `/w/:wordId` 前提）→ **D-6**（モバイル一式。D-1 のブレークポイント統一後）。
- **F-5 第1段**（バックアップ UI 結線）はストリーム末尾までに必ず実施 — **Phase 2/3 でマイグレーションが積み上がる前にユーザへ退避手段を提供する**（リスク R3）。

**Phase 2 完了条件**: (1) ホームの「今日の復習 N 語」と /review 開始枚数が一致し、未 reveal 評定が不可能、Again 語がセッション内再出題される。(2) 読解中の単語タップが lookup として記録され、読了時に二重クレジットされない。(3) 初回ホームで suggest API が呼ばれず、手動追加語は必ず織り込まれる。(4) 実生成サンプル 10 本で expressionSpans 平均 ≥ クォータ・collocationId 100% supplied 由来・語数 ±25% を 8 本以上が満たす。(5) 1280px で全ガイドカードの行揃え誤差 ≤12px、モバイルでバッジタップ後のスクロール変化 ≤50px。(6) 評定ゼロ・読書のみの日でも streak 継続、JST 深夜評定が当日に計上。(7) 生成中に他画面へ移動しても完了トースト/エラーが表示される。

#### Phase 3: 基盤・拡張（目安 6 週間〜）— データ資産の深化と外装

| # | 項目 | 内容の要点 | 依存 |
|---|---|---|---|
| 3-1 | **C-1 + C-2 + C-3** | WordData 構造体化を**必ず 1 マイルストーンで一括実施**（IdiomEntry / EtymologyV2 / CollocationEntry / SemanticNeighbor）。normalizeWordData の旧形式持ち上げ + wordCache schemaVersion バンプ（Phase 1 の D2 基盤の上で lazy 再エンリッチ） | E-3(a)(b) の schemaVersion（Phase 1）、D4 の id 契約（Phase 2） |
| 3-2 | **プロンプト/スキーマ バッチ2** | **B-3**（syntaxSpans・文長帯検査）→ **C-4**（sentenceNotes・不連続スパン・findRun 上限撤廃 `providers.ts:306-317`）+ **C-1 注釈側 detailJa** + **F-6 本命**（20 文チャンク注釈+部分救済）を同時期に。B-3 完了が C-4 着手の依存条件 | バッチ1 の自己申告スパン基盤 |
| 3-3 | **E-1** | 画像プロバイダ記述子テーブル + Grok 追加 + fast/quality プロファイル。**B-5 のタスク別モデル env と providers.ts の設計を共通化**（設計判断 D8） | なし（並行可） |
| 3-4 | **F-5 第2-3段 → E-3(d)(e) → D-4 第2段** | export v2（passages/stories/wordCache）→ 画像 Blob 分離（images テーブル）→ キャラ絵保存・挿絵バックフィル → sceneThumbnailUrl。**画像保存形式（D7）を先に確定し、この順で 1 本化** | F-5 第1段、E-1 推奨 |
| 3-5 | **E-3(c)** | 候補キャッシュ（suggestionCache + audioClips 先行定義の Dexie 追加）。**A-1-1 でマウント時 suggest が消えるため、「プレビュー + 生成時自動選択」の共有キャッシュとして仕様を再評価してから実装** | A-1-1 |
| 3-6 | **仕上げ群** | A-2-3 / A-2-4 / A-3-3（SetupScreen レイアウト確定後）、D-3 / D-4 第1段、D-8 残（キーボード評定・朗読バー非表示）、F-9 残（正規化・一括開閉・/settings・デッドコード削除・baseline 必須化） | 各親項目 |

**Phase 3 完了条件**: (1) resilient 級 10 語で parts/bridgeJa/cognates・IdiomEntry.originJa・スロット付き collocation が全件生成され、旧キャッシュ形式でも表示が崩れない。(2) advanced 実生成 10 本中 8 本が平均文長 ≥15 語かつ必須構文 3 種以上、全難構文に構文ノートが付く。(3) 別ブラウザプロファイルへの import で文章・挿絵・単語帳・進捗・streak が復元される。(4) Grok で `data:image/jpeg` の挿絵が返り、確認ゲート中のキャラ絵が破棄されない。(5) Lighthouse installable 監査 pass。

---

### 3. 横断的な技術リスクと先行して決めるべき設計判断

#### 先行設計判断（Phase 1 着手前に確定）

- **D1: SRS シード語の正準表現と「due」の二面定義**（A-1-2 × A-1-3 × C-5b の統合）。A-1-2 は `dueAt = now + 1日`、C-5b は「未スケジュール値 + phase 判別 + stability 必須の `isDueForReview`」と、同じ `newState.ts:21` を別方針で変更する計画である。推奨統合案: **復習キュー/ダッシュボードは「stability を持つ語のみ」（C-5b 準拠）、生成時の再織り込み候補は「dueAt 経過」（A-1-2 準拠の翌日再遭遇）という二面定義**を `src/domain/srs/` の単一述語群として先に確定し、Phase 1 の A-1-2 実装をこの最終形と互換な形（dueAt=now+DAY + stability 未定義は review 除外）で行う。これで Dexie マイグレーションと挙動変更が各 1 回で済む。
- **D2: wordCache のスキーマバージョニング**（E-3 × C-1/2/3 の順序矛盾の解消）。E セクションは cache-first を最優先、C セクションは「スキーマ拡張が先・キャッシュ恒久化が後」を要求し矛盾する。解: Phase 1 の E-3(b) 時点で `WordCacheRecord` に `schemaVersion`/`enrichmentPending` を導入し、Phase 3 の構造体化はバージョンバンプ + normalizeWordData の持ち上げ + lazy 再エンリッチで吸収する。
- **D3: 生成/注釈プロンプト・スキーマ変更の 2 バッチ集約**。バッチ1 = B-1+B-2+F-8②+A-3-1+cue密度（Phase 2）、バッチ2 = B-3+C-4+C-1(detailJa)+F-6本命（Phase 3）。各バッチで SpanViolationKind と REPAIR_HINT を対で追加し、旧 passage データは optional フィールドで後方互換（マイグレーション不要）とする。
- **D4: collocationId 契約の先行確定**。C-3 の `CollocationEntry.id`（kebab-case）を Phase 2 の B-1 バリデータ実装前に決め、照合を最初から「id ⇄ 旧文字列フォールバック」で書く（`reanchorSpans`、`providers.ts:386-410`）。
- **D5: Dexie マイグレーション計画の一元管理**。scheduling 是正（Phase 1）、lastOpenedAt + suspended（Phase 2）、suggestionCache/audioClips + images 分離（Phase 3）と、少なくとも 3 テーマがバージョンを上げる。**フェーズごとに 1 バージョンへ集約**し、`SCHEMA_VERSIONS` への追記 + fake-indexeddb マイグレーションテストを必須とする。
- **D6: UI グローバル基盤の共有**。toastStore/ModalOverlay/generationProgressStore（D-7/D-8）を Phase 2 序盤に確立し、C-5c 完了画面・C-5d 読了フィードバック・F-1/F-6 バナー・D-5 オーバーレイが全てこれを使う。個別実装を禁止する。
- **D7: 画像アセットの保存形式**。data URL 直格納 → Blob + images テーブル参照（F-5 第3段）を E-3(d)(e)・D-4 第2段より先に確定する。
- **D8: server/providers.ts の改修統合**。B-5（タスク別モデル/温度）と E-1（画像プロバイダ記述子）が同ファイルを触るため、「記述子テーブル + タスク別 env」の設計を共通パターンとして先に合意する。

#### 横断的技術リスク

- **R1: routes.tsx（1344 行）への変更集中**。A/C-5/D/E/F の大半が同ファイルの結線を触る。緩和: 各ストリーム着手時に純関数（`resolveTargetWordIds`、avoid 集約、reviewItem 構築等）をドメイン層へ切り出してから改修し、コンフリクト面積を減らす。
- **R2: vitest の whole-graph ビルド特性**。エクスポート漏れ 1 件が全テストを壊す（型エラーは壊さない）。型・スキーマ追加を伴う PR は `pnpm typecheck` を先に通してからテストを走らせる運用を全フェーズで徹底。
- **R3: Dexie マイグレーション失敗 = 学習資産全損**。現状バックアップ手段ゼロ（F-5）のまま Phase 2/3 でマイグレーションが積み上がるのが最大の運用リスク。**F-5 第1段（エクスポート導線）を Phase 2 内の大型マイグレーション前に前倒し**する。
- **R4: LLM 出力の非決定性と品質回帰**。プロンプト変更の効果はモック検証で担保できない。受け入れ基準を「実生成サンプル N 本中 M 本」の割合基準に統一し、B-4 の語彙実測・B-5 の語数実測を回帰指標として各バッチ後に計測する。品質違反はハードフェイルさせず `qualityWarnings` 出荷（B-1 の `isShippableResidual`）で学習を止めない。
- **R5: 出力トークン予算の玉突き**。B-1/B-3 の自己申告スパン、C 系の構造化、F-8② の paragraphIndex は出力トークンを増やす。B-5 の `tokenBudgetFor`（`lengthSpec.ts:68`）と F-6 の注釈上限を各バッチで再見積りし、max_tokens 打切り率をサーバログで監視する。
- **R6: visual スナップショットの多重更新**。F-7（フォント）→ D 各波 → D-8（コントラスト）で最低 3 回全面更新が走る。各波末尾で 1 回に集約し、「崩れが写った画像を基準にしない」運用を F-9 で明文化する。
- **R7: strict JSON スキーマ制約**。OpenAI strict モードでは全プロパティ required・optional は nullable（C-1 で確認済み）。バッチ1/2 のスキーマ拡張時に providers のプロバイダ差（Anthropic/OpenAI）を schema.test.ts のスナップショットで固定する。

---

### 4. 各フェーズの検証方法

**Phase 1**
- 単体: `newSchedulingState` の dueAt（now 有無）、`targetWordPlanFor` 境界値（wordTarget 100/400/800 × ratio 0/0.3/1.0）、`loadAndCacheWordData` のフェイクゲートウェイ呼び出し回数（ヒット 0 回 / stale-if-error）、providers リクエストボディのスナップショット（temperature・max_completion_tokens・推論系モデルでの省略）、`contentGatewayHttp` のエラーボディ解釈 3 ケース（code あり/なし/非 JSON）。
- 統合: `pipeline.integration.test.ts` に「生成→即 suggest で前回語が due 枠に入らない」、fake-indexeddb での Dexie マイグレーション（旧 dueAt=0 行の是正）。
- 実機: `.env` キー未設定起動→文言確認→キー設定→再試行復帰。生成→ホーム再訪→DevTools Network で単語再訪 0 リクエスト。450 語生成で注釈分布とバナー動作。`document.fonts.check` によるフォント適用確認。
- 回帰ガード: 全 PR で `pnpm typecheck` → テストの順（R2）。

**Phase 2**
- 単体/コンポーネント: `isDueForReview`（seeded/learning/suspended/期限前後）と sessionPlanner・dashboardProjector・wordSuggestionService が**同一述語を使うことの統合テスト**。ReviewSession 状態機械（reveal→rate→再挿入→Undo→完了）。recallEventService のクールダウン横断（review→passage、lookup 連打）。projector の TZ（offset=540 で JST 深夜評定が当日計上）・activeDays 合成。IntersectionObserver モックで「行通過→updateProgress」。passageValidator のクォータ未達/偽 collocationId/段落フィクスチャ。
- E2E（Playwright）: 行揃え精度（バッジとカードの boundingBox Y 差 ≤12px）、リサイズ後の非重なり、モバイルポップオーバー（scrollY 変化 ≤50px）、@axe-core で nested-interactive 違反ゼロ、msw 130 秒遅延→タイムアウト→キャンセル 1 秒復帰、生成中に /library へ移動→完了トースト、「10 文目まで読む→リロード→10 文目付近表示・バー約 50%」。
- 実生成評価: バッチ1 適用後にサンプル 10 本 × intent 2 種で expressionSpans 本数・collocationId 由来率・語数 ±25%・set_phrase の位置適切性を評価シート化（B-4 の `vocabProfile` 実測を併記）。
- 実機運用: 2〜3 日の自己ドッグフーディングで「ホーム件数=レビュー枚数」「streak 継続」「リセット後の提案変化」を確認。

**Phase 3**
- 単体: normalizeWordData の新旧変換（idioms 文字列→IdiomEntry、旧 etymology→EtymologyV2、旧 collocation 文字列→slug 持ち上げ）、reanchorSpans の id 照合＋旧文字列フォールバック（旧 passage 固定フィクスチャ）、findRun 長尺一致・anchorTextParts 不連続解決、チャンク注釈のカバレッジ振り分け・絶対インデックス保持・不完全 JSON 救済、JsonSyncAdapter v1/v2 ラウンドトリップ・画像除外 null 化、3 プロバイダの fake fetch（URL/認証/ボディ形/MIME）、canvas サムネ縮小。
- 手動評価シート（docs 保存）: イディオム由来 10 語の妥当性（幻覚語源チェック）、advanced/basic 各 3 本の構文ノート網羅、EtymologyBreakdown の surfaceIn 対応。
- E2E/実機: 別プロファイルへの import 復元一式、Grok/OpenAI 切替（typo 時の 503+起動ログ警告含む）、Lighthouse installable、辞書アセット gzip ≤150KB・フォント増分 ≤300KB のバンドル計測、visual baseline の最終更新と CI 必須化。

**クリティカルパス総括**: F-1 → A-1-2/A-1-3（D1 統合）→ E-3(a)(b) → 【Phase 2】C-5b → C-5c/C-5d、A-1-1+A-2-1、B-4 → プロンプトバッチ1 → 【Phase 3】C-1/2/3 一括 → B-3 → C-4。この主鎖の完了により「生成 → 読解（シグナル記録）→ 復習（想起）→ 再織り込み」の学習ループが初めてデータ整合した状態で閉じる。

---

## 付録: 学習科学エビデンス集（C-5 の根拠資料）

対象：Lexia（LLM が学習者の未習単語を織り込んだ英文を生成し、読解＋注釈＋SRS 復習で定着させる文脈ベース英単語学習アプリ）。以下、トピックごとに「知見の要約（代表研究）」→「Lexia への設計含意（具体値・生成方針・UI）」を記す。

---

### 1. 遭遇回数と間隔反復（spacing effect / FSRS / expanding intervals）

#### 知見の要約
- **必要遭遇回数**：偶発学習（読解中の出会い）だけで語彙が定着するには多数回の遭遇が必要。Saragi, Nation & Meister (1978) は約 16 回、Rott (1999) は 6 回で有意な学習、Horst, Cobb & Meara (1998) は 8 回以上、Webb (2007) は語彙知識の複数側面（綴り・意味・連語・文法機能）が伸びるには 10 回以上を示した。Waring & Takaki (2003) は graded reader で 8 回以上出会った語ですら 3 か月後の意味保持は低いことを示し、「読むだけ」の限界を明確化した。Uchihara, Webb & Yanagisawa (2019, Language Learning) のメタ分析（26 研究、45 効果量、N=1,918）は反復回数と偶発語彙学習の相関を中程度（r = .34）と推定し、効果は spacing・視覚的支援・学習者の既有語彙量などで調整されるとした。結論：**偶発的遭遇（多読）＋意図的学習（SRS）のハイブリッドが最も効率的**（Nation 2013; Webb et al. 2023 のレビューでも偶発学習自体の効果量は大きいが保持は意図学習に劣る）。
- **分散効果（spacing effect）**：Ebbinghaus (1885) 以来最も頑健な記憶現象の一つ。Cepeda, Pashler, Vul, Wixted & Rohrer (2006, 2008) の大規模メタ分析・実験は、最適な復習間隔が「保持したい期間の約 10–30%」であること、間隔を伸ばすほど長期保持に有利であることを示した。
- **拡張間隔（expanding intervals）**：Landauer & Bjork (1978) が拡張想起（expanding retrieval）を提唱。ただし Karpicke & Roediger (2007) は等間隔と拡張間隔の差は小さく、**「遅延をおいた想起」自体が本質**で、拡張かどうかは二次的と示した。実務上は拡張スケジュールが復習総量を最小化するため標準となっている。
- **アルゴリズムの妥当性**：SM-2（SuperMemo, Wozniak 1987; Anki の旧既定）は ease factor 1 変数の経験則。FSRS（open-spaced-repetition / Jarrett Ye ら）は記憶の三成分モデル（Difficulty・Stability・Retrievability；理論的起源は Wozniak & Gorzelanczyk 1994 の二成分記憶モデル）に基づく機械学習型スケジューラ。Anki の 7 億レビュー規模のベンチマークで、log loss は SM-2 ≈ 0.354 に対し FSRS-4.5 ≈ 0.298、FSRS-5 ≈ 0.291。FSRS-6 は約 99.6% のユーザーコレクションで SM-2 より高精度に想起確率を予測し、**同一保持率を 20–30% 少ない復習回数で達成**する。FSRS は「desired retention（目標保持率）」を明示パラメータとして持つ点も設計上重要。

#### Lexia への設計含意
- **スケジューラは FSRS を採用**（SM-2 は不採用）。既定 desired retention = **0.90**、ユーザー設定範囲 0.80–0.95。「復習負荷を減らす（0.85）／試験前（0.93）」プリセットを UI に用意。
- **学習ステップ（同日内）**：新語は読解セッション直後に想起テスト → 失敗時は同セッション内で 1 分後・10 分後に再想起。合格後 FSRS に引き渡し（初回間隔はおよそ 1 日から拡張）。
- **遭遇回数の設計目標**：1 語につき「注釈付き初遭遇 1 回＋SRS 想起 5–8 回＋**生成文章内での再遭遇 3 回以上**」を最低ラインとする。生成エンジンは「学習中（stability が低い）の語」を新規パッセージに優先的に再登場させる（re-encounter injection）。文章内再遭遇は FSRS の採点対象にはせず「補助的曝露」としてログのみ取り、想起テストの成績だけで間隔を更新する（曝露と想起の混同を避ける）。
- **リーチ（leech）処理**：lapse 6 回以上の語は自動的に「精緻化モード」（後述の語源・キーワード法・コロケーション提示）へ回す。

---

### 2. 想起練習 vs 再読 — 復習セッションの設計

#### 知見の要約
- **テスト効果（testing effect / retrieval practice）**：Roediger & Karpicke (2006, Psychological Science) は、再読より想起テストのほうが 1 週間後の保持で圧倒的に優れることを示した（直後テストでは再読が勝つため学習者は再読を過信する＝メタ認知の錯誤）。Karpicke & Roediger (2008, Science) は外国語語彙学習で「反復想起」が保持の決定因であり、反復提示のみでは効果が小さいことを実証。Dunlosky et al. (2013, Psychological Science in the Public Interest) の 10 学習法レビューは practice testing と distributed practice を「有用性・高」、rereading と highlighting を「低」と格付け。メタ分析でも Rowland (2014) g ≈ 0.50、Adesope, Trevisan & Sundararajan (2017) g ≈ 0.61 と頑健。
- **望ましい困難（desirable difficulties）**：Bjork & Bjork。想起に努力を要するほど（＝検索努力仮説）長期保持が高まる。認知（4 択）より再生（自由想起）が強い：Kang, McDermott & Roediger (2007) は「フィードバック付き短答テスト」が多肢選択より優れることを示した。ただし Little, Bjork, Bjork & Angello (2012) は competitive な選択肢を持つ多肢選択も有効と示す。
- **事前テスト効果（pretesting / errorful generation）**：Richland, Kornell & Kao (2009)、Potts & Shanks (2014)。答えを知る前に推測させると、誤答してもその後の学習が促進される。フィードバックは必須（Butler & Roediger 2008）。
- **方向性**：受容的想起（L2→L1 意味想起）と産出的想起（L1→L2 形式想起）は別スキルで、産出のほうが困難（Griffin & Harley 1996; Nation 2013; Webb 2005）。

#### Lexia への設計含意
- **復習セッションは「注釈の再表示」を一切既定にしない**。カードは必ず想起先行：①文脈クローズ（学習時と**別の**生成文で対象語を空所化）②意味想起（英単語→日本語/英語定義を自力想起→自己採点）③形式想起（定義・文脈→英単語をタイプ入力）。
- **語のライフサイクルで想起形式を段階化**：新規〜stability 低 = 認知形式（4 択・意味想起）→ stability 中 = 文脈クローズ → stability 高 = タイプ入力の産出想起。4 択の誤選択肢は LLM に「意味的に競合する既習語」を生成させる（Little et al. 2012 の competitive distractor 原則）。
- **読解前プリテスト**：パッセージ提示前に対象語の意味を推測させる 10 秒クイズ（pretesting effect）。誤答でも即フィードバックし、その後の読解が「答え合わせ」として機能する構造にする。
- **自己採点 UI**：Again / Hard / Good / Easy の 4 ボタンを FSRS 入力とする。フィードバックは即時（正解表示＋その語の元文脈を再掲＝「想起→文脈再読」の順序）。
- **メタ認知対策**：「読み直す」ボタンは残すが、復習完了にはカウントしない旨を UI で明示（再読の流暢性錯誤への対処）。

---

### 3. Involvement Load Hypothesis と文脈推測 — 新語提示の最適密度

#### 知見の要約
- **既知語率（lexical coverage）**：Laufer (1989) は読解成立に 95% を提案、Hu & Nation (2000) は物語文の適切な理解（かつ未知語推測が機能する条件）に **98% カバレッジ**が必要と示した。Schmitt, Jiang & Grabe (2011) はカバレッジと理解度がほぼ線形関係にあり明確な閾値はないが、95–98% が実用域と確認。Nation (2006) は英語書き言葉の 98% カバーに 8,000–9,000 ワードファミリーが必要と推計。98% とは**「50 語に 1 語だけ未知」＝新語密度 2% が上限**という意味。
- **文脈推測の限界**：Bensoussan & Laufer (1984) は文脈からの意味推測の成功率が低く、誤推測が定着しうることを示した。Hulstijn, Hollander & Greidanus (1996) は marginal gloss（欄外注）が偶発学習を有意に高めると示す。→ 推測に丸投げせず注釈で正解を保証すべき。
- **Involvement Load Hypothesis（ILH）**：Laufer & Hulstijn (2001)。語彙定着はタスクの関与負荷＝ **need（必要性）× search（検索）× evaluation（評価：語を文脈に当てはめて吟味する操作）** の合計で決まる。Yanagisawa & Webb (2021, Language Learning) の 42 研究メタ分析は ILH をおおむね支持しつつ、evaluation の寄与が最大で、テスト時期・想起形式を加えた拡張モデルを提案。
- **Nation の四本柱（Four Strands, 2007/2013）**：meaning-focused input／meaning-focused output／language-focused learning／fluency development を各 25% ずつ。読解アプリでも「速く楽に読む流暢性訓練」（既知語 99–100% の easy reading）が独立に必要。

#### Lexia への設計含意
- **生成文章の未知語密度は 2% を上限、既定 1.5%**：250–300 語のパッセージに対象新語 **4–6 語**（最大 8 語）。学習者の既知語データベースと照合し、対象語以外のトークン既知率 ≥ 98% を生成後バリデーションで機械検証（不合格なら再生成）。これが「i+1 を語彙面に限定適用する」中核制約。
- **推測→注釈の二段階 UI**：新語タップ時、まず「意味を推測」ワンタップ選択（need + evaluation を発生させる）→ 直後に正しい語義・文脈訳を表示（誤推測の固定化防止）。注釈は gloss として involvement を下げる側面があるため、パッセージ末尾に「この語を使って一文完成」などの evaluation タスクを任意で付ける（ILH の evaluation 最大化）。
- **流暢性モード**：週 1 回程度、「既知語 100%・新語ゼロ」の速読パッセージを生成し WPM を計測・表示（Nation の fluency strand）。新語学習とは明確に別モードとして UI 分離。

---

### 4. 語源・形態素分析とキーワード法 — 記憶の精緻化

#### 知見の要約
- **処理水準・精緻化**：Craik & Lockhart (1972)、Craik & Tulving (1975)。深い意味処理・関連づけが保持を高める。
- **形態素意識（morphological awareness）**：Nagy & Anderson (1984) は英語テキストの低頻度語の約 6 割が形態的に透明な派生語と推計。Bauer & Nation (1993) の接辞レベル分類、Carlisle (2000)、Kieffer & Lesaux (2012) は形態素意識が語彙量・読解力を予測することを示す。Nation (2013) は「word parts strategy」（語根・接辞分解）を中核方略に位置づける。ラテン・ギリシャ語根の知識は転移する（1 語根で数十語に波及）。
- **キーワード法**：Atkinson & Raugh (1975)。L1 の音的類似語＋心像で媒介する記銘術。Pressley, Levin & Delaney (1982) のレビューで短期的効果は最大級。ただし Wang, Thomas & Ouellette (1992) は忘却が速い（想起経路が長い）可能性を指摘し、長期効果には反復が必要。
- **重要な留保 — TOPRA モデル**：Barcroft (2002) の Type of Processing–Resource Allocation。**初期の形式学習中に意味的精緻化を強制すると、語形（綴り・音）の学習を阻害**しうる。精緻化は万能ではなくタイミング依存。

#### Lexia への設計含意
- **注釈カードの階層化**：第 1 層＝語義＋文脈訳のみ（初遭遇時、認知負荷最小・形式学習優先／TOPRA 配慮）。第 2 層＝タップで展開する「Why this meaning?」パネル：形態素分解（re- + spect = 「再び見る」→ respect）、同語根語ネットワーク（spect: inspect, spectator, perspective…既習語を優先表示）。
- **語根グラフの活用**：ユーザーの既習語 DB から同語根語を検索し、「あなたは既に inspect を知っている」形式で提示（既有知識への接続＝精緻化＋自己効力感）。
- **キーワード法は自動生成のオンデマンド機能**：既定表示にはせず、リーチ語（lapse 6 回以上）や具象語に対して「記憶フックを生成」ボタンで LLM がキーワード連想＋画像を生成。生成した記憶フックはその語の以後の復習カードの**答え側**にのみ表示。
- **透明な派生語は語族単位で管理**：happiness を happy の既知から派生規則で「推測可能」とマークし、SRS の独立カードにしない（復習総量の削減）。Bauer & Nation のレベル 1–4 接辞を推測可能条件とする。

---

### 5. コロケーション・定型表現（formulaic sequences）

#### 知見の要約
- Erman & Warren (2000) は自然な英語談話の **50–58% が定型表現**で構成されると推計。Pawley & Syder (1983) は「nativelike selection / nativelike fluency」問題を提起：文法的に正しくても連語選択が非母語的だと不自然になり、チャンク処理が流暢性の基盤となる。Wray (2002, *Formulaic Language and the Lexicon*) は定型表現が処理負荷を下げる貯蔵単位であると理論化。
- Boers, Eyckmans, Kappel, Stengers & Demecheleer (2006) は定型表現への気づき指導が口頭流暢性・自然さの評価を高めることを実証。Wolter & Gyllstad (2011, 2013) は **L1 と一致しないコロケーション（incongruent collocations）が習得困難**であることを示した（例：日本語話者にとって「薬を飲む」→ *drink medicine* ではなく take medicine）。Laufer & Girsai (2008) は L1 対照＋翻訳練習が連語学習に有効と示す。Nation (2013) も多語単位を語彙シラバスの正式な構成要素とする。
- 単語単独の意味知識と連語知識は乖離する（Webb 2007 の語彙知識多面性）。頻度データに基づくリスト（Academic Collocation List; Martinez & Schmitt 2012 の PHRASE List）が存在する。

#### Lexia への設計含意
- **生成方針**：LLM プロンプトに「対象語は必ず高頻度コロケーション内で使用せよ」と制約（例：decision なら make a decision / tough decision）。恣意的・低頻度な共起で例示しない。可能なら COCA 系頻度データで共起を検証。
- **注釈はチャンク単位でハイライト**：単語だけでなく "heavily dependent on" のような連語全体を下線・注釈対象にする。注釈カードに「よく使う組み合わせ TOP3」を常設表示。
- **SRS カードの単位に「コロケーションカード」を追加**：単語カード合格後（stability 一定以上）、その語の主要コロケーションをクローズ形式で出題（"He ___ a decision." ）。
- **L1 非一致コロケーションに警告バッジ**：日本語直訳と異なる連語（strong coffee＝「濃い」コーヒー等）を LLM に判定させ、「⚠日本語と発想が違う」マークを付けて対照提示（Laufer & Girsai の対照分析効果）。

---

### 6. 二重符号化（イラスト）の効果と限界

#### 知見の要約
- **二重符号化理論**：Paivio (1971, 1986)。言語符号＋心像符号の二重貯蔵が単一符号より保持を高める。**画像優位性効果**（Nelson, Reed & Walling 1976）も頑健。具象語で効果が大きく、抽象語では心像が形成しにくい（具象性効果）。
- **マルチメディア学習の原則**：Mayer (2001, 2009)。関連画像＋言語は学習を促進するが、**一貫性原理（coherence principle）＝装飾的・無関連な画像（seductive details）はむしろ学習を阻害**。
- **限界**：Carpenter & Olson (2012) は画像つき語彙学習で学習者が過信（overconfidence）に陥り、想起練習を伴わないと効果が出ないことを示した。画像は多義語の一義だけを固定するリスク、抽象語（justify, nevertheless 等）では誤解を生むリスクがある。Boers et al. (2009) も図像の効果は意味理解の補助であり形式（綴り）学習には寄与しにくいと指摘。

#### Lexia への設計含意
- **画像は選別的に生成**：具象性・心像性の高い語（imageability 評価を LLM または MRC/Glasgow Norms 相当の基準で判定）にのみイラストを付与。抽象語・機能語・多義語は既定でテキスト注釈のみ（誤符号化防止）。
- **パッセージ単位の情景イラスト**を優先：単語ごとのクリップアートではなく、文章の場面を描いた 1 枚絵に対象語の指示対象を含める（文脈記憶と画像記憶の統合、Mayer の一貫性原理に適合。装飾目的の画像は排除）。
- **復習時は「想起後に画像」**：カードの問題面に画像を出さない（画像が答えのヒントになり検索努力を奪う）。自己採点後の答え面で画像を再提示（Carpenter & Olson の過信問題への対処）。
- 多義語は「この画像は◯◯の意味のときだけ」とラベルを明記。

---

### 7. 構文的複雑さと i+1 — レベル別テキストの構文制御

#### 知見の要約
- **Comprehensible Input**：Krashen (1982, 1985) の入力仮説（i+1）。理論としての反証可能性には批判があり（Swain 1985 の出力仮説、McLaughlin 1987）、現在は「理解可能な大量入力が習得の必要条件（十分条件ではない）」という穏当な形で広く受容。多読研究（Day & Bamford 1998; Nation & Waring 2020）は「学習者が楽に理解できるレベルの大量読解」の効果を支持。
- **簡略化 vs 精緻化**：Yano, Long & Ross (1994)。語彙・構文の単純化（simplification）と、冗長性・言い換えを加える精緻化（elaboration）はどちらも理解を助ける。Crossley, Louwerse, McCarthy & McNamara (2007) は簡略化テキストの言語特性を分析し、結束性（cohesion）の高さが理解を支えると示す。
- **構文複雑性の測定**：Lu (2010) の L2 Syntactic Complexity Analyzer（T-unit 長、節密度、従属節比率など 14 指標）、Coh-Metrix / TAALES（Crossley & McNamara）。
- **CEFR と構文**：English Grammar Profile（Cambridge; O'Keeffe & Mark 2017）は学習者コーパスから CEFR レベル別の文法項目習得順序を記述。British Council–EAQUALS Core Inventory、日本では **CEFR-J（投野由紀夫ら）** の Grammar Profile が「どのレベルでどの構文が使えるか」の実証リストを提供。→「レベル別構文リスト」は理論上の空想ではなくコーパス基盤で構築可能。

#### Lexia への設計含意
- **「+1 は語彙に限定、構文は i に固定」**を生成原則とする：未知要素を対象新語だけに絞り、構文は学習者の現レベルで完全に理解可能にする（未知語推測に使える文脈手がかりを構文が壊さないため。Hu & Nation の 98% 論とも整合）。
- **CEFR 別構文ホワイトリスト／ブラックリストを LLM プロンプトに埋め込む**（English Grammar Profile / CEFR-J 準拠）。例：
  - **A2**：単文中心、等位接続（and/but/because）、平均文長 ≤ 10–12 語、時制は現在・過去・be going to。受動態・関係詞は不可。
  - **B1**：制限用法の関係詞節、第一・第二条件文、現在完了、基本受動態。平均文長 ≤ 15 語、1 文の従属節 ≤ 1。
  - **B2**：分詞構文、間接話法、仮定法過去完了、非制限関係詞。平均文長 ≤ 20 語。
  - **C1**：倒置、分裂文（cleft）、名詞化の多用を許可。
- **生成後の自動検証パイプライン**：既知語率 ≥ 98%（対象語除く）、平均文長、従属節密度（L2SCA 相当の指標）、禁止構文の不使用をチェックし、違反時は再生成。
- **精緻化オプション**：難語を削るのではなく、対象語の直後に同格・言い換え（“a drought — a long period without rain —”）を挿入する elaboration スタイルを A2–B1 で採用（Yano et al. 1994）。
- ユーザーが「難しすぎた／簡単すぎた」をパッセージ単位でフィードバック → 構文レベルパラメータを ±0.5 レベルで適応調整（理解度 ~90% 台を維持）。

---

### 8. 動機づけ・習慣化（streak・goal-setting・自己効力感）

#### 知見の要約
- **自己決定理論（SDT）**：Deci & Ryan (1985, 2000)。内発的動機は自律性・有能感・関係性の 3 欲求充足で維持される。外的報酬の過剰は内発的動機を損なう（過正当化効果：Deci 1971; Lepper, Greene & Nisbett 1973）。
- **目標設定理論**：Locke & Latham (1990, 2002)。具体的で挑戦的な目標＋進捗フィードバックが漠然とした「頑張る」より遂行を高める。近接目標（proximal goals）は自己効力感を育てる（Bandura & Schunk 1981）。
- **自己効力感**：Bandura (1977, 1997)。最大の源泉は「達成体験（mastery experiences）」。能力の実感できる証拠が継続を生む。
- **習慣形成**：Lally, van Jaarsveld, Potts & Wardle (2010) — 自動化までの中央値 66 日、文脈手がかり（同じ時間・場所）との連合が鍵。Gollwitzer (1999) の実行意図（「いつ・どこで・何を」の if-then プラン）は実行率を大幅に高める。Wood & Neal (2007) の cue–routine–reward。
- **L2 固有の動機**：Dörnyei (2005, 2009) の L2 Motivational Self System — 「理想 L2 自己」（英語を使えている将来像）の鮮明さが持続的動機を予測。
- **streak の功罪**：連続記録は損失回避（Kahneman & Tversky）を利用した強力な継続装置（Duolingo の中核機構）だが、途切れた際の離脱（アビーダンス）と不安を生む。streak freeze 等の緩和策が離脱を減らすことが業界データで示唆される。ゲーミフィケーション全般のメタ分析（Sailer & Homner 2020）は小〜中の正効果、ただし設計依存。

#### Lexia への設計含意
- **有能感は「本物の能力指標」で与える**：XP やバッジより、(a) 既知語数カウンタ（例：「1,842 / 3,000 語」）、(b) **カバレッジメーター**「あなたは B1 テキストの 96.2% を読める」（Nation のカバレッジ研究をそのまま UI 化）、(c) WPM 推移。学習内容と直結した進捗こそ mastery experience になる。
- **目標設定はユーザー主導（自律性）**：オンボーディングで「1 日 1 パッセージ＋復習」等の近接目標を自己選択させ、実行意図プロンプト（「いつ・どこで読みますか？」→ 通知時刻に反映）を取る。
- **streak は「柔らかく」実装**：連続日数表示＋自動 freeze 月 2 回＋「復帰ボーナス」（途切れ翌日の復帰を祝う）で損失不安を緩和。復習ノルマは FSRS の due 件数に連動させ、上限（例：1 日 60 枚）を設けて雪だるま式負債を防止（負債感は離脱の主因）。
- **理想 L2 自己への接続**：オンボーディングで読みたいジャンル・目的（論文、ニュース、小説、仕事）を取得し、生成パッセージのトピックをそれに寄せる。「あなたの目標テキストの既読可能率」を目的別に表示（Dörnyei の理想自己を可視化）。
- **セッション設計**：1 セッション = 復習（想起）5 分 → 新パッセージ 1 本（5 分）→ 事後クイズ 2 分、計 10–12 分で完結。小さく完了できる単位が習慣化（66 日論）と近接目標達成の両方に効く。
- 外発報酬（ポイント購入・ランキング）は最小限に留め、通知文面は成果情報型（「昨日の 6 語が復習期です」）にしてコントロール型（「サボらないで！」）を避ける（SDT の自律性支持的フィードバック）。

---

### 横断的な優先実装まとめ（設定値クイックリファレンス）
- FSRS、desired retention 0.90（可変 0.80–0.95）、同日学習ステップ 1 分/10 分、リーチ閾値 lapse 6。
- パッセージ：250–300 語、新語 4–6 語（密度 ≤ 2%）、対象語外の既知語率 ≥ 98%、CEFR 別構文ホワイトリスト、対象語は高頻度コロケーション内で使用、A2–B1 では同格言い換えによる精緻化。
- 復習：想起先行（プリテスト→読解→事後クイズ→FSRS カード）、認知→クローズ→産出の段階化、フィードバック即時、画像は答え面のみ。
- 学習中語の生成文への再注入（追加曝露 3 回以上）、派生語は語族で束ねてカード数を削減。
- 進捗 UI：既知語数・カバレッジ%・WPM。streak は freeze 付き。日次復習上限 60 枚。

Sources:
- [ankitects/fsrs-benchmark (GitHub)](https://github.com/ankitects/fsrs-benchmark)
- [Comparison with SM-2 — fsrs-optimizer (DeepWiki)](https://deepwiki.com/open-spaced-repetition/fsrs-optimizer/7.3-comparison-with-sm-2)
- [FSRS-5 vs SM-2: Spaced Repetition Algorithm Comparison (diane.app)](https://www.diane.app/en/guides/fsrs-vs-sm2)
- [Text and reading task variables in incidental L2 vocabulary learning from reading: A methodological synthesis (ScienceDirect, Arai & Takizawa 2024)](https://www.sciencedirect.com/science/article/abs/pii/S2772766124000168)
- [Incidental Vocabulary Acquisition Through Captioned Viewing: A Meta-Analysis (Kurokawa 2025, Language Learning)](https://onlinelibrary.wiley.com/doi/10.1111/lang.12697)
- [Incidental vocabulary learning: A scientometric review (ScienceDirect)](https://www.sciencedirect.com/science/article/abs/pii/S2772766124000661)

---

## 付録: レビュープロセスと統計

本ドキュメントは多段のマルチエージェントレビューで作成した。各段の成果は次段の入力として検証を重ねている。

1. **サブシステム精読（8 系統）**: 生成設定 UI / LLM プロンプトと生成品質 / 単語解説データ / 読解支援 / 右レールレイアウト / 各画面・ナビゲーション / 永続化・画像・キャッシュ / SRS 復習ループ。全 8 系統を実コード精読し、97 件の問題をコード根拠（ファイル:行）付きで確定した。
2. **学習科学リサーチ**: 第二言語語彙習得研究のエビデンスを整理し、C-5「Lexia 学習方針」の根拠資料とした（付録参照）。
3. **学習者ペルソナレビュー（5 視点）**: 初学者の初回セッション / 毎日 15 分の継続学習者 / TOEIC 900 志望の上級者 / UX・アクセシビリティ監査 / モバイル通勤学習者。ユーザ既出テーマ以外の問題を 63 件発掘した。
4. **重複統合と敵対的検証**: 63 件を意味的に統合して 49 件に整理し、重要度上位 36 件を懐疑的検証者が 1 件ずつ実コードで反証を試みた。**36 件全件が実在確認（棄却 0 件）**。検証枠外の 13 件は F-10 に「未検証」と明記して参考掲載した。
5. **テーマ別執筆と完全性監査**: テーマ A〜F とロードマップを執筆後、完全性監査で 10 件の指摘（セクション間矛盾・部分対応など）を検出し、該当 5 セクションを改訂した。監査ではコード引用の実コード突合を約 30 箇所スポットチェックし、正確性を確認している。

| 統計 | 値 |
|---|---|
| 精読サブシステム | 8 / 8 完了 |
| 精読での発見 | 97 件 |
| ペルソナ発掘（統合前） | 63 件 |
| 重複統合後 | 49 件 |
| 敵対的検証で実在確認 | 36 件（棄却 0 件） |
| 未検証（F-10 に参考掲載） | 13 件 |
| 監査指摘 → 改訂 | 10 件 → 5 セクション改訂 |

### 本ドキュメントの使い方

- 実装に着手する場合は、まず**ロードマップ §3 の先行設計判断 D1〜D8** を確定してから Phase 1 を開始すること。特に D1（SRS due の二面定義）と D2（wordCache スキーマバージョニング）は Phase 1 のタスクが依存する。
- 各テーマの実装計画はチェックボックス形式のタスクとして記述しており、`.kiro/specs/learning-content-enhancement`（初期化済み・未着手）の requirements / design / tasks の素材としてそのまま利用できる。
- コード参照は `main` @ `7196d56` 時点のもの。実装時に行番号がずれている場合は記載のシンボル名・関数名で再特定すること。
