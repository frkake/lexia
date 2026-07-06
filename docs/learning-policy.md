# Lexia 学習方針（Learning Policy）

- 制定: 2026-07-05（C-5a）
- 位置づけ: 「文章生成 × 間隔反復」という Lexia 固有の学習ループの**正準仕様**。実装・設計（`.kiro/specs/english-vocabulary-learning/design.md` の SRS 節）・定数（`src/domain/srs/parameters.ts`）はこの文書を参照する。
- ◎ 印の設定値は `src/domain/srs/parameters.ts` のエクスポート定数と**一致必須**であり、`src/domain/srs/parameters.policy.test.ts` が乖離を CI で検出する。◎ なし項目（段階 2/3 と明記した想起形式等）は突合対象外。

---

## 基本原理（採用する学習科学の知見）

1. **想起先行**: 復習は再読ではなく検索練習で行う。想起テストは再読より長期保持で優る（Roediger & Karpicke 2006; Karpicke & Roediger 2008; Dunlosky et al. 2013 は practice testing を有用性「高」、rereading を「低」と格付け）。UI は解答表示前の評定を禁止する。
2. **間隔反復は FSRS-6**: SM-2 比で同一保持率を 20–30% 少ない復習で達成（open-spaced-repetition ベンチマーク; 理論基盤は Woźniak & Gorzelańczyk 1994 の二成分記憶モデル）。分散効果は最頑健の記憶現象（Cepeda et al. 2006, 2008）。拡張間隔の本質は「遅延をおいた想起」自体である（Landauer & Bjork 1978; Karpicke & Roediger 2007）。
3. **偶発学習＋意図学習のハイブリッド**: 読解中の遭遇だけでは定着に 6–16 回以上の遭遇が必要で保持も弱い（Uchihara, Webb & Yanagisawa 2019 メタ分析 r=.34; Waring & Takaki 2003）。よって読解（meaning-focused input）と明示復習（language-focused learning）を役割分担させる（Nation の Four Strands, 2007/2013）。
4. **文脈は毎回変える**: 同一例文の再認は文脈ごと丸暗記になる。復習・再織り込みでは新文脈での再遭遇を優先する（符号化多様性; Involvement Load の evaluation 寄与最大: Laufer & Hulstijn 2001; Yanagisawa & Webb 2021）。
5. **受動再認を過大評価しない**: 読み流しは想起ではない。passage 由来クレジットは減衰付き・非昇格・クールダウン付きとし、昇格は明示レビュー成功のみ（Carpenter & Olson 2012 の過信問題）。
6. **+1 は語彙に限定**: 未知要素は対象新語に絞り、既知語率 ≥98% を守る（Hu & Nation 2000; Schmitt, Jiang & Grabe 2011）。難構文を導入する場合は構文解説（C-4）を対で付ける。
7. **負荷設計が継続を決める**: 復習バックログの雪だるまは離脱の主因。日次上限とセッション分割で「復帰初日が最も重い」逆インセンティブを排除する（習慣形成: Lally et al. 2010; 近接目標と自己効力感: Bandura & Schunk 1981; Locke & Latham 2002）。

---

## 設定値（正準値。変更はこの文書の改訂を伴う）

◎ 印の行は末尾に `` `CONSTANT=value` `` 形式でコード定数名と値を明示する。この行が `parameters.ts` のエクスポートと一致することを CI が検証する。

| 項目 | 値 | 根拠 / 備考 | 定数 |
|---|---|---|---|
| ◎ desired retention | 0.90（設定範囲 0.80–0.95） | FSRS 標準 | `DESIRED_RETENTION=0.9` |
| ◎ 初回表示ラダー | Again 10分 / Hard 1日 / Good 4日 / Easy 10日 | 原理 2 | `FIRST_DISPLAY_LADDER_MS`（ms 表現。Again=10分, Hard=1日, Good=4日, Easy=10日） |
| ◎ 1 セッション上限 | 20 枚 | 原理 7 | `SESSION_REVIEW_LIMIT=20` |
| ◎ 日次復習上限 | 60 枚（超過分は翌日繰り越し。設定で 20–200 に変更可） | 原理 7 | `DAILY_REVIEW_LIMIT=60` |
| ◎ 受動再認 | read_through = 減衰 Good（decay 0.5）、lookup = Again 相当。両者とも昇格なし・24h クールダウン（全ソース横断） | 原理 5。decay 0.5 は UNVALIDATED・較正対象 | `PASSIVE_RECALL_DECAY=0.5` / クールダウンは `DAILY_COOLDOWN_MS`（=1日） |
| read_through 適用対象 | 「lookup / 知らなかった」が付かなかった語のみ（二重計上防止） | 原理 5 | — |
| セッション内再学習 | Again/Hard 語はセッション末尾へ再挿入し 10 分ラダーを在セッション消化 | Landauer & Bjork 1978 | — |
| 再織り込み | stability が低い語を新規パッセージに優先再登場（定着まで文脈内再遭遇 3 回以上）。CEFR 帯フィルタは due 語には適用しない | 原理 3, 4 | — |
| ◎ 日次新語上限 | 1 日 12 語。newWordRatio スライダ（0–100%）はこの上限でクランプ | Hu & Nation 2000 | `DAILY_NEW_WORD_LIMIT=12` |
| 新語密度目安 | 1 パッセージ 4–6 語（未知語密度 ≤2%）を newWordRatio 既定値時の目安とする | Hu & Nation 2000 | — |
| 想起形式 | 当面 EN→JA 意味想起（解答表示ゲート必須）。段階 2 で文脈クローズ、段階 3 で JA→EN 産出（段階 2 以降は突合対象外） | Kang et al. 2007 | — |
| 復習例文 | 過去パッセージの別文 → 複数キャッシュ例文ローテーション → LLM 新文生成 → 最終フォールバックは見出し語のみ（ダミー文は全段で禁止） | 原理 4 | — |
| ◎ leech | lapse 6 回以上で精緻化モード（語源分解・記憶フック生成へ誘導） | Atkinson & Raugh 1975 | `LEECH_LAPSE_THRESHOLD=6` |

---

## 学習ループ（1 セッション 10–12 分の想定フロー）

1. **復習（想起）**: 「今回 N 枚・目安 M 分」を提示 → 開始 → 各カードは解答表示ゲート後にのみ評定可 → Again/Hard はセッション内再出題。
2. **新パッセージ読解**: 難易度・趣向・SRS 状態から復習語＋新語を織り込んだ文章を生成し読む。単語タップは自動で lookup（「まだ覚えていない」）として記録。
3. **読了**: lookup/Again の付かなかった語のみ read_through（減衰 Good）でクレジット。読了は明示ボタンで確定し、完了状態を表示。

ホームの「今日の復習」件数と /review の開始枚数は常に一致する（同一述語 `isDueForReview` を共有）。

---

## <a id="較正"></a>較正（Calibration）

`PASSIVE_RECALL_DECAY` と全ソース横断クールダウン長は現状 UNVALIDATED（推定値）。四半期ごとに `ReviewLog` から実測保持率を算出し、これらを再推定してこの文書と `parameters.ts` を同時改訂する。手順:

1. `ReviewLog` から、read_through / lookup を受けた語の「次回明示レビューでの正答率」を集計。
2. 目標保持率 0.90 との乖離から decay を調整（正答率が高すぎる＝過小評価なら decay を上げる）。
3. クールダウンは、同一語への passage 由来更新間隔の分布 P50/P75 を見て、二重計上が起きない最小値へ調整。
4. 改訂時は本表の ◎ 値と `parameters.ts` を同一 PR で更新し、突合テストを通す。

---

## 根拠文献

上の基本原理・設定値で参照した知見の出典。

**検索練習・想起先行（原理 1）**
- Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning: Taking memory tests improves long-term retention. *Psychological Science*, 17(3), 249–255.
- Karpicke, J. D., & Roediger, H. L. (2008). The critical importance of retrieval for learning. *Science*, 319(5865), 966–968.
- Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J., & Willingham, D. T. (2013). Improving students' learning with effective learning techniques. *Psychological Science in the Public Interest*, 14(1), 4–58.

**間隔反復・分散効果・拡張間隔（原理 2）**
- Woźniak, P. A., & Gorzelańczyk, E. J. (1994). Optimization of repetition spacing in the practice of learning. *Acta Neurobiologiae Experimentalis*, 54(1), 59–62.
- Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006). Distributed practice in verbal recall tasks: A review and quantitative synthesis. *Psychological Bulletin*, 132(3), 354–380.
- Cepeda, N. J., Vul, E., Rohrer, D., Wixted, J. T., & Pashler, H. (2008). Spacing effects in learning: A temporal ridgeline of optimal retention. *Psychological Science*, 19(11), 1095–1102.
- Landauer, T. K., & Bjork, R. A. (1978). Optimum rehearsal patterns and name learning. In M. M. Gruneberg, P. E. Morris, & R. N. Sykes (Eds.), *Practical Aspects of Memory* (pp. 625–632). Academic Press.
- Karpicke, J. D., & Roediger, H. L. (2007). Expanding retrieval practice promotes short-term retention, but equally spaced retrieval enhances long-term retention. *Journal of Experimental Psychology: Learning, Memory, and Cognition*, 33(4), 704–719.
- Open Spaced Repetition. FSRS ベンチマーク（SM-2 比の復習回数削減）. https://github.com/open-spaced-repetition

**偶発学習・意図学習・Four Strands（原理 3）**
- Uchihara, T., Webb, S., & Yanagisawa, A. (2019). The effects of repetition on incidental vocabulary learning: A meta-analysis of correlational studies. *Language Learning*, 69(3), 559–599.
- Waring, R., & Takaki, M. (2003). At what rate do learners learn and retain new vocabulary from reading a graded reader? *Reading in a Foreign Language*, 15(2), 130–163.
- Nation, I. S. P. (2007). The four strands. *Innovation in Language Learning and Teaching*, 1(1), 2–13.
- Nation, I. S. P. (2013). *Learning Vocabulary in Another Language* (2nd ed.). Cambridge University Press.

**符号化多様性・Involvement Load（原理 4）**
- Laufer, B., & Hulstijn, J. (2001). Incidental vocabulary acquisition in a second language: The construct of task-induced involvement. *Applied Linguistics*, 22(1), 1–26.
- Yanagisawa, A., & Webb, S. (2021). To what extent does the Involvement Load Hypothesis predict incidental L2 vocabulary learning? A meta-analysis. *Language Learning*, 71(2), 487–536.

**受動再認と過信（原理 5）**
- Carpenter, S. K., & Olson, K. M. (2012). Are pictures good for learning new vocabulary in a foreign language? Only if you think they are not. *Journal of Experimental Psychology: Learning, Memory, and Cognition*, 38(1), 92–101.

**既知語率・+1 語彙（原理 6）**
- Hu, M., & Nation, I. S. P. (2000). Unknown vocabulary density and reading comprehension. *Reading in a Foreign Language*, 13(1), 403–430.
- Schmitt, N., Jiang, X., & Grabe, W. (2011). The percentage of words known in a text and reading comprehension. *The Modern Language Journal*, 95(1), 26–43.

**負荷設計・習慣形成・目標設定（原理 7）**
- Lally, P., van Jaarsveld, C. H. M., Potts, H. W. W., & Wardle, J. (2010). How are habits formed: Modelling habit formation in the real world. *European Journal of Social Psychology*, 40(6), 998–1009.
- Bandura, A., & Schunk, D. H. (1981). Cultivating competence, self-efficacy, and intrinsic interest through proximal self-motivation. *Journal of Personality and Social Psychology*, 41(3), 586–598.
- Locke, E. A., & Latham, G. P. (2002). Building a practically useful theory of goal setting and task motivation: A 35-year odyssey. *American Psychologist*, 57(9), 705–717.

**想起形式・leech 対策（設定値表）**
- Kang, S. H. K., McDermott, K. B., & Roediger, H. L. (2007). Test format and corrective feedback modify the effect of testing on long-term retention. *European Journal of Cognitive Psychology*, 19(4–5), 528–558.
- Atkinson, R. C., & Raugh, M. R. (1975). An application of the mnemonic keyword method to the acquisition of a Russian vocabulary. *Journal of Experimental Psychology: Human Learning and Memory*, 104(2), 126–133.
