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
  /** Times this word has reappeared across passages (drives the consolidation note). */
  reappearCount?: number;
}

const REAPPEAR_THRESHOLD = 2;

export function StudyWordsList({ words }: { words: StudyWord[] }) {
  const reappearing = words.filter((w) => (w.reappearCount ?? 0) >= REAPPEAR_THRESHOLD);
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ fontFamily: fonts.ui, fontSize: 12, fontWeight: 600, color: colors.muted, marginBottom: 10 }}>
        学習単語 <span style={{ color: colors.fainter }}>{words.length}</span> · 習熟度に応じて再登場
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {words.map((w) => (
          <span
            key={w.wordId}
            data-testid={`study-word-${w.wordId}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: fonts.num,
              fontSize: 13,
              color: colors.ink,
              background: colors.surfaceSubtle,
              border: `1px solid ${colors.borderCard}`,
              borderRadius: radius.chip,
              padding: '4px 10px',
            }}
          >
            <MasteryDot stage={w.stage} />
            <span style={{ fontFamily: fonts.serif }}>{w.surface}</span>
          </span>
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
