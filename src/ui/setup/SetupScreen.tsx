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

import { useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { colors, fonts, radius } from '../theme/tokens';
import { ExamLevelPicker } from './ExamLevelPicker';
import { WordTargetSlider } from './WordTargetSlider';
import { lengthSpec } from '../../domain/generation/lengthSpec';
import type { ContentType, ExamCriterion, LearningIntent, SetupConfig, StoryGenre } from '../../types/domain';

export interface CandidateWord {
  wordId: string;
  surface: string;
}

export interface SetupScreenProps {
  /** Auto-selected candidate words (WordSuggestionService / SessionPlanner). */
  candidates?: CandidateWord[];
  /** Notice shown when fewer candidates than requested were available (Requirement 5.5). */
  suggestionShortfall?: string | null;
  /** Seed values (e.g. settingsStore.lastSetup); examTarget may be unset to force a choice. */
  initial?: Partial<SetupConfig>;
  /** Receives the assembled config once required conditions are met. */
  onGenerate?: (setup: SetupConfig) => void;
  generating?: boolean;
  generationError?: string | null;
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
];

const GENRES: { value: StoryGenre; label: string }[] = [
  { value: 'fantasy', label: 'ファンタジー' },
  { value: 'sci_fi', label: 'SF' },
  { value: 'mystery', label: 'ミステリー' },
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

export function SetupScreen({
  candidates = [],
  suggestionShortfall = null,
  initial,
  onGenerate,
  generating = false,
  generationError = null,
}: SetupScreenProps) {
  const candidateIds = useMemo(() => new Set(candidates.map((c) => c.wordId)), [candidates]);

  const [examTarget, setExamTarget] = useState<ExamCriterion | undefined>(initial?.examTarget);
  const [intent, setIntent] = useState<LearningIntent>(initial?.intent ?? 'daily');
  const [newWordRatio, setNewWordRatio] = useState<number>(initial?.newWordRatio ?? 0.3);
  const [contentType, setContentType] = useState<ContentType>(initial?.contentType ?? 'article');
  const [wordTarget, setWordTarget] = useState<number>(initial?.wordTarget ?? DEFAULT_WORD_TARGET);
  const [genre, setGenre] = useState<StoryGenre>(initial?.storyOptions?.genre ?? 'fantasy');
  const [homageTitle, setHomageTitle] = useState<string>(initial?.storyOptions?.homageTitle ?? '');
  const [excluded, setExcluded] = useState<Set<string>>(new Set(initial?.excludedWordIds ?? []));
  const [added, setAdded] = useState<string[]>(
    () => (initial?.targetWordIds ?? []).filter((id) => !candidateIds.has(id)),
  );
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [attempted, setAttempted] = useState(false);

  const isStory = contentType !== 'article';

  const targetWordIds = useMemo(() => {
    const ids = candidates.filter((c) => !excluded.has(c.wordId)).map((c) => c.wordId);
    for (const id of added) if (!ids.includes(id)) ids.push(id);
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

  const removeAdded = (wordId: string): void => setAdded((prev) => prev.filter((x) => x !== wordId));

  const commitAdd = (e: FormEvent): void => {
    e.preventDefault();
    const word = draft.trim();
    if (word && !targetWordIds.includes(word)) setAdded((prev) => [...prev, word]);
    setDraft('');
    setAdding(false);
  };

  const generate = (): void => {
    setAttempted(true);
    if (missing.length > 0 || !examTarget) return;
    const effectiveWordTarget = clampWordTarget(contentType, wordTarget);
    onGenerate?.({
      examTarget,
      intent,
      newWordRatio,
      wordTarget: effectiveWordTarget,
      contentType,
      ...(isStory
        ? { storyOptions: { genre, ...(homageTitle.trim() ? { homageTitle: homageTitle.trim() } : {}) } }
        : {}),
      targetWordIds,
      excludedWordIds: [...excluded],
    });
  };

  return (
    <div className="setup-page" style={{ display: 'flex', justifyContent: 'center', background: colors.surfacePage, padding: '40px 24px' }}>
      <div className="setup-card" style={cardStyle}>
        <div style={{ padding: '34px 40px 30px' }}>
          <h1 style={{ fontFamily: fonts.serifJp, fontSize: 27, fontWeight: 500, color: colors.ink, margin: 0 }}>
            学習をはじめる
          </h1>
          <div style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.muted, marginTop: 5 }}>
            あなたの未学習・苦手な単語を織り込んだ文章を生成します。
          </div>
        </div>

        <div style={{ padding: '0 40px 36px', display: 'flex', flexDirection: 'column', gap: 30 }}>
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
            <ExamLevelPicker value={examTarget ?? DEFAULT_EXAM} onChange={setExamTarget} />
            {!examTarget ? (
              <div style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 8 }}>
                目標レベルを選ぶと生成できます。
              </div>
            ) : null}
          </section>

          {/* Content type */}
          <section>
            <Label text="コンテンツ種別" />
            <div style={{ display: 'flex', gap: 8 }}>
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
            <Label text="今回織り込む単語" hint="未学習・苦手から自動提案" mb={5} />
            <div style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginBottom: 12 }}>
              指定しない場合は、選んだレベルと趣向に合わせた文章を生成します
            </div>
            {suggestionShortfall ? (
              <div style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.terracotta, marginBottom: 12 }}>
                {suggestionShortfall}
              </div>
            ) : null}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {candidates.map((c) => {
                const off = excluded.has(c.wordId);
                return (
                  <button
                    key={c.wordId}
                    type="button"
                    data-testid={`target-${c.wordId}`}
                    aria-pressed={!off}
                    onClick={() => toggleExclude(c.wordId)}
                    style={targetChipStyle(off)}
                  >
                    {c.surface}
                  </button>
                );
              })}
              {added.map((w) => (
                <button
                  key={`added-${w}`}
                  type="button"
                  data-testid={`target-${w}`}
                  aria-pressed
                  onClick={() => removeAdded(w)}
                  style={targetChipStyle(false)}
                >
                  {w}
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
          </section>

          {attempted && missing.length > 0 ? (
            <div role="alert" style={alertStyle}>
              生成するには{missing.join('・')}を選んでください。
            </div>
          ) : null}

          {generationError ? (
            <div role="alert" style={alertStyle}>
              {generationError}
            </div>
          ) : null}

          <button type="button" onClick={generate} disabled={generating} aria-busy={generating} style={generateButtonStyle(generating)}>
            {generating ? '生成しています…' : '文章を生成する'}
          </button>
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

const targetChipStyle = (off: boolean): CSSProperties => ({
  fontFamily: fonts.serif,
  fontSize: 14,
  color: off ? colors.faint : colors.primaryDeep,
  background: off ? '#F4F6F9' : '#EAF0F8',
  border: `1px solid ${off ? colors.borderControl : colors.primaryBorder}`,
  borderRadius: radius.chip,
  padding: '6px 12px',
  cursor: 'pointer',
  textDecoration: off ? 'line-through' : 'none',
});

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
