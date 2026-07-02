/**
 * L4 — StudyWordsList (design.md Reading right rail, 6.3/6.4). Lists the passage's study
 * words as mastery-dotted chips and supplements re-appearing words (reappearCount ≥ 2) with
 * a consolidation note explaining the spaced re-exposure. Purely presentational; the caller
 * builds the list from the passage targets + reactive scheduling (useScheduling).
 */

import { MasteryDot } from '../shared/MasteryDot';
import { colors, fonts, radius } from '../theme/tokens';
import type { MasteryStage } from '../../types/domain';

export interface StudyWord {
  wordId: string;
  surface: string;
  stage?: MasteryStage;
  meaningJa?: string;
  collocation?: string;
  register?: string;
  connotation?: string;
  frequency?: number;
  memoryTipJa?: string;
  /** Times this word has reappeared across passages (drives the consolidation note). */
  reappearCount?: number;
}

const REAPPEAR_THRESHOLD = 2;

export interface StudyWordsListProps {
  words: StudyWord[];
  onSelectWord?: (wordId: string) => void;
  onPlayWord?: (wordId: string) => void;
}

function frequencyText(value?: number): string | null {
  if (value === undefined) return null;
  return `頻度 ${Math.max(1, Math.min(5, value))}/5`;
}

export function StudyWordsList({ words, onSelectWord, onPlayWord }: StudyWordsListProps) {
  const reappearing = words.filter((w) => (w.reappearCount ?? 0) >= REAPPEAR_THRESHOLD);
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ fontFamily: fonts.ui, fontSize: 12, fontWeight: 600, color: colors.muted, marginBottom: 10 }}>
        学習単語 <span style={{ color: colors.fainter }}>{words.length}</span> · 習熟度に応じて再登場
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {words.map((w) => (
          <div
            key={w.wordId}
            data-testid={`study-word-${w.wordId}`}
            role={onSelectWord ? 'button' : undefined}
            tabIndex={onSelectWord ? 0 : undefined}
            onClick={() => onSelectWord?.(w.wordId)}
            onKeyDown={(event) => {
              if (!onSelectWord) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelectWord(w.wordId);
              }
            }}
            style={{
              display: 'grid',
              gridTemplateColumns: onPlayWord ? 'minmax(0, 1fr) 28px' : 'minmax(0, 1fr)',
              gap: 8,
              alignItems: 'start',
              fontFamily: fonts.bodyJp,
              fontSize: 12.5,
              color: colors.ink,
              background: colors.surfaceCard,
              border: `1px solid ${colors.borderCard}`,
              borderRadius: radius.card,
              padding: '10px 11px',
              cursor: onSelectWord ? 'pointer' : 'default',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                <MasteryDot stage={w.stage} />
                <span style={{ fontFamily: fonts.serif, fontSize: 15, color: colors.ink }}>{w.surface}</span>
                {frequencyText(w.frequency) ? (
                  <span style={{ fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint }}>
                    {frequencyText(w.frequency)}
                  </span>
                ) : null}
              </div>
              {w.meaningJa ? (
                <div style={{ marginTop: 5, lineHeight: 1.55, color: colors.inkSoft }}>{w.meaningJa}</div>
              ) : null}
              {w.collocation || w.register || w.connotation ? (
                <div style={{ marginTop: 7, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {w.collocation ? <span style={miniChipStyle}>{w.collocation}</span> : null}
                  {w.register ? <span style={miniChipStyle}>{w.register}</span> : null}
                  {w.connotation ? <span style={miniChipStyle}>{w.connotation}</span> : null}
                </div>
              ) : null}
              {w.memoryTipJa ? (
                <div style={{ marginTop: 7, lineHeight: 1.55, color: colors.greenDeep }}>
                  {w.memoryTipJa}
                </div>
              ) : null}
            </div>
            {onPlayWord ? (
              <button
                type="button"
                aria-label={`${w.surface} の発音を再生`}
                onClick={(event) => {
                  event.stopPropagation();
                  onPlayWord(w.wordId);
                }}
                style={audioButtonStyle}
              >
                ▶
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {reappearing.map((w) => (
        <div
          key={`note-${w.wordId}`}
          style={{
            marginTop: 20,
            background: colors.surfaceSubtle,
            borderRadius: radius.card,
            padding: '15px 16px',
            border: `1px solid ${colors.borderCard}`,
            fontFamily: fonts.bodyJp,
            fontSize: 12.5,
            lineHeight: 1.7,
            color: colors.inkSoft,
          }}
        >
          <b style={{ color: colors.ink }}>{w.surface}</b> は今回が{w.reappearCount}回目。
          違う文脈で再登場させ、次第に注釈を減らして定着させます。
        </div>
      ))}
    </div>
  );
}

const miniChipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 20,
  fontFamily: fonts.ui,
  fontSize: 10.5,
  color: colors.primaryDeep,
  background: colors.surfaceBlue,
  borderRadius: radius.chip,
  padding: '2px 7px',
} as const;

const audioButtonStyle = {
  width: 26,
  height: 26,
  borderRadius: '50%',
  border: `1px solid ${colors.primaryBorder2}`,
  background: colors.surfaceBlue,
  color: colors.primary,
  fontSize: 10,
  cursor: 'pointer',
} as const;
