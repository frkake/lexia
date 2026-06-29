/**
 * L4 — ReadingScreen (design.md "ReadingScreen", 4.1/4.5/4.6/12.4). Composes the meta
 * header, scene illustration, annotated prose (PassageRenderer) and legend into the
 * reading column, with a font-size control and a mobile back/meta affordance. Selecting a
 * word opens the WordDetailCard (injected via `renderWordDetail`). The passage comes from
 * the in-progress session unless one is passed; the right rail (NoticeRail, 8.3) and
 * per-sentence translations (SentenceTranslation, 8.2) are injected as slots.
 */

import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { PassageRenderer } from './PassageRenderer';
import { SentenceTranslation, TranslationModeToggle } from './SentenceTranslation';
import { NoticeRail } from './NoticeRail';
import { StudyWordsList, type StudyWord } from './StudyWordsList';
import { Legend } from '../shared/Legend';
import { colors, fonts, radius } from '../theme/tokens';
import { useSessionStore, sessionStore } from '../../state/stores/sessionStore';
import { useSettingsStore, settingsStore } from '../../state/stores/settingsStore';
import { usePlayerStore } from '../../state/stores/playerStore';
import type { IndexedPassage } from '../../types/domain';

const FONT_STEPS = [0.85, 1, 1.15, 1.3, 1.45];

function nearestStepIndex(scale: number): number {
  let best = 0;
  let bestDiff = Infinity;
  FONT_STEPS.forEach((s, i) => {
    const d = Math.abs(s - scale);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  });
  return best;
}

export interface ReadingScreenProps {
  passage?: IndexedPassage;
  /** Right-rail content (NoticeRail + StudyWordsList, task 8.3). */
  rail?: ReactNode;
  /** WordDetailCard renderer for the selected word (task 8.4). */
  renderWordDetail?: (wordId: string, onClose: () => void) => ReactNode;
  /** Reading-time recognition: a word tap is a lookup (RecallEventService, task 10.2). */
  onLookup?: (wordId: string) => void;
  /** Reading-time recognition: learner finished the passage without looking up the rest. */
  onCompleteReading?: () => void;
}

export function ReadingScreen({ passage, rail, renderWordDetail, onLookup, onCompleteReading }: ReadingScreenProps) {
  const navigate = useNavigate();
  const sessionPassage = useSessionStore((s) => s.passage);
  const activeWordId = useSessionStore((s) => s.activeWordId);
  const fontScale = useSettingsStore((s) => s.fontScale);
  const translationMode = useSettingsStore((s) => s.translationMode);
  // Follow-along: the TTS playhead token (HighlightController) emphasizes its span.
  const activeTokenId = usePlayerStore((s) => s.currentTokenId);

  const active = passage ?? sessionPassage;

  if (!active) {
    return (
      <div style={{ padding: '46px 60px', fontFamily: fonts.ui, color: colors.faint }}>
        読む文章がありません。セットアップから文章を生成してください。
      </div>
    );
  }

  const { meta } = active.source;
  const stepFont = (dir: 1 | -1): void => {
    const i = nearestStepIndex(fontScale);
    const next = FONT_STEPS[Math.min(FONT_STEPS.length - 1, Math.max(0, i + dir))]!;
    settingsStore.getState().setFontScale(next);
  };

  const metaLine = `${meta.theme} · LEVEL ${meta.level} · 新出 ${meta.newCount} / 復習 ${meta.reviewCount}`;
  const selectWord = (wordId: string): void => {
    onLookup?.(wordId); // a tap is a lookup → grade Again (RecallEventService, 10.2)
    sessionStore.getState().setActiveWord(wordId);
  };
  const closeDetail = (): void => sessionStore.getState().setActiveWord(null);

  // Default rail (NoticeRail + study words). Real mastery stages are layered in by the
  // wiring task (10.2) via the `rail` prop; here stages stay unset until then.
  const studyWords: StudyWord[] = [];
  const seen = new Set<string>();
  for (const t of active.source.targetSpans) {
    if (seen.has(t.wordId)) continue;
    seen.add(t.wordId);
    studyWords.push({ wordId: t.wordId, surface: t.surface, reappearCount: t.reappearInfo?.count });
  }
  const railContent = rail ?? (
    <>
      <NoticeRail passage={active} />
      <StudyWordsList words={studyWords} />
    </>
  );

  return (
    <div>
      {/* Mobile header: back + title + compact meta (12.4). CSS shows it only on narrow widths. */}
      <div className="reading-mobile-header" style={mobileHeaderStyle}>
        <button type="button" aria-label="戻る" onClick={() => navigate(-1)} style={backButtonStyle}>
          ‹
        </button>
        <div style={{ textAlign: 'center', minWidth: 0 }}>
          <div style={{ fontFamily: fonts.serifJp, fontSize: 15, fontWeight: 600, color: colors.ink }}>
            {meta.title}
          </div>
          <div style={{ fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint, marginTop: 1 }}>
            {meta.level} · 新出 {meta.newCount} / 復習 {meta.reviewCount}
          </div>
        </div>
        <span style={{ width: 34 }} />
      </div>

      <div className="reading-layout" style={{ display: 'flex', background: colors.surfacePage }}>
        <div className="reading-main" style={{ flex: 1.9, minWidth: 0, padding: '46px 60px 40px', display: 'flex', justifyContent: 'center' }}>
          <div style={{ maxWidth: 600, width: '100%' }}>
            <div className="reading-toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontFamily: fonts.ui, fontSize: 12, fontWeight: 600, letterSpacing: '.06em', color: colors.faint }}>
                {metaLine}
              </div>
              <div className="reading-toolbar-controls" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <TranslationModeToggle />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} aria-label="文字サイズ">
                  <button type="button" aria-label="文字を小さく" onClick={() => stepFont(-1)} style={sizeButtonStyle}>
                    A
                  </button>
                  <button type="button" aria-label="文字を大きく" onClick={() => stepFont(1)} style={{ ...sizeButtonStyle, fontSize: 16 }}>
                    A
                  </button>
                </div>
              </div>
            </div>

            <h1 className="reading-title" style={{ fontFamily: fonts.serifJp, fontSize: 34, fontWeight: 600, color: colors.ink, lineHeight: 1.25, margin: '0 0 24px' }}>
              {meta.title}
            </h1>

            <figure style={{ margin: '0 0 30px' }}>
              <div className="reading-illustration" style={illustrationStyle}>
                <span style={{ fontFamily: fonts.mono, fontSize: 11, letterSpacing: '.05em', color: colors.faint2 }}>
                  物語のイラスト · story illustration
                </span>
              </div>
              <figcaption style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 9, textAlign: 'center' }}>
                場面を視覚化したイラストが、単語と文脈の記憶を結びつけます
              </figcaption>
            </figure>

            <PassageRenderer
              passage={active}
              fontScale={fontScale}
              activeTokenId={activeTokenId}
              onSelectWord={selectWord}
              renderAfterSentence={(i) => (
                <SentenceTranslation text={active.source.sentences[i]?.translationJa ?? ''} mode={translationMode} />
              )}
            />

            <Legend />

            {onCompleteReading ? (
              <div style={{ marginTop: 22, display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" data-testid="reading-complete" onClick={onCompleteReading} style={completeButtonStyle}>
                  読了として記録
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <aside
          className="reading-rail"
          style={{ flex: 1, minWidth: 0, borderLeft: `1px solid ${colors.borderCard}`, background: colors.surfaceCard, padding: '30px 26px' }}
        >
          {railContent}
        </aside>
      </div>

      {activeWordId && renderWordDetail ? (
        <div role="dialog" aria-label="単語詳細" style={detailOverlayStyle}>
          {renderWordDetail(activeWordId, closeDetail)}
        </div>
      ) : null}
    </div>
  );
}

const mobileHeaderStyle: React.CSSProperties = {
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 18px 12px',
  borderBottom: `1px solid ${colors.borderCard}`,
  background: colors.surfaceCard,
};

const completeButtonStyle: React.CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 13,
  fontWeight: 600,
  color: colors.primary,
  background: colors.surfaceBlue,
  border: `1px solid ${colors.primaryBorder}`,
  borderRadius: radius.control,
  padding: '9px 16px',
  cursor: 'pointer',
};

const backButtonStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: '50%',
  background: '#F1F4F8',
  border: 'none',
  color: colors.inkSoft,
  fontSize: 18,
  cursor: 'pointer',
};

const sizeButtonStyle: React.CSSProperties = {
  fontFamily: fonts.num,
  fontSize: 12,
  color: colors.muted,
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  lineHeight: 1,
};

const illustrationStyle: React.CSSProperties = {
  width: '100%',
  height: 212,
  borderRadius: radius.card,
  background: 'repeating-linear-gradient(135deg,#EAEFF4,#EAEFF4 11px,#F3F6F9 11px,#F3F6F9 22px)',
  border: `1px solid ${colors.borderControl}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const detailOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(25,40,65,.28)',
  padding: 20,
  zIndex: 40,
};
