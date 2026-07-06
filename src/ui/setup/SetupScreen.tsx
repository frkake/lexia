/**
 * L4 — SetupScreen (design.md "SetupScreen"; overhauled for the learning-experience-overhaul spec).
 * Lets the learner pick a learning intent (single, Requirement 8), an exam-based difficulty
 * (Requirement 9, via ExamLevelPicker), a 100-word-step word target (Requirement 7, via
 * WordTargetSlider), a content type (article / short / long story, Requirement 6) with genre +
 * homage for stories, the new-word ratio, and curate the auto-selected target words. The required
 * condition — a chosen exam target — gates generation; when met it emits the assembled SetupConfig
 * via `onGenerate`. Presentational: candidates are injected and generation/persistence live in the
 * route wiring.
 */

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { colors, fonts, radius } from '../theme/tokens';
import { examScale } from '../../domain/difficulty/examScale';
import { ExamLevelPicker } from './ExamLevelPicker';
import { WordTargetSlider } from './WordTargetSlider';
import { GenerationProgressPanel } from './GenerationProgressPanel';
import { isGenerationActive, type GenerationPhase } from '../../state/stores/generationProgressStore';
import { lengthSpec } from '../../domain/generation/lengthSpec';
import {
  customAdvancedDifficultyForExamTarget,
  levelPresetForExamTarget,
  type LevelPreset,
} from '../../domain/difficulty/levelPreset';
import type {
  Cefr,
  ContentType,
  ExamCriterion,
  EnglishAccent,
  LearningIntent,
  AmbientNoiseLevel,
  ListeningSceneKind,
  MasteryStage,
  ReadabilityLevel,
  SetupConfig,
  StoryGenre,
} from '../../types/domain';

export interface CandidateWord {
  wordId: string;
  surface: string;
  level?: Cefr;
  reason?: 'new' | 'due' | 'weak';
  stage?: MasteryStage;
}

export interface SetupScreenProps {
  /** Auto-selected candidate words (WordSuggestionService / SessionPlanner). */
  candidates?: CandidateWord[];
  /** Notice shown when fewer candidates than requested were available (Requirement 5.5). */
  suggestionShortfall?: string | null;
  /** Notice shown when the daily new-word cap (C-5b) trimmed the new words for this generation. */
  newWordCapNotice?: string | null;
  /** Seed values (e.g. settingsStore.lastSetup); examTarget may be unset to force a choice. */
  initial?: Partial<SetupConfig>;
  /** Receives the assembled config once required conditions are met. */
  onGenerate?: (setup: SetupConfig) => void;
  /** Refreshes only the auto-selected candidate words; manual additions/exclusions stay local. */
  onRefreshCandidates?: (setup: SetupConfig) => void;
  /**
   * Notifies the route that the learner cleared the manual word fields (A-2-1). The route drops the
   * persisted `targetWordIds`/`excludedWordIds` (patching ONLY those two fields — never the level,
   * sliders, or other unconfirmed form values). No setup is emitted; local word state is reset here.
   */
  onResetTargetWords?: () => void;
  refreshingCandidates?: boolean;
  candidateRefreshError?: string | null;
  generating?: boolean;
  generationError?: string | null;
  /**
   * Live generation progress (D-7). When present it drives the in-place progress panel + Cancel /
   * 再試行 in place of the plain button, and disables the whole form (`<fieldset disabled>`) while a
   * run is active. When omitted the screen falls back to the simple `generating`/`generationError`
   * behaviour (gallery / presentational fixtures).
   */
  generationProgress?: GenerationProgressView | null;
  /** Persistent warning shown above the form when the generation API key is unset (F-1). */
  configWarning?: string | null;
}

/** The slice of generationProgressStore the route feeds the setup form (D-7). */
export interface GenerationProgressView {
  phase: GenerationPhase;
  startedAt: number | null;
  error: string | null;
  onCancel?: () => void;
}

const DEFAULT_EXAM: ExamCriterion = { kind: 'eiken', value: '2' };

const INTENTS: { value: LearningIntent; label: string }[] = [
  { value: 'business', label: 'ビジネス' },
  { value: 'daily', label: '日常会話' },
  { value: 'toeic', label: 'TOEIC' },
  { value: 'eiken', label: '英検' },
  { value: 'academic', label: 'アカデミック' },
  { value: 'travel', label: '旅行' },
];

const CONTENT_TYPES: { value: ContentType; label: string }[] = [
  { value: 'article', label: '単発記事' },
  { value: 'short_story', label: '短編物語' },
  { value: 'long_story', label: '長編物語' },
  { value: 'listening_scene', label: 'リスニング' },
];

const GENRES: { value: StoryGenre; label: string }[] = [
  { value: 'fantasy', label: 'ファンタジー' },
  { value: 'sci_fi', label: 'SF' },
  { value: 'mystery', label: 'ミステリー' },
];

const CEFR_LEVELS: Cefr[] = ['A2', 'B1', 'B2', 'C1', 'C2'];

const READABILITY_OPTIONS: { value: ReadabilityLevel; label: string }[] = [
  { value: 'easy', label: 'やさしい' },
  { value: 'standard', label: '標準' },
  { value: 'advanced', label: '挑戦' },
];

const LISTENING_SCENES: { value: ListeningSceneKind; label: string }[] = [
  { value: 'radio_news', label: 'ラジオニュース' },
  { value: 'street_interview', label: '街頭インタビュー' },
  { value: 'podcast_dialogue', label: 'ポッドキャスト' },
  { value: 'public_announcement', label: '公共アナウンス' },
];

const ACCENTS: { value: EnglishAccent; label: string }[] = [
  { value: 'us', label: 'アメリカ英語' },
  { value: 'gb', label: 'イギリス英語' },
  { value: 'au', label: 'オーストラリア英語' },
  { value: 'in', label: 'インド英語' },
];

const NOISE_LEVELS: { value: AmbientNoiseLevel; label: string }[] = [
  { value: 'none', label: 'なし' },
  { value: 'low', label: '控えめ' },
  { value: 'medium', label: '標準' },
];

/** Default word target when none is seeded (mid of the article range). */
const DEFAULT_WORD_TARGET = 400;

function clampWordTarget(contentType: ContentType, value: number): number {
  const range = lengthSpec.wordRange(contentType);
  return Math.min(range.max, Math.max(range.min, value));
}

/** Which required conditions are still unmet. Target words are optional. */
export function setupMissing(examTarget: ExamCriterion | undefined, targetWordIds: string[]): string[] {
  const missing: string[] = [];
  if (!examTarget) missing.push('レベル');
  void targetWordIds;
  return missing;
}

function candidateReasonLabel(candidate: CandidateWord): string | null {
  if (candidate.reason === 'due') return '復習';
  if (candidate.reason === 'weak') return '苦手';
  if (candidate.reason === 'new') return '新出';
  return null;
}

function initialLevelPreset(initial: Partial<SetupConfig> | undefined): LevelPreset {
  const base = levelPresetForExamTarget(initial?.examTarget ?? DEFAULT_EXAM);
  return {
    vocabularyLevel: initial?.advancedDifficulty?.vocabularyLevel ?? base.vocabularyLevel,
    readabilityLevel: initial?.advancedDifficulty?.readabilityLevel ?? base.readabilityLevel,
  };
}

function readabilityLabel(value: ReadabilityLevel): string {
  return READABILITY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

/**
 * A-3-3: annotate a bare CEFR symbol with the exam grades learners actually recognise, e.g.
 * `B1（英検2級・TOEIC 550–784 相当）`. C2 is out of the 英検/TOEIC range → 「英検対象外」.
 */
function cefrScaleLabel(cefr: Cefr): string {
  const d = examScale.cefrToExam(cefr);
  const eiken = d.eiken === 'n/a' ? '英検対象外' : `英検${d.eiken}`;
  return d.toeic === 'n/a' ? `${cefr}（${eiken}）` : `${cefr}（${eiken}・TOEIC ${d.toeic} 相当）`;
}

/** A-3-3: the shorter CEFR+英検 form used on the 目標連動 badge, e.g. `B1（英検2級相当）`. */
function cefrBadgeLabel(cefr: Cefr): string {
  const d = examScale.cefrToExam(cefr);
  return d.eiken === 'n/a' ? `${cefr}（英検対象外）` : `${cefr}（英検${d.eiken}相当）`;
}

export function SetupScreen({
  candidates = [],
  suggestionShortfall = null,
  newWordCapNotice = null,
  initial,
  onGenerate,
  onRefreshCandidates,
  onResetTargetWords,
  refreshingCandidates = false,
  candidateRefreshError = null,
  generating = false,
  generationError = null,
  generationProgress = null,
  configWarning = null,
}: SetupScreenProps) {
  // D-7: while a generation is actively in flight the whole form is frozen (`<fieldset disabled>`)
  // so the push-time snapshot can't drift, and the progress panel replaces the button. `busy` falls
  // back to the plain `generating` flag when no progress object is supplied (gallery / old callers).
  const busy = generationProgress ? isGenerationActive(generationProgress.phase) : generating;
  const showPanel =
    generationProgress != null &&
    (isGenerationActive(generationProgress.phase) || generationProgress.phase === 'error');
  // Case-insensitive candidate keys used to de-dupe manual additions against previewed candidates,
  // so a word that appears in both never renders as two chips (A-2-1).
  const candidateKeys = useMemo(
    () => new Set(candidates.map((c) => c.wordId.trim().toLowerCase())),
    [candidates],
  );
  // A-2-3: excluded words are stored as ids; look up a friendly surface when the word is also a
  // current candidate, otherwise fall back to the id (a manually-excluded word carries no surface).
  const candidateSurfaceById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of candidates) map.set(c.wordId, c.surface);
    return map;
  }, [candidates]);
  const seededLevelPreset = useMemo(() => initialLevelPreset(initial), [initial]);

  const [examTarget, setExamTarget] = useState<ExamCriterion | undefined>(initial?.examTarget);
  const [intent, setIntent] = useState<LearningIntent>(initial?.intent ?? 'daily');
  const [newWordRatio, setNewWordRatio] = useState<number>(initial?.newWordRatio ?? 0.3);
  const [contentType, setContentType] = useState<ContentType>(initial?.contentType ?? 'article');
  const [wordTarget, setWordTarget] = useState<number>(initial?.wordTarget ?? DEFAULT_WORD_TARGET);
  const [vocabularyLevel, setVocabularyLevel] = useState<Cefr>(seededLevelPreset.vocabularyLevel);
  const [readabilityLevel, setReadabilityLevel] = useState<ReadabilityLevel>(seededLevelPreset.readabilityLevel);
  const [genre, setGenre] = useState<StoryGenre>(initial?.storyOptions?.genre ?? 'fantasy');
  const [homageTitle, setHomageTitle] = useState<string>(initial?.storyOptions?.homageTitle ?? '');
  const [sceneKind, setSceneKind] = useState<ListeningSceneKind>(initial?.listeningOptions?.sceneKind ?? 'radio_news');
  const [accent, setAccent] = useState<EnglishAccent>(initial?.listeningOptions?.accent ?? 'gb');
  const [noiseLevel, setNoiseLevel] = useState<AmbientNoiseLevel>(initial?.listeningOptions?.noiseLevel ?? 'low');
  const [excluded, setExcluded] = useState<Set<string>>(new Set(initial?.excludedWordIds ?? []));
  // Manual additions are seeded from the persisted setup (now manual-only, A-1-1) and re-filtered
  // whenever previewed candidates arrive so an overlap collapses to a single candidate chip.
  const [added, setAdded] = useState<string[]>(() => [...(initial?.targetWordIds ?? [])]);
  useEffect(() => {
    setAdded((prev) => {
      // Drop manual additions that overlap a previewed candidate. Return the SAME reference when
      // nothing changes so React bails out of the update — otherwise `.filter()` would always yield a
      // fresh array and, when `candidates` is omitted (default `[]` recreated each render → an
      // unstable `candidateKeys`), the effect would re-fire on every render and loop forever.
      const next = prev.filter((id) => !candidateKeys.has(id.trim().toLowerCase()));
      return next.length === prev.length ? prev : next;
    });
  }, [candidateKeys]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [attempted, setAttempted] = useState(false);

  const isStory = contentType === 'short_story' || contentType === 'long_story';
  const isListening = contentType === 'listening_scene';
  const levelPreset = levelPresetForExamTarget(examTarget ?? DEFAULT_EXAM);
  const hasCustomLevel =
    vocabularyLevel !== levelPreset.vocabularyLevel || readabilityLevel !== levelPreset.readabilityLevel;

  const targetWordIds = useMemo(() => {
    // Non-excluded previewed candidates first, then manual additions — merged case-insensitively so
    // the same word never lands twice (A-2-1). Candidates is empty by default (no prefill).
    const seen = new Set<string>();
    const ids: string[] = [];
    const push = (id: string): void => {
      const key = id.trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      ids.push(id);
    };
    for (const c of candidates) if (!excluded.has(c.wordId)) push(c.wordId);
    for (const id of added) push(id);
    return ids;
  }, [candidates, excluded, added]);

  const missing = setupMissing(examTarget, targetWordIds);

  const toggleExclude = (wordId: string): void =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(wordId)) next.delete(wordId);
      else next.add(wordId);
      return next;
    });

  // A-2-3: lift a word out of the exclusion set (from the "除外中の単語" list) so it can be suggested
  // and auto-selected again on the next generation. "すべて解除" clears the whole set at once.
  const includeExcluded = (wordId: string): void =>
    setExcluded((prev) => {
      if (!prev.has(wordId)) return prev;
      const next = new Set(prev);
      next.delete(wordId);
      return next;
    });
  const clearExcluded = (): void => setExcluded(new Set());
  const excludedLabel = (wordId: string): string => candidateSurfaceById.get(wordId) ?? wordId;

  const removeAdded = (wordId: string): void => setAdded((prev) => prev.filter((x) => x !== wordId));

  const commitAdd = (e: FormEvent): void => {
    e.preventDefault();
    const word = draft.trim();
    if (word && !targetWordIds.includes(word)) setAdded((prev) => [...prev, word]);
    setDraft('');
    setAdding(false);
  };

  const selectExamTarget = (criterion: ExamCriterion): void => {
    setExamTarget(criterion);
    const preset = levelPresetForExamTarget(criterion);
    setVocabularyLevel(preset.vocabularyLevel);
    setReadabilityLevel(preset.readabilityLevel);
  };

  const resetLevelPreset = (): void => {
    setVocabularyLevel(levelPreset.vocabularyLevel);
    setReadabilityLevel(levelPreset.readabilityLevel);
  };

  const buildSetup = (selectedExamTarget: ExamCriterion): SetupConfig => {
    const effectiveWordTarget = clampWordTarget(contentType, wordTarget);
    const advancedDifficulty = customAdvancedDifficultyForExamTarget(selectedExamTarget, {
      vocabularyLevel,
      readabilityLevel,
    });
    return {
      examTarget: selectedExamTarget,
      intent,
      newWordRatio,
      wordTarget: effectiveWordTarget,
      contentType,
      ...(advancedDifficulty ? { advancedDifficulty } : {}),
      ...(isStory
        ? { storyOptions: { genre, ...(homageTitle.trim() ? { homageTitle: homageTitle.trim() } : {}) } }
        : {}),
      ...(isListening ? { listeningOptions: { sceneKind, accent, noiseLevel } } : {}),
      targetWordIds,
      excludedWordIds: [...excluded],
    };
  };

  const refreshCandidates = (): void => {
    onRefreshCandidates?.(buildSetup(examTarget ?? DEFAULT_EXAM));
  };

  const hasManualEdits = excluded.size > 0 || added.length > 0;

  const resetTargetWords = (): void => {
    // Reset only the two manual word fields (A-2-1): clear local additions + exclusions and tell the
    // route to drop them from the persisted setup. No form values are emitted, so the level/sliders
    // and other unconfirmed inputs can never be silently committed by pressing リセット.
    setExcluded(new Set());
    setAdded([]);
    setDraft('');
    setAdding(false);
    onResetTargetWords?.();
  };

  const generate = (): void => {
    setAttempted(true);
    if (missing.length > 0 || !examTarget) return;
    onGenerate?.(buildSetup(examTarget));
  };

  return (
    <div className="setup-page" style={{ display: 'flex', justifyContent: 'center', background: colors.surfacePage, padding: '40px 24px' }}>
      <div className="setup-card" style={cardStyle}>
        <div style={{ padding: '34px 40px 30px' }}>
          <h2 style={{ fontFamily: fonts.serifJp, fontSize: 27, fontWeight: 500, color: colors.ink, margin: 0 }}>
            学習をはじめる
          </h2>
          <div style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.muted, marginTop: 5 }}>
            あなたの未学習・苦手な単語を織り込んだ文章を生成します。
          </div>
        </div>

        <div style={{ padding: '0 40px 36px', display: 'flex', flexDirection: 'column', gap: 30 }}>
          {configWarning ? (
            <div role="alert" data-testid="config-warning" style={configWarningStyle}>
              {configWarning}
            </div>
          ) : null}

          {/* D-7: freeze every field while a generation is running so the push-time snapshot can't
              drift. A native disabled <fieldset> disables all nested controls at once; the footer
              (progress panel / Cancel / 再試行) stays OUTSIDE it so those stay clickable. */}
          <fieldset disabled={busy} style={fieldsetStyle}>
          {/* Learning intent (single-select) */}
          <section>
            <Label text="学びたい内容" hint="目的・題材" />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {INTENTS.map(({ value, label }) => {
                const on = intent === value;
                return (
                  <button
                    key={value}
                    type="button"
                    data-testid={`intent-${value}`}
                    aria-pressed={on}
                    onClick={() => setIntent(value)}
                    style={pillStyle(on)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Difficulty (exam-based) */}
          <section>
            <Label text="目標レベル" hint="英検 / TOEIC / TOEFL / IELTS" />
            <ExamLevelPicker value={examTarget ?? DEFAULT_EXAM} onChange={selectExamTarget} />
            {!examTarget ? (
              <div style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 8 }}>
                目標レベルを選ぶと生成できます。
              </div>
            ) : null}
          </section>

          <section>
            <div style={advancedHeaderStyle}>
              <Label text="高度設定" hint="目標レベルのカスタム" mb={0} />
              <div style={advancedStatusWrapStyle}>
                <span data-testid="advanced-level-mode" style={advancedStatusStyle(hasCustomLevel)}>
                  {hasCustomLevel
                    ? 'カスタム'
                    : `目標連動 ${cefrBadgeLabel(levelPreset.vocabularyLevel)} / ${readabilityLabel(levelPreset.readabilityLevel)}`}
                </span>
                {hasCustomLevel ? (
                  <button type="button" data-testid="reset-advanced-level" onClick={resetLevelPreset} style={advancedResetStyle}>
                    目標レベルに戻す
                  </button>
                ) : null}
              </div>
            </div>
            <div style={advancedGridStyle}>
              <label style={advancedLabelStyle}>
                <span style={advancedLabelTextStyle}>単語レベル</span>
                <select
                  aria-label="単語レベル"
                  data-testid="advanced-vocabulary-level"
                  value={vocabularyLevel}
                  onChange={(e) => setVocabularyLevel(e.target.value as Cefr)}
                  style={selectStyle}
                >
                  {CEFR_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {cefrScaleLabel(level)}
                    </option>
                  ))}
                </select>
              </label>
              <label style={advancedLabelStyle}>
                <span style={advancedLabelTextStyle}>文構造</span>
                <select
                  aria-label="文構造の読みやすさ"
                  data-testid="advanced-readability-level"
                  value={readabilityLevel}
                  onChange={(e) => setReadabilityLevel(e.target.value as ReadabilityLevel)}
                  style={selectStyle}
                >
                  {READABILITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          {/* Content type */}
          <section>
            <Label text="コンテンツ種別" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
              {CONTENT_TYPES.map(({ value, label }) => {
                const on = contentType === value;
                return (
                  <button
                    key={value}
                    type="button"
                    data-testid={`content-type-${value}`}
                    aria-pressed={on}
                    onClick={() => {
                      setContentType(value);
                      setWordTarget((prev) => clampWordTarget(value, prev));
                    }}
                    style={contentTypeStyle(on)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Genre + homage (stories only) */}
          {isStory ? (
            <section>
              <Label text="ジャンル" hint="物語の作風" />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {GENRES.map(({ value, label }) => {
                  const on = genre === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      data-testid={`genre-${value}`}
                      aria-pressed={on}
                      onClick={() => setGenre(value)}
                      style={pillStyle(on)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <input
                aria-label="オマージュ作品（任意）"
                placeholder="オマージュ作品（任意）"
                value={homageTitle}
                onChange={(e) => setHomageTitle(e.target.value)}
                style={homageInputStyle}
              />
            </section>
          ) : null}

          {isListening ? (
            <section>
              <Label text="音声シーン" hint="字幕追従リスニング" />
              <div style={advancedGridStyle}>
                <label style={advancedLabelStyle}>
                  <span style={advancedLabelTextStyle}>場面</span>
                  <select
                    aria-label="音声シーン"
                    data-testid="listening-scene-kind"
                    value={sceneKind}
                    onChange={(e) => setSceneKind(e.target.value as ListeningSceneKind)}
                    style={selectStyle}
                  >
                    {LISTENING_SCENES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={advancedLabelStyle}>
                  <span style={advancedLabelTextStyle}>アクセント</span>
                  <select
                    aria-label="英語アクセント"
                    data-testid="listening-accent"
                    value={accent}
                    onChange={(e) => setAccent(e.target.value as EnglishAccent)}
                    style={selectStyle}
                  >
                    {ACCENTS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={advancedLabelStyle}>
                  <span style={advancedLabelTextStyle}>環境音</span>
                  <select
                    aria-label="環境音レベル"
                    data-testid="listening-noise"
                    value={noiseLevel}
                    onChange={(e) => setNoiseLevel(e.target.value as AmbientNoiseLevel)}
                    style={selectStyle}
                  >
                    {NOISE_LEVELS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>
          ) : null}

          {/* Sliders */}
          <section className="setup-sliders" style={{ display: 'flex', gap: 30 }}>
            <div style={{ flex: 1 }}>
              <div style={sliderHeadStyle}>
                <span style={sliderLabelStyle}>新出単語の割合</span>
                <span style={sliderValueStyle}>{Math.round(newWordRatio * 100)}%</span>
              </div>
              <input
                type="range"
                aria-label="新出単語の割合"
                min={0}
                max={1}
                step={0.05}
                value={newWordRatio}
                onChange={(e) => setNewWordRatio(Number(e.target.value))}
                style={{ width: '100%', accentColor: colors.primary }}
              />
              <div style={sliderEndsStyle}>
                <span>少なめ（読みやすい）</span>
                <span>多め</span>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <WordTargetSlider contentType={contentType} value={wordTarget} onChange={setWordTarget} />
            </div>
          </section>

          {/* Target words */}
          <section>
            <div style={targetHeaderStyle}>
              <Label text="今回織り込む単語" hint="任意 — 未指定なら自動選択" mb={0} />
              {onRefreshCandidates || onResetTargetWords ? (
                <div style={targetActionsStyle}>
                  {onResetTargetWords ? (
                    <button
                      type="button"
                      data-testid="reset-candidates"
                      onClick={resetTargetWords}
                      disabled={!hasManualEdits || refreshingCandidates || busy}
                      title="手動で追加・除外した単語を消して自動選択に戻します（学習履歴は消えません）"
                      style={resetButtonStyle(!hasManualEdits || refreshingCandidates || busy)}
                    >
                      リセット
                    </button>
                  ) : null}
                  {onRefreshCandidates ? (
                    <button
                      type="button"
                      data-testid="refresh-candidates"
                      onClick={refreshCandidates}
                      disabled={refreshingCandidates || busy}
                      aria-busy={refreshingCandidates}
                      style={refreshButtonStyle(refreshingCandidates || busy)}
                    >
                      {refreshingCandidates ? '更新中…' : candidates.length === 0 ? '自動選択をプレビュー' : '単語を更新'}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginBottom: 12 }}>
              指定しない場合は、復習が必要な単語と新しい単語を自動で選んで織り込みます
            </div>
            {suggestionShortfall ? (
              <div style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.terracotta, marginBottom: 12 }}>
                {suggestionShortfall}
              </div>
            ) : null}
            {newWordCapNotice ? (
              <div
                data-testid="new-word-cap-notice"
                style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginBottom: 12 }}
              >
                {newWordCapNotice}
              </div>
            ) : null}
            {candidateRefreshError ? (
              <div style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.terracotta, marginBottom: 12 }}>
                {candidateRefreshError}
              </div>
            ) : null}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {candidates.map((c) => {
                const off = excluded.has(c.wordId);
                const reason = candidateReasonLabel(c);
                return (
                  <button
                    key={c.wordId}
                    type="button"
                    data-testid={`target-${c.wordId}`}
                    aria-pressed={!off}
                    aria-label={off ? `${c.surface} の除外を戻す` : `${c.surface} を除外`}
                    onClick={() => toggleExclude(c.wordId)}
                    style={targetChipStyle(off)}
                    title={off ? '除外中 — クリックで戻す' : 'クリックで除外（もう一度で戻す）'}
                  >
                    {c.surface}
                    {reason ? <span style={targetReasonStyle}>{reason}</span> : null}
                    <span aria-hidden="true" style={chipActionIconStyle}>{off ? '↩' : '×'}</span>
                  </button>
                );
              })}
              {added
                .filter((w) => !candidateKeys.has(w.trim().toLowerCase()))
                .map((w) => (
                  <button
                    key={`added-${w}`}
                    type="button"
                    data-testid={`target-added-${w}`}
                    aria-pressed
                    aria-label={`${w} を削除`}
                    onClick={() => removeAdded(w)}
                    style={targetChipStyle(false)}
                    title="クリックで削除"
                  >
                    {w}
                    <span aria-hidden="true" style={chipActionIconStyle}>×</span>
                  </button>
                ))}
              {adding ? (
                <form aria-label="単語を追加するフォーム" onSubmit={commitAdd} style={{ display: 'inline-flex', gap: 6 }}>
                  <input aria-label="追加する単語" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} style={addInputStyle} />
                  <button type="submit" style={addChipStyle}>
                    追加
                  </button>
                </form>
              ) : (
                <button type="button" onClick={() => setAdding(true)} style={addChipStyle}>
                  ＋ 追加
                </button>
              )}
            </div>

            {/* A-2-3: excluded words are otherwise invisible after a revisit (they only suppress
                suggestions), so surface them in a collapsible list with per-word and bulk un-exclude. */}
            {excluded.size > 0 ? (
              <details data-testid="excluded-words" style={excludedDetailsStyle}>
                <summary style={excludedSummaryStyle}>除外中の単語 ({excluded.size})</summary>
                <div style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, margin: '8px 0 10px' }}>
                  除外した単語は候補・自動選択から外れます。解除すると次回の生成から候補に戻ります。
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {[...excluded].map((id) => (
                    <button
                      key={id}
                      type="button"
                      data-testid={`excluded-${id}`}
                      aria-label={`${excludedLabel(id)} の除外を解除`}
                      title="クリックで除外を解除"
                      onClick={() => includeExcluded(id)}
                      style={excludedChipStyle}
                    >
                      {excludedLabel(id)}
                      <span aria-hidden="true" style={chipActionIconStyle}>↩</span>
                    </button>
                  ))}
                </div>
                <button type="button" data-testid="clear-excluded" onClick={clearExcluded} style={clearExcludedStyle}>
                  すべて解除
                </button>
              </details>
            ) : null}
          </section>
          </fieldset>

          {attempted && missing.length > 0 ? (
            <div role="alert" style={alertStyle}>
              生成するには{missing.join('・')}を選んでください。
            </div>
          ) : null}

          {showPanel ? (
            <GenerationProgressPanel
              phase={generationProgress!.phase}
              startedAt={generationProgress!.startedAt}
              error={generationProgress!.error}
              onCancel={generationProgress!.onCancel}
              onRetry={generate}
            />
          ) : (
            <>
              {generationError ? (
                <div role="alert" style={alertStyle}>
                  {generationError}
                </div>
              ) : null}
              <button
                type="button"
                onClick={generate}
                disabled={generating}
                aria-busy={generating}
                style={generateButtonStyle(generating)}
              >
                {generating ? '生成しています…' : '文章を生成する'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Label({ text, hint, mb = 12 }: { text: string; hint?: string; mb?: number }) {
  return (
    <div style={{ fontFamily: fonts.ui, fontSize: 13, fontWeight: 600, color: colors.ink, marginBottom: mb }}>
      {text}
      {hint ? <span style={{ color: colors.faint, fontWeight: 400, marginLeft: 8 }}>{hint}</span> : null}
    </div>
  );
}

/** Layout-neutral reset so the wrapping <fieldset> lays sections out exactly like the old <div>. */
const fieldsetStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 30,
  border: 'none',
  margin: 0,
  padding: 0,
  minInlineSize: 0,
};

const cardStyle: CSSProperties = {
  width: '100%',
  maxWidth: 880,
  background: colors.surfaceCard,
  borderRadius: radius.card,
  boxShadow: '0 6px 32px rgba(25,40,65,.10), 0 1px 3px rgba(25,40,65,.06)',
  overflow: 'hidden',
};

const pillStyle = (on: boolean): CSSProperties => ({
  fontFamily: fonts.ui,
  fontSize: 13,
  color: on ? '#fff' : colors.inkSoft,
  background: on ? colors.primary : '#F1F4F8',
  border: on ? '1px solid transparent' : `1px solid ${colors.borderControl}`,
  borderRadius: 18,
  padding: '7px 15px',
  cursor: 'pointer',
});

const contentTypeStyle = (on: boolean): CSSProperties => ({
  flex: 1,
  textAlign: 'center',
  fontFamily: fonts.ui,
  fontSize: 13,
  fontWeight: on ? 700 : 500,
  color: on ? colors.primaryDeep : colors.faint,
  border: on ? `1.5px solid ${colors.primary}` : `1px solid ${colors.borderControl}`,
  background: on ? colors.surfaceBlue : colors.surfaceCard,
  borderRadius: radius.control,
  padding: '11px 6px',
  cursor: 'pointer',
});

const targetHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 5,
};

const targetActionsStyle: CSSProperties = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
};

const refreshButtonStyle = (busy: boolean): CSSProperties => ({
  flex: 'none',
  fontFamily: fonts.ui,
  fontSize: 12,
  fontWeight: 600,
  color: busy ? colors.faint : colors.primary,
  background: busy ? '#F4F6F9' : colors.surfaceBlue,
  border: `1px solid ${busy ? colors.borderControl : colors.primaryBorder}`,
  borderRadius: radius.chip,
  padding: '6px 12px',
  cursor: busy ? 'wait' : 'pointer',
});

const resetButtonStyle = (disabled: boolean): CSSProperties => ({
  flex: 'none',
  fontFamily: fonts.ui,
  fontSize: 12,
  fontWeight: 600,
  color: disabled ? colors.faint : colors.inkSoft,
  background: 'transparent',
  border: `1px solid ${colors.borderControl}`,
  borderRadius: radius.chip,
  padding: '6px 12px',
  cursor: disabled ? 'not-allowed' : 'pointer',
});

const targetChipStyle = (off: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: fonts.serif,
  fontSize: 14,
  color: off ? colors.faint : colors.primaryDeep,
  background: off ? '#F4F6F9' : '#EAF0F8',
  // A-2-4: a dashed border reinforces the struck-through "除外中" state alongside the ↩ affordance.
  border: `1px ${off ? 'dashed' : 'solid'} ${off ? colors.borderControl : colors.primaryBorder}`,
  borderRadius: radius.chip,
  padding: '6px 12px',
  cursor: 'pointer',
  textDecoration: off ? 'line-through' : 'none',
});

const targetReasonStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 10.5,
  color: colors.faint,
};

/** A-2-4: the trailing ×/↩ affordance icon that shows a chip is removable/restorable on click. */
const chipActionIconStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 12,
  lineHeight: 1,
  opacity: 0.7,
};

const excludedDetailsStyle: CSSProperties = {
  marginTop: 14,
  padding: '10px 12px',
  background: colors.surfaceSubtle,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: radius.control,
};

const excludedSummaryStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 12.5,
  fontWeight: 600,
  color: colors.inkSoft,
  cursor: 'pointer',
};

const excludedChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: fonts.serif,
  fontSize: 14,
  color: colors.inkSoft,
  background: colors.surfaceCard,
  border: `1px dashed ${colors.borderControl}`,
  borderRadius: radius.chip,
  padding: '6px 12px',
  cursor: 'pointer',
};

const clearExcludedStyle: CSSProperties = {
  marginTop: 10,
  fontFamily: fonts.ui,
  fontSize: 12,
  fontWeight: 600,
  color: colors.inkSoft,
  background: 'transparent',
  border: `1px solid ${colors.borderControl}`,
  borderRadius: radius.chip,
  padding: '5px 12px',
  cursor: 'pointer',
};

const addChipStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 13,
  color: colors.primary,
  background: colors.surfaceCard,
  border: `1px dashed #B6C7DD`,
  borderRadius: radius.chip,
  padding: '6px 12px',
  cursor: 'pointer',
};

const addInputStyle: CSSProperties = {
  fontFamily: fonts.serif,
  fontSize: 14,
  border: `1px solid ${colors.primaryBorder}`,
  borderRadius: radius.chip,
  padding: '6px 10px',
  width: 120,
};

const homageInputStyle: CSSProperties = {
  fontFamily: fonts.serif,
  fontSize: 14,
  border: `1px solid ${colors.borderControl}`,
  borderRadius: radius.control,
  padding: '9px 12px',
  width: '100%',
  boxSizing: 'border-box',
};

const advancedHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 12,
  marginBottom: 12,
};

const advancedStatusWrapStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  flex: 'none',
};

const advancedStatusStyle = (custom: boolean): CSSProperties => ({
  fontFamily: fonts.ui,
  fontSize: 11,
  fontWeight: 700,
  color: custom ? colors.terracotta : colors.primaryDeep,
  background: custom ? '#FBF3F0' : colors.surfaceBlue,
  border: `1px solid ${custom ? colors.terracottaBorder : colors.primaryBorder}`,
  borderRadius: radius.chip,
  padding: '4px 8px',
  whiteSpace: 'nowrap',
});

const advancedResetStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 11,
  fontWeight: 600,
  color: colors.inkSoft,
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderControl}`,
  borderRadius: radius.chip,
  padding: '4px 8px',
  cursor: 'pointer',
};

const advancedGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 12,
};

const advancedLabelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const advancedLabelTextStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 11,
  color: colors.faint,
};

const selectStyle: CSSProperties = {
  width: '100%',
  fontFamily: fonts.ui,
  fontSize: 13,
  color: colors.inkSoft,
  background: colors.surfaceCard,
  border: `1px solid ${colors.borderControl}`,
  borderRadius: radius.control,
  padding: '9px 10px',
};

const sliderHeadStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', marginBottom: 12 };
const sliderLabelStyle: CSSProperties = { fontFamily: fonts.ui, fontSize: 13, fontWeight: 600, color: colors.ink };
const sliderValueStyle: CSSProperties = { fontFamily: fonts.ui, fontSize: 13, fontWeight: 600, color: colors.primary };
const sliderEndsStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  marginTop: 7,
  fontFamily: fonts.ui,
  fontSize: 11,
  color: colors.faint,
};

const alertStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 13,
  color: colors.terracotta,
  background: '#FBF3F0',
  border: `1px solid ${colors.terracottaBorder}`,
  borderRadius: radius.control,
  padding: '11px 14px',
};

const configWarningStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 13,
  lineHeight: 1.5,
  color: colors.terracotta,
  background: '#FBF3F0',
  border: `1px solid ${colors.terracottaBorder}`,
  borderRadius: radius.control,
  padding: '12px 15px',
};

const generateButtonStyle = (busy: boolean): CSSProperties => ({
  width: '100%',
  fontFamily: fonts.ui,
  fontSize: 15,
  fontWeight: 600,
  color: '#fff',
  background: colors.primary,
  border: 'none',
  borderRadius: radius.card,
  padding: 15,
  cursor: busy ? 'wait' : 'pointer',
  opacity: busy ? 0.72 : 1,
  marginTop: 6,
});
