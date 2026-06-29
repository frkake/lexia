/**
 * L4 — SetupScreen (design.md "SetupScreen", 2.1–2.7; Setup frame). Lets the learner
 * pick a CEFR level (single), themes (multi), the new-word ratio and passage length, and
 * curate the auto-selected target words (exclude a candidate, add a manual one). The
 * required conditions — a level and ≥1 target word — gate generation: when unmet the
 * screen surfaces the missing items instead of generating (2.7); when met it emits the
 * assembled SetupConfig via `onGenerate` (the wiring layer hands it to SessionPlanner).
 * Presentational: candidates are injected (SessionPlanner.selectCandidates) and the
 * generation/persistence wiring lives in task 10.
 */

import { useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { colors, fonts, radius } from '../theme/tokens';
import type { Cefr, SetupConfig } from '../../types/domain';

export interface CandidateWord {
  wordId: string;
  surface: string;
}

export interface SetupScreenProps {
  /** Auto-selected candidate words (SessionPlanner.selectCandidates). */
  candidates?: CandidateWord[];
  /** Seed values (e.g. settingsStore.lastSetup); level may be unset to force a choice. */
  initial?: Partial<SetupConfig>;
  /** Receives the assembled config once required conditions are met. */
  onGenerate?: (setup: SetupConfig) => void;
}

const LEVELS: { level: Cefr; toeic: string }[] = [
  { level: 'A2', toeic: '~450' },
  { level: 'B1', toeic: '~600' },
  { level: 'B2', toeic: '~785' },
  { level: 'C1', toeic: '~945' },
  { level: 'C2', toeic: '945+' },
];

const THEMES = ['交渉', '会議', 'メール', 'プレゼン', '財務', 'マーケティング', '人事', '出張'];

const LENGTHS: { value: SetupConfig['length']; label: string }[] = [
  { value: 'short', label: '短 · 約120語' },
  { value: 'medium', label: '中 · 約250語' },
  { value: 'long', label: '長 · 約400語' },
];

/** Which required conditions (level, ≥1 target word) are still unmet (2.7). */
export function setupMissing(level: Cefr | undefined, targetWordIds: string[]): string[] {
  const missing: string[] = [];
  if (!level) missing.push('レベル');
  if (targetWordIds.length === 0) missing.push('対象単語（1語以上）');
  return missing;
}

export function SetupScreen({ candidates = [], initial, onGenerate }: SetupScreenProps) {
  const candidateIds = useMemo(() => new Set(candidates.map((c) => c.wordId)), [candidates]);

  const [level, setLevel] = useState<Cefr | undefined>(initial?.level);
  const [themes, setThemes] = useState<string[]>(initial?.themes ?? []);
  const [newWordRatio, setNewWordRatio] = useState<number>(initial?.newWordRatio ?? 0.3);
  const [length, setLength] = useState<SetupConfig['length']>(initial?.length ?? 'medium');
  const [excluded, setExcluded] = useState<Set<string>>(new Set(initial?.excludedWordIds ?? []));
  // Manually added words = seeded targets not present among the auto-selected candidates.
  const [added, setAdded] = useState<string[]>(
    () => (initial?.targetWordIds ?? []).filter((id) => !candidateIds.has(id)),
  );
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [attempted, setAttempted] = useState(false);

  const targetWordIds = useMemo(() => {
    const ids = candidates.filter((c) => !excluded.has(c.wordId)).map((c) => c.wordId);
    for (const id of added) if (!ids.includes(id)) ids.push(id);
    return ids;
  }, [candidates, excluded, added]);

  const missing = setupMissing(level, targetWordIds);

  const toggleTheme = (t: string): void =>
    setThemes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

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
    if (missing.length > 0) return;
    onGenerate?.({
      level: level!,
      themes,
      newWordRatio,
      length,
      targetWordIds,
      excludedWordIds: [...excluded],
    });
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', background: colors.surfacePage, padding: '40px 24px' }}>
      <div style={cardStyle}>
        <div style={{ padding: '34px 40px 30px' }}>
          <h1 style={{ fontFamily: fonts.serifJp, fontSize: 27, fontWeight: 500, color: colors.ink, margin: 0 }}>
            学習をはじめる
          </h1>
          <div style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.muted, marginTop: 5 }}>
            あなたの未学習・苦手な単語を織り込んだ文章を生成します。
          </div>
        </div>

        <div style={{ padding: '0 40px 36px', display: 'flex', flexDirection: 'column', gap: 30 }}>
          {/* Level */}
          <section>
            <Label text="レベル" hint="CEFR / TOEIC" />
            <div style={{ display: 'flex', gap: 8 }}>
              {LEVELS.map(({ level: l, toeic }) => {
                const on = level === l;
                return (
                  <button
                    key={l}
                    type="button"
                    data-testid={`level-${l}`}
                    aria-pressed={on}
                    onClick={() => setLevel(l)}
                    style={levelStyle(on)}
                  >
                    <div style={{ fontFamily: fonts.num, fontSize: 14, fontWeight: on ? 700 : 600, color: on ? colors.primaryDeep : colors.faint }}>
                      {l}
                    </div>
                    <div style={{ fontFamily: fonts.num, fontSize: 11, color: on ? colors.primarySoft : colors.fainter, marginTop: 2 }}>
                      {toeic}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Themes */}
          <section>
            <Label text="テーマ・分野" hint="複数選択可" />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {THEMES.map((t) => {
                const on = themes.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    data-testid={`theme-${t}`}
                    aria-pressed={on}
                    onClick={() => toggleTheme(t)}
                    style={pillStyle(on)}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Sliders */}
          <section style={{ display: 'flex', gap: 30 }}>
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
              <div style={sliderHeadStyle}>
                <span style={sliderLabelStyle}>文章の長さ</span>
                <span style={sliderValueStyle}>{LENGTHS.find((x) => x.value === length)?.label}</span>
              </div>
              <input
                type="range"
                aria-label="文章の長さ"
                min={0}
                max={2}
                step={1}
                value={LENGTHS.findIndex((x) => x.value === length)}
                onChange={(e) => setLength(LENGTHS[Number(e.target.value)]!.value)}
                style={{ width: '100%', accentColor: colors.primary }}
              />
              <div style={sliderEndsStyle}>
                <span>短</span>
                <span>長</span>
              </div>
            </div>
          </section>

          {/* Target words */}
          <section>
            <Label text="今回織り込む単語" hint="未学習・苦手から自動選定" mb={5} />
            <div style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginBottom: 12 }}>
              不要な単語はタップで外せます
            </div>
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
                  <input
                    aria-label="追加する単語"
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    style={addInputStyle}
                  />
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

          <button type="button" onClick={generate} style={generateButtonStyle}>
            文章を生成する
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

const levelStyle = (on: boolean): CSSProperties => ({
  flex: 1,
  textAlign: 'center',
  border: on ? `1.5px solid ${colors.primary}` : `1px solid ${colors.borderControl}`,
  background: on ? colors.surfaceBlue : colors.surfaceCard,
  borderRadius: radius.control,
  padding: '11px 6px',
  cursor: 'pointer',
});

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

const generateButtonStyle: CSSProperties = {
  width: '100%',
  fontFamily: fonts.ui,
  fontSize: 15,
  fontWeight: 600,
  color: '#fff',
  background: colors.primary,
  border: 'none',
  borderRadius: radius.card,
  padding: 15,
  cursor: 'pointer',
  marginTop: 6,
};
