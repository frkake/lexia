/**
 * L4 — ReadingScreen (design.md "ReadingScreen", 4.1/4.5/4.6/12.4). Composes the meta
 * header, scene illustration, annotated prose (PassageRenderer) and legend into the
 * reading column, with a font-size control and a mobile back/meta affordance. Selecting a
 * word opens the WordDetailCard (injected via `renderWordDetail`). The passage comes from
 * the in-progress session unless one is passed; the right rail (NoticeRail, 8.3) and
 * per-sentence translations (SentenceTranslation, 8.2) are injected as slots.
 */

import { useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { PassageRenderer } from './PassageRenderer';
import { SentenceTranslation, TranslationModeToggle } from './SentenceTranslation';
import { NoticeRail } from './NoticeRail';
import { useLineAnchors } from './useLineAnchors';
import { useIsNarrow } from './useIsNarrow';
import { StudyWordsList, type StudyWord } from './StudyWordsList';
import { Legend } from '../shared/Legend';
import { colors, fonts, radius } from '../theme/tokens';
import { useSessionStore, sessionStore } from '../../state/stores/sessionStore';
import { useSettingsStore, settingsStore } from '../../state/stores/settingsStore';
import { usePlayerStore } from '../../state/stores/playerStore';
import { readingUiStore, useEffectiveCue } from '../../state/stores/readingUiStore';
import type { IndexedPassage, StoryPlan } from '../../types/domain';

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
  /** Reading-time recognition: learner finished the passage without looking up the rest. */
  onCompleteReading?: () => void;
  /** Long-story continuation: generate or open the next chapter from the current story plan. */
  onGenerateNextChapter?: () => void;
  generatingNextChapter?: boolean;
  nextChapterError?: string | null;
  /** Story-only settings scaffold shown from the body page. */
  storyPlan?: StoryPlan;
  /**
   * Feature-flag switch (6.1 / 7.4): when true, render the 3-zone layout (sentence-unit grid,
   * right-cell translation, line-aligned rail). Default false preserves the legacy reading layout.
   */
  newLayout?: boolean;
}

export function ReadingScreen({
  passage,
  rail,
  renderWordDetail,
  onCompleteReading,
  onGenerateNextChapter,
  generatingNextChapter = false,
  nextChapterError = null,
  storyPlan,
  newLayout = false,
}: ReadingScreenProps) {
  const navigate = useNavigate();
  const sessionPassage = useSessionStore((s) => s.passage);
  const activeWordId = useSessionStore((s) => s.activeWordId);
  const fontScale = useSettingsStore((s) => s.fontScale);
  const translationMode = useSettingsStore((s) => s.translationMode);
  const [storyPlanOpen, setStoryPlanOpen] = useState(false);
  // Follow-along: the TTS playhead token (HighlightController) emphasizes its span.
  const activeTokenId = usePlayerStore((s) => s.currentTokenId);

  const active = passage ?? sessionPassage;

  // 3-zone layout (6.1): the grid + line-aligned rail apply only on a WIDE viewport. On a narrow
  // viewport the layout reflows (right-cell JA drops below the English, the rail flattens) — Req 3.3.
  const isNarrow = useIsNarrow();
  const zones: 'wide' | 'narrow' | undefined = newLayout ? (isNarrow ? 'narrow' : 'wide') : undefined;
  const lineAligned = newLayout && !isNarrow;

  // Measure the in-text badge lines so the rail can align to them. Enabled only when the wide 3-zone
  // layout is active; otherwise it returns no anchors (legacy / narrow flat-flow fallback).
  const { anchors, containerRef } = useLineAnchors({
    fontScale,
    passageId: active?.passageId ?? 'none',
    enabled: lineAligned,
  });

  // Spotlight Link: the single cue lit across both columns, plus its lifecycle wiring.
  const activeCueIndex = useEffectiveCue();
  const prevPassageId = useRef<string | null>(null);
  useEffect(() => {
    // Drop any stale hover/pin when the passage actually changes (not on first mount).
    const id = active?.passageId ?? null;
    if (prevPassageId.current !== null && prevPassageId.current !== id) {
      readingUiStore.getState().reset();
    }
    prevPassageId.current = id;
  }, [active?.passageId]);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') readingUiStore.getState().clearPin();
    };
    const onClick = (e: MouseEvent): void => {
      const t = e.target as HTMLElement | null;
      // A click away from any notice handle dismisses the pinned pairing.
      if (!t?.closest?.('.notice-badge, [data-testid^="notice-item-"]')) {
        readingUiStore.getState().clearPin();
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, []);
  useEffect(() => {
    setStoryPlanOpen(false);
  }, [active?.source.meta.storyRef?.storyId]);

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

  const metaLine = `${meta.intent} · LEVEL ${meta.level} · 新出 ${meta.newCount} / 復習 ${meta.reviewCount}`;
  const selectWord = (wordId: string): void => {
    sessionStore.getState().setActiveWord(wordId);
  };
  const closeDetail = (): void => sessionStore.getState().setActiveWord(null);

  // The NoticeRail is ALWAYS owned by ReadingScreen so it receives the line-anchor `anchors`
  // (the only place that drives line-alignment in the new layout). The `rail` prop supplies the
  // study-words portion BELOW it — a route injects live, mastery-enriched study words there; when
  // absent we fall back to the bare target words derived from the passage. Injecting `rail` must
  // not bypass (or duplicate) the anchor-aware notice rail.
  const studyWords: StudyWord[] = [];
  const seen = new Set<string>();
  for (const t of active.source.targetSpans) {
    if (seen.has(t.wordId)) continue;
    seen.add(t.wordId);
    studyWords.push({ wordId: t.wordId, surface: t.surface, reappearCount: t.reappearInfo?.count });
  }
  const railContent = (
    <>
      {/* Line-aligned only on the wide 3-zone layout; flat flow on narrow / legacy. */}
      <NoticeRail passage={active} anchors={lineAligned ? anchors : undefined} />
      {rail ?? <StudyWordsList words={studyWords} onSelectWord={selectWord} />}
    </>
  );

  return (
    <div data-active-cue={activeCueIndex ?? undefined} data-reading-zones={zones}>
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
        {/* The 3-zone layout puts two sub-columns (EN+JA) in the main, so it needs a bigger share
            of the row than the legacy single-column split (1.9) to keep the English readable. */}
        <div className="reading-main" style={{ flex: zones === 'wide' ? 3 : 1.9, minWidth: 0, padding: '46px 60px 40px', display: 'flex', justifyContent: 'center' }}>
          {/*
           * The wide 3-zone grid splits this container into EN (1.6fr) + JA (1fr); at the legacy
           * 600px that strangles the English column to ~360px. Widen it so the English keeps a
           * comfortable reading measure (~575px). Legacy / narrow layouts keep the 600px column.
           */}
          <div data-testid="reading-body" style={{ maxWidth: zones === 'wide' ? 960 : 600, width: '100%' }}>
            <div className="reading-toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontFamily: fonts.ui, fontSize: 12, fontWeight: 600, letterSpacing: '.06em', color: colors.faint }}>
                {metaLine}
              </div>
              <div className="reading-toolbar-controls" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                {storyPlan ? (
                  <button type="button" data-testid="story-settings" onClick={() => setStoryPlanOpen(true)} style={storySettingsButtonStyle}>
                    物語設定
                  </button>
                ) : null}
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

            {/* The measurement container wraps the prose; useLineAnchors reads badge positions from it. */}
            <div ref={containerRef}>
              {newLayout ? (
                <PassageRenderer
                  passage={active}
                  fontScale={fontScale}
                  activeTokenId={activeTokenId}
                  onSelectWord={selectWord}
                  layout="grid"
                  renderAside={(i) => (
                    <SentenceTranslation
                      text={active.source.sentences[i]?.translationJa ?? ''}
                      mode={translationMode}
                      placement="aside"
                      spans={active.source.sentences[i]?.translationSpans}
                    />
                  )}
                />
              ) : (
                <PassageRenderer
                  passage={active}
                  fontScale={fontScale}
                  activeTokenId={activeTokenId}
                  onSelectWord={selectWord}
                  renderAfterSentence={(i) => (
                    <SentenceTranslation text={active.source.sentences[i]?.translationJa ?? ''} mode={translationMode} />
                  )}
                />
              )}
            </div>

            <Legend />

            {onCompleteReading || onGenerateNextChapter ? (
              <div style={{ marginTop: 22, display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                {nextChapterError ? (
                  <div role="alert" style={storyErrorStyle}>
                    {nextChapterError}
                  </div>
                ) : null}
                {onGenerateNextChapter ? (
                  <button
                    type="button"
                    data-testid="generate-next-chapter"
                    onClick={onGenerateNextChapter}
                    disabled={generatingNextChapter}
                    aria-busy={generatingNextChapter}
                    style={nextChapterButtonStyle(generatingNextChapter)}
                  >
                    {generatingNextChapter ? '続きを生成しています…' : '続きを生成'}
                  </button>
                ) : null}
                {onCompleteReading ? (
                  <button type="button" data-testid="reading-complete" onClick={onCompleteReading} style={completeButtonStyle}>
                    読了として記録
                  </button>
                ) : null}
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
        <div
          role="dialog"
          aria-label="単語詳細"
          style={detailOverlayStyle}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeDetail();
          }}
        >
          {renderWordDetail(activeWordId, closeDetail)}
        </div>
      ) : null}

      {storyPlan && storyPlanOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="物語設定"
          style={detailOverlayStyle}
          onClick={(event) => {
            if (event.target === event.currentTarget) setStoryPlanOpen(false);
          }}
        >
          <StoryPlanDialog plan={storyPlan} onClose={() => setStoryPlanOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}

function StoryPlanDialog({ plan, onClose }: { plan: StoryPlan; onClose: () => void }) {
  const contentType = plan.contentType === 'long_story' ? '長編物語' : '短編物語';
  return (
    <section style={storyDialogStyle}>
      <div style={storyDialogHeaderStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginBottom: 4 }}>
            {contentType} · {plan.genre}
          </div>
          <h2 style={storyDialogTitleStyle}>{plan.titleJa}</h2>
        </div>
        <button type="button" aria-label="物語設定を閉じる" onClick={onClose} style={storyDialogCloseStyle}>
          ×
        </button>
      </div>

      <div style={storyDialogBodyStyle}>
        <section>
          <h3 style={storySectionTitleStyle}>物語全体の概要</h3>
          <p style={storySynopsisStyle}>{plan.synopsisJa}</p>
          {plan.homage?.title ? (
            <p style={storyMetaNoteStyle}>参考スタイル: {plan.homage.title}</p>
          ) : null}
        </section>

        <section>
          <h3 style={storySectionTitleStyle}>キャラクター設定</h3>
          <div style={storyCharacterListStyle}>
            {plan.characters.map((character) => (
              <article key={`${character.name}:${character.role}`} style={storyCharacterItemStyle}>
                {character.illustrationUrl ? (
                  <img src={character.illustrationUrl} alt={character.name} style={storyCharacterImageStyle} />
                ) : (
                  <div aria-hidden="true" style={storyCharacterInitialStyle}>
                    {[...character.name][0] ?? '?'}
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: fonts.serif, fontSize: 16, fontWeight: 600, color: colors.ink }}>
                    {character.name}
                  </div>
                  <div style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 1 }}>
                    {character.role}
                  </div>
                  <div style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.inkSoft, marginTop: 5, lineHeight: 1.55 }}>
                    {character.descriptionJa}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section>
          <h3 style={storySectionTitleStyle}>プロット</h3>
          <ol style={storyPlotListStyle}>
            {plan.chapters.map((chapter) => (
              <li key={chapter.index} style={storyPlotItemStyle}>
                <span style={{ fontWeight: 600, color: colors.ink }}>{chapter.headingJa}</span>
                {chapter.beatJa ? <span style={{ color: colors.inkSoft }}> {chapter.beatJa}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </section>
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

const storySettingsButtonStyle: React.CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 12.5,
  fontWeight: 600,
  color: colors.primary,
  background: colors.surfaceBlue,
  border: `1px solid ${colors.primaryBorder}`,
  borderRadius: radius.control,
  padding: '7px 11px',
  cursor: 'pointer',
};

const nextChapterButtonStyle = (busy: boolean): React.CSSProperties => ({
  fontFamily: fonts.ui,
  fontSize: 13,
  fontWeight: 600,
  color: '#fff',
  background: colors.primary,
  border: 'none',
  borderRadius: radius.control,
  padding: '9px 16px',
  cursor: busy ? 'wait' : 'pointer',
  opacity: busy ? 0.72 : 1,
});

const storyErrorStyle: React.CSSProperties = {
  flexBasis: '100%',
  fontFamily: fonts.ui,
  fontSize: 12,
  color: colors.terracotta,
  background: '#FBF3F0',
  border: `1px solid ${colors.terracottaBorder}`,
  borderRadius: radius.control,
  padding: '8px 11px',
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

const storyDialogStyle: React.CSSProperties = {
  width: 'min(760px, 100%)',
  maxHeight: 'min(82vh, 760px)',
  display: 'flex',
  flexDirection: 'column',
  background: colors.surfaceCard,
  borderRadius: radius.card,
  boxShadow: '0 18px 60px rgba(25,40,65,.24), 0 2px 8px rgba(25,40,65,.10)',
  overflow: 'hidden',
};

const storyDialogHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 18,
  padding: '22px 26px 18px',
  borderBottom: `1px solid ${colors.borderCard}`,
};

const storyDialogTitleStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: fonts.serifJp,
  fontSize: 25,
  fontWeight: 600,
  lineHeight: 1.25,
  color: colors.ink,
};

const storyDialogCloseStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  flex: '0 0 auto',
  border: `1px solid ${colors.borderControl}`,
  borderRadius: radius.control,
  background: colors.surfaceCard,
  color: colors.inkSoft,
  fontSize: 20,
  lineHeight: 1,
  cursor: 'pointer',
};

const storyDialogBodyStyle: React.CSSProperties = {
  overflowY: 'auto',
  padding: '22px 26px 26px',
  display: 'flex',
  flexDirection: 'column',
  gap: 22,
};

const storySectionTitleStyle: React.CSSProperties = {
  margin: '0 0 9px',
  fontFamily: fonts.ui,
  fontSize: 13,
  fontWeight: 700,
  color: colors.ink,
};

const storySynopsisStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: fonts.ui,
  fontSize: 14,
  lineHeight: 1.75,
  color: colors.inkSoft,
};

const storyMetaNoteStyle: React.CSSProperties = {
  margin: '8px 0 0',
  fontFamily: fonts.ui,
  fontSize: 12,
  color: colors.faint,
};

const storyCharacterListStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
  gap: 9,
};

const storyCharacterItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 11,
  padding: '11px 12px',
  border: `1px solid ${colors.borderControl}`,
  borderRadius: radius.control,
  background: colors.surfaceSubtle,
};

const storyCharacterImageStyle: React.CSSProperties = {
  width: 52,
  height: 52,
  flex: '0 0 auto',
  objectFit: 'cover',
  borderRadius: radius.control,
  background: colors.avatarBg,
};

const storyCharacterInitialStyle: React.CSSProperties = {
  width: 52,
  height: 52,
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: `1px solid ${colors.borderControl}`,
  borderRadius: radius.control,
  background: colors.surfaceCard,
  fontFamily: fonts.serif,
  fontSize: 20,
  fontWeight: 600,
  color: colors.muted,
};

const storyPlotListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 22,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const storyPlotItemStyle: React.CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 13,
  lineHeight: 1.55,
};
