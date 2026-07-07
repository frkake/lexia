/**
 * L4 — ReadingScreen (design.md "ReadingScreen", 4.1/4.5/4.6/12.4). Composes the meta
 * header, scene illustration, annotated prose (PassageRenderer) and legend into the
 * reading column, with a font-size control and a mobile back/meta affordance. Selecting a
 * word opens the WordDetailCard (injected via `renderWordDetail`). The passage comes from
 * the in-progress session unless one is passed; the right rail is a unified ReadingGuideRail
 * that merges study words and remaining notices at their first appearance.
 */

import { useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { PassageRenderer } from './PassageRenderer';
import { SentenceTranslation, TranslationModeToggle } from './SentenceTranslation';
import { ReadingGuideRail, buildReadingGuide } from './ReadingGuideRail';
import { useLineAnchors } from './useLineAnchors';
import { useSentenceTracking, SENTENCE_INDEX_ATTR } from './useSentenceTracking';
import { useIsNarrow } from './useIsNarrow';
import type { StudyWord } from './StudyWordsList';
import { Legend } from '../shared/Legend';
import { AssetImage } from '../shared/AssetImage';
import { colors, fonts, radius } from '../theme/tokens';
import { useSessionStore, sessionStore } from '../../state/stores/sessionStore';
import { useSettingsStore, settingsStore } from '../../state/stores/settingsStore';
import { usePlayerStore } from '../../state/stores/playerStore';
import { readingUiStore, useEffectiveCue } from '../../state/stores/readingUiStore';
import type { IndexedPassage, StoryCharacter, StoryPlan } from '../../types/domain';

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

/** Read-through completion credit summary (C-5d): total study words and how many still need review. */
export interface ReadingCompletionSummary {
  total: number;
  needReview: number;
}

export interface ReadingScreenProps {
  passage?: IndexedPassage;
  /** Live, mastery-enriched study words for the unified learning guide. */
  studyWords?: StudyWord[];
  onPlayWord?: (wordId: string) => void;
  /** WordDetailCard renderer for the selected word (task 8.4). */
  renderWordDetail?: (wordId: string, onClose: () => void) => ReactNode;
  /** Direct right-rail recognition: mark a word or expression as unknown without opening details. */
  onMarkUnknown?: (targetId: string) => void | Promise<void>;
  /** A word detail card was opened (C-5d): the wiring fires a `lookup` recall signal. */
  onOpenWordDetail?: (wordId: string) => void;
  /**
   * Reading-time recognition: learner finished the passage without looking up the rest. Resolves to
   * a credit summary (C-5d) so the completion feedback can show how many words were credited and how
   * many still need review.
   */
  onCompleteReading?: () => void | Promise<ReadingCompletionSummary | void>;
  /** Long-story continuation: generate or open the next chapter from the current story plan. */
  onGenerateNextChapter?: () => void;
  generatingNextChapter?: boolean;
  nextChapterError?: string | null;
  /** On-demand scene illustration refresh. Existing art stays visible if refresh fails. */
  onRegenerateIllustration?: () => void;
  regeneratingIllustration?: boolean;
  illustrationError?: string | null;
  /**
   * F-6: re-run the annotation pass when it failed/partial for this passage. Wired only when the
   * gateway supports annotation; the banner shows whenever `meta.annotationStatus` is failed/partial.
   */
  onRegenerateAnnotation?: () => void;
  regeneratingAnnotation?: boolean;
  annotationError?: string | null;
  /** Story-only settings scaffold shown from the body page. */
  storyPlan?: StoryPlan;
  onRegenerateStoryCharacter?: (characterIndex: number) => void;
  regeneratingStoryCharacterIndex?: number | null;
  storyCharacterError?: string | null;
  /**
   * Feature-flag switch (6.1 / 7.4): when true, render the 3-zone layout (sentence-unit grid,
   * right-cell translation, line-aligned rail). Default false preserves the legacy reading layout.
   */
  newLayout?: boolean;
}

export function ReadingScreen({
  passage,
  studyWords: suppliedStudyWords,
  onPlayWord,
  renderWordDetail,
  onMarkUnknown,
  onOpenWordDetail,
  onCompleteReading,
  onGenerateNextChapter,
  generatingNextChapter = false,
  nextChapterError = null,
  onRegenerateIllustration,
  regeneratingIllustration = false,
  illustrationError = null,
  onRegenerateAnnotation,
  regeneratingAnnotation = false,
  annotationError = null,
  storyPlan,
  onRegenerateStoryCharacter,
  regeneratingStoryCharacterIndex = null,
  storyCharacterError = null,
  newLayout = false,
}: ReadingScreenProps) {
  const navigate = useNavigate();
  const sessionPassage = useSessionStore((s) => s.passage);
  const activeWordId = useSessionStore((s) => s.activeWordId);
  const sessionStatus = useSessionStore((s) => s.status);
  const fontScale = useSettingsStore((s) => s.fontScale);
  const translationMode = useSettingsStore((s) => s.translationMode);
  const [storyPlanOpen, setStoryPlanOpen] = useState(false);
  // F-2: "前回の位置から再開しました" snackbar, shown when a saved position was restored on open.
  const [restoreNotice, setRestoreNotice] = useState(false);
  // C-5d read-through completion feedback: `completing` disables the button during the async write;
  // `completionSummary` holds the credited/needs-review counts to show afterward.
  const [completing, setCompleting] = useState(false);
  const [completionSummary, setCompletionSummary] = useState<ReadingCompletionSummary | null>(null);
  // F-9: sentence indexes whose 和訳 is revealed in per-sentence mode. Lifted here (from the
  // per-block local state) so a session-level "すべて開く / すべて閉じる" can drive every block and
  // so the reveal survives toolbar/mode re-renders while this passage stays open.
  const [openTranslations, setOpenTranslations] = useState<Set<number>>(() => new Set());
  // Follow-along: the TTS playhead token (HighlightController) emphasizes its span.
  const activeTokenId = usePlayerStore((s) => s.currentTokenId);

  const active = passage ?? sessionPassage;
  // Only drive/track the shared session position when this screen shows the session's own passage
  // (a standalone `passage` prop — e.g. the gallery — has no session position to track/restore).
  const tracksSession = !!active && sessionPassage?.passageId === active.passageId;

  // 3-zone layout (6.1): the grid + line-aligned rail apply only on a WIDE viewport. On a narrow
  // viewport the layout reflows (right-cell JA drops below the English, the rail flattens) — Req 3.3.
  const isNarrow = useIsNarrow();
  const zones: 'wide' | 'narrow' | undefined = newLayout ? (isNarrow ? 'narrow' : 'wide') : undefined;
  const lineAligned = newLayout && !isNarrow;

  // Measure the in-text badge lines so the rail can align to them. Enabled only when the wide 3-zone
  // layout is active; otherwise it returns no anchors (legacy / narrow flat-flow fallback).
  const { anchors, containerRef, frameRef, remeasure } = useLineAnchors({
    fontScale,
    passageId: active?.passageId ?? 'none',
    enabled: lineAligned,
  });

  // F-2: auto-advance the reading position as the learner scrolls past sentences, and offer a
  // "先頭から読む" reset (which re-subscribes the observer via a bumped `trackReset` watermark).
  const [trackReset, setTrackReset] = useState(0);
  useSentenceTracking({
    containerRef,
    passageId: active?.passageId ?? 'none',
    sentenceCount: active?.sentences.length ?? 0,
    enabled: tracksSession,
    resetKey: trackReset,
    onReach: (idx) => {
      const s = sessionStore.getState();
      if (s.passage?.passageId !== active?.passageId) return;
      if (idx > s.sentenceIndex) s.updateProgress(idx);
    },
  });

  // F-2: restore scroll — the first time a passage with a saved position is shown, center that
  // sentence and surface the resume snackbar. `openPassage` has already seeded the session position.
  const restoredForPassage = useRef<string | null>(null);
  useEffect(() => {
    const id = active?.passageId ?? null;
    if (!tracksSession || id === null) {
      setRestoreNotice(false);
      return;
    }
    if (restoredForPassage.current === id) return;
    restoredForPassage.current = id;
    const savedIndex = sessionStore.getState().sentenceIndex;
    if (savedIndex <= 0) {
      setRestoreNotice(false);
      return;
    }
    setRestoreNotice(true);
    const scrollToSaved = (): void => {
      const el = containerRef.current?.querySelector<HTMLElement>(`[${SENTENCE_INDEX_ATTR}="${savedIndex}"]`);
      el?.scrollIntoView?.({ block: 'center' });
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(scrollToSaved);
    else scrollToSaved();
  }, [active?.passageId, tracksSession, containerRef]);

  const restartFromTop = (): void => {
    setRestoreNotice(false);
    const s = sessionStore.getState();
    if (s.passage?.passageId === active?.passageId) s.updateProgress(0);
    setTrackReset((n) => n + 1); // fresh watermark so scrolling doesn't snap back to the saved spot
    const el = containerRef.current?.querySelector<HTMLElement>(`[${SENTENCE_INDEX_ATTR}="0"]`);
    el?.scrollIntoView?.({ block: 'start' });
  };

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
  // C-5d: a fresh passage starts un-completed (a prior passage's summary must not leak across).
  // F-9: also drop the per-sentence 和訳 reveal set — indexes are reused across passages.
  useEffect(() => {
    setCompletionSummary(null);
    setCompleting(false);
    setOpenTranslations(new Set());
  }, [active?.passageId]);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') readingUiStore.getState().clearPin();
    };
    const onClick = (e: MouseEvent): void => {
      const t = e.target as HTMLElement | null;
      // A click away from any guide/badge handle dismisses the pinned pairing.
      if (!t?.closest?.('.notice-badge, [data-guide-kind]')) {
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

  const fallbackStudyWords = useMemo<StudyWord[]>(() => {
    if (!active) return [];
    const words: StudyWord[] = [];
    const seen = new Set<string>();
    const ordered = [...active.source.targetSpans].sort(
      (a, b) => a.sentenceIndex - b.sentenceIndex || a.tokenStart - b.tokenStart || a.tokenEnd - b.tokenEnd,
    );
    for (const t of ordered) {
      const key = t.wordId.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      words.push({ wordId: t.wordId, surface: t.wordId.trim() || t.surface, reappearCount: t.reappearInfo?.count });
    }
    return words;
  }, [active]);
  const effectiveStudyWords = suppliedStudyWords ?? fallbackStudyWords;
  const guide = useMemo(
    () => (active ? buildReadingGuide(active, effectiveStudyWords) : null),
    [active, effectiveStudyWords],
  );

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

  // F-9: session-level bulk reveal for per-sentence 和訳. `allTranslationsOpen` drives the toolbar
  // label (すべて開く ⇄ すべて閉じる); the per-block toggle flips a single index.
  const sentenceCount = active.source.sentences.length;
  const allTranslationsOpen = sentenceCount > 0 && openTranslations.size >= sentenceCount;
  const toggleTranslation = (i: number): void => {
    setOpenTranslations((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };
  const toggleAllTranslations = (): void => {
    setOpenTranslations(allTranslationsOpen ? new Set() : new Set(active.source.sentences.map((_, i) => i)));
  };

  const metaLine = `${meta.intent} · LEVEL ${meta.level} · 新出 ${meta.newCount} / 復習 ${meta.reviewCount}`;
  const selectWord = (wordId: string): void => {
    sessionStore.getState().setActiveWord(wordId);
    // C-5d: opening a word's detail is a lookup — the wiring records it and fires a recall signal.
    onOpenWordDetail?.(wordId);
  };
  const closeDetail = (): void => sessionStore.getState().setActiveWord(null);

  // C-5d completion: a passage that carries the session's completed status (or that we just recorded)
  // shows the finished feedback instead of the record button, so it can't be re-recorded.
  const readingCompleted = completionSummary !== null || (tracksSession && sessionStatus === 'completed');
  const handleCompleteReading = async (): Promise<void> => {
    if (!onCompleteReading || completing || readingCompleted) return;
    setCompleting(true);
    try {
      const summary = await onCompleteReading();
      if (summary && typeof summary === 'object') setCompletionSummary(summary);
    } finally {
      setCompleting(false);
    }
  };

  const activeGuide = guide ?? buildReadingGuide(active, effectiveStudyWords);
  const railContent = (
    <ReadingGuideRail
      passage={active}
      words={effectiveStudyWords}
      guide={activeGuide}
      anchors={lineAligned ? anchors : undefined}
      onSelectWord={selectWord}
      onPlayWord={onPlayWord}
      onMarkUnknown={onMarkUnknown}
    />
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

      <div ref={frameRef} className="reading-layout" style={{ display: 'flex', background: colors.surfacePage }}>
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
                {translationMode === 'per_sentence' ? (
                  <button
                    type="button"
                    data-testid="translation-toggle-all"
                    aria-pressed={allTranslationsOpen}
                    onClick={toggleAllTranslations}
                    style={translationToggleAllStyle}
                  >
                    {allTranslationsOpen ? 'すべて閉じる' : 'すべて開く'}
                  </button>
                ) : null}
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
                {meta.sceneIllustrationUrl ? (
                  <AssetImage
                    src={meta.sceneIllustrationUrl}
                    alt={`${meta.title} の場面イラスト`}
                    style={illustrationImageStyle}
                    // The illustration loading shifts the prose down; realign the rail once it settles.
                    onLoad={lineAligned ? () => remeasure() : undefined}
                  />
                ) : (
                  <span style={{ fontFamily: fonts.mono, fontSize: 11, letterSpacing: '.05em', color: colors.faint2 }}>
                    本文のイラスト · story illustration
                  </span>
                )}
              </div>
              <figcaption style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 9, textAlign: 'center' }}>
                場面を視覚化したイラストが、単語と文脈の記憶を結びつけます
              </figcaption>
              {onRegenerateIllustration || illustrationError ? (
                <div style={illustrationActionsStyle}>
                  {onRegenerateIllustration ? (
                    <button
                      type="button"
                      data-testid="regenerate-passage-illustration"
                      onClick={onRegenerateIllustration}
                      disabled={regeneratingIllustration}
                      aria-busy={regeneratingIllustration}
                      style={secondaryActionButtonStyle(regeneratingIllustration)}
                    >
                      {regeneratingIllustration
                        ? '生成しています…'
                        : meta.sceneIllustrationUrl
                          ? 'イラストを再生成'
                          : 'イラストを生成'}
                    </button>
                  ) : null}
                  {illustrationError ? (
                    <div role="alert" style={inlineErrorStyle}>
                      {illustrationError}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </figure>

            {/* 段階的生成: the body is readable while the annotation pass still runs — say so instead
                of leaving the rail silently sparse; the cues stream in via replacePassage when ready. */}
            {meta.annotationStatus === 'pending' ? (
              <div data-testid="annotation-pending-banner" style={annotationBannerStyle}>
                <span style={{ flex: 1, minWidth: 0, lineHeight: 1.5 }} aria-live="polite">
                  解説（学習ガイドの気づき）を生成しています… 本文はこのまま読み進められます。
                </span>
              </div>
            ) : null}

            {/* F-6: the annotation pass failed/partial for this passage — the body reads fine but the
                「気づき」rail is empty/short. Make the loss visible and offer a one-tap recovery. */}
            {meta.annotationStatus === 'failed' || meta.annotationStatus === 'partial' ? (
              <div data-testid="annotation-status-banner" style={annotationBannerStyle}>
                <span role="alert" style={{ flex: 1, minWidth: 0, lineHeight: 1.5 }}>
                  {meta.annotationStatus === 'partial'
                    ? '注釈の一部だけ生成されました。再生成すると残りの気づきが復元されます。'
                    : '注釈の生成に失敗しました。本文はそのまま読めます。'}
                </span>
                {onRegenerateAnnotation ? (
                  <button
                    type="button"
                    data-testid="regenerate-annotation"
                    onClick={onRegenerateAnnotation}
                    disabled={regeneratingAnnotation}
                    aria-busy={regeneratingAnnotation}
                    style={secondaryActionButtonStyle(regeneratingAnnotation)}
                  >
                    {regeneratingAnnotation ? '生成しています…' : '注釈を再生成'}
                  </button>
                ) : null}
              </div>
            ) : null}
            {annotationError ? (
              <div role="alert" style={{ ...inlineErrorStyle, marginBottom: 16 }}>
                {annotationError}
              </div>
            ) : null}

            {/* The measurement container wraps the prose; useLineAnchors reads badge positions from it. */}
            <div ref={containerRef}>
              {newLayout ? (
                <PassageRenderer
                  passage={active}
                  fontScale={fontScale}
                  activeTokenId={activeTokenId}
                  onSelectWord={selectWord}
                  layout="grid"
                  isNarrow={isNarrow}
                  asideEnabled={translationMode !== 'off'}
                  guideAnchorIdByWordKey={activeGuide.wordAnchorIdByKey}
                  guideTargetIdByCueIndex={activeGuide.cueTargetIdByIndex}
                  guideNumberByCueIndex={activeGuide.guideNumberByCueIndex}
                  guideNumberByWordKey={activeGuide.guideNumberByWordKey}
                  absorbedCueIndexByIndex={activeGuide.absorbedCueIndexByIndex}
                  renderAside={(i) => (
                    <SentenceTranslation
                      text={active.source.sentences[i]?.translationJa ?? ''}
                      mode={translationMode}
                      placement="aside"
                      spans={active.source.sentences[i]?.translationSpans}
                      open={openTranslations.has(i)}
                      onToggle={() => toggleTranslation(i)}
                    />
                  )}
                />
              ) : (
                <PassageRenderer
                  passage={active}
                  fontScale={fontScale}
                  activeTokenId={activeTokenId}
                  onSelectWord={selectWord}
                  isNarrow={isNarrow}
                  guideAnchorIdByWordKey={activeGuide.wordAnchorIdByKey}
                  guideTargetIdByCueIndex={activeGuide.cueTargetIdByIndex}
                  guideNumberByCueIndex={activeGuide.guideNumberByCueIndex}
                  guideNumberByWordKey={activeGuide.guideNumberByWordKey}
                  absorbedCueIndexByIndex={activeGuide.absorbedCueIndexByIndex}
                  renderAfterSentence={(i) => (
                    <SentenceTranslation
                      text={active.source.sentences[i]?.translationJa ?? ''}
                      mode={translationMode}
                      open={openTranslations.has(i)}
                      onToggle={() => toggleTranslation(i)}
                    />
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
                  readingCompleted ? (
                    <div data-testid="reading-completed-feedback" style={completedFeedbackStyle}>
                      <span data-testid="reading-completed-summary" style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.green, fontWeight: 600 }}>
                        {completionSummary && completionSummary.total > 0
                          ? `読了済み ✓（${completionSummary.total} 語にクレジット、うち ${completionSummary.needReview} 語は要復習）`
                          : '読了済み ✓'}
                      </span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" data-testid="reading-completed-review" onClick={() => navigate('/review')} style={completedLinkStyle}>
                          復習へ
                        </button>
                        <button type="button" data-testid="reading-completed-generate" onClick={() => navigate('/')} style={completedLinkStyle}>
                          次の文章を生成
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      data-testid="reading-complete"
                      onClick={() => void handleCompleteReading()}
                      disabled={completing}
                      aria-busy={completing}
                      style={completeButtonStyle}
                    >
                      {completing ? '記録しています…' : '読了として記録'}
                    </button>
                  )
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <aside
          className="reading-rail"
          // minWidth 280 (D-1 width constraint): keep the rail wide enough that guide cards never
          // strangle their text/buttons on a 3:1 wide split. Stacked ≤1024px, global.css relaxes it.
          style={{ flex: 1, minWidth: 280, borderLeft: `1px solid ${colors.borderCard}`, background: colors.surfaceCard, padding: '30px 26px' }}
        >
          {railContent}
        </aside>
      </div>

      {restoreNotice ? (
        <div role="status" data-testid="reading-restore-notice" style={restoreNoticeStyle}>
          <span>前回の位置から再開しました</span>
          <button type="button" data-testid="reading-restart-top" onClick={restartFromTop} style={restoreNoticeButtonStyle}>
            先頭から読む
          </button>
          <button
            type="button"
            aria-label="通知を閉じる"
            onClick={() => setRestoreNotice(false)}
            style={restoreNoticeCloseStyle}
          >
            ×
          </button>
        </div>
      ) : null}

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
          <StoryPlanDialog
            plan={storyPlan}
            onClose={() => setStoryPlanOpen(false)}
            onRegenerateCharacter={onRegenerateStoryCharacter}
            regeneratingCharacterIndex={regeneratingStoryCharacterIndex}
            characterIllustrationError={storyCharacterError}
          />
        </div>
      ) : null}
    </div>
  );
}

function StoryPlanDialog({
  plan,
  onClose,
  onRegenerateCharacter,
  regeneratingCharacterIndex = null,
  characterIllustrationError = null,
}: {
  plan: StoryPlan;
  onClose: () => void;
  onRegenerateCharacter?: (characterIndex: number) => void;
  regeneratingCharacterIndex?: number | null;
  characterIllustrationError?: string | null;
}) {
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
            {plan.characters.map((character, index) => (
              <article key={`${character.name}:${character.role}`} style={storyCharacterItemStyle}>
                {storyCharacterPortraitUrl(character) ? (
                  <AssetImage src={storyCharacterPortraitUrl(character)} alt={character.name} style={storyCharacterImageStyle} />
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
                  {onRegenerateCharacter ? (
                    <button
                      type="button"
                      data-testid={`regenerate-story-character-${index}`}
                      onClick={() => onRegenerateCharacter(index)}
                      disabled={regeneratingCharacterIndex !== null}
                      aria-busy={regeneratingCharacterIndex === index}
                      style={{ ...characterRegenerateButtonStyle(regeneratingCharacterIndex === index), marginTop: 8 }}
                    >
                      {regeneratingCharacterIndex === index ? '生成中…' : 'イラストを再生成'}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          {characterIllustrationError ? (
            <div role="alert" style={{ ...inlineErrorStyle, marginTop: 9 }}>
              {characterIllustrationError}
            </div>
          ) : null}
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

function storyCharacterPortraitUrl(character: StoryCharacter): string | undefined {
  const portraitUrl = character.portraitIllustrationUrl ?? character.illustrationUrl;
  if (!portraitUrl) return undefined;
  if (character.fullBodyIllustrationUrl && portraitUrl === character.fullBodyIllustrationUrl) return undefined;
  return portraitUrl;
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

const completedFeedbackStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  background: colors.greenBg,
  border: `1px solid ${colors.greenBorder}`,
  borderRadius: radius.control,
  padding: '9px 15px',
};

const completedLinkStyle: React.CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 12.5,
  fontWeight: 600,
  color: colors.primary,
  background: colors.surfaceCard,
  border: `1px solid ${colors.primaryBorder}`,
  borderRadius: radius.control,
  padding: '6px 12px',
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

// F-9: "すべて開く / すべて閉じる" toolbar control for per-sentence 和訳 (compact, secondary weight).
const translationToggleAllStyle: React.CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 12,
  color: colors.primary,
  background: colors.surfaceBlue,
  border: `1px solid ${colors.primaryBorder2}`,
  borderRadius: radius.control - 1,
  padding: '5px 11px',
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

const secondaryActionButtonStyle = (busy: boolean): React.CSSProperties => ({
  fontFamily: fonts.ui,
  fontSize: 12.5,
  fontWeight: 600,
  color: colors.primary,
  background: colors.surfaceBlue,
  border: `1px solid ${colors.primaryBorder}`,
  borderRadius: radius.control,
  padding: '7px 11px',
  cursor: busy ? 'wait' : 'pointer',
  opacity: busy ? 0.7 : 1,
});

const illustrationActionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
  marginTop: 10,
};

const inlineErrorStyle: React.CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 12,
  color: colors.terracotta,
  background: '#FBF3F0',
  border: `1px solid ${colors.terracottaBorder}`,
  borderRadius: radius.control,
  padding: '7px 10px',
};

const annotationBannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
  marginBottom: 16,
  fontFamily: fonts.ui,
  fontSize: 12.5,
  color: colors.terracotta,
  background: '#FBF3F0',
  border: `1px solid ${colors.terracottaBorder}`,
  borderRadius: radius.control,
  padding: '10px 13px',
};

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

// D-6: the "A" glyph is tiny, so give the button an explicit ≥32×32 hit box (WCAG 2.5.8) while
// keeping it transparent/borderless — the visual stays a bare letter, the tap area is thumb-sized.
const sizeButtonStyle: React.CSSProperties = {
  fontFamily: fonts.num,
  fontSize: 12,
  color: colors.muted,
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  lineHeight: 1,
  minWidth: 32,
  minHeight: 32,
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const illustrationStyle: React.CSSProperties = {
  width: '100%',
  aspectRatio: '3 / 2',
  maxHeight: 420,
  borderRadius: radius.card,
  background: 'repeating-linear-gradient(135deg,#EAEFF4,#EAEFF4 11px,#F3F6F9 11px,#F3F6F9 22px)',
  border: `1px solid ${colors.borderControl}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
};

const illustrationImageStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'contain',
  objectPosition: 'center',
  display: 'block',
  background: colors.surfaceSubtle,
};

const restoreNoticeStyle: React.CSSProperties = {
  position: 'fixed',
  left: '50%',
  bottom: 88,
  transform: 'translateX(-50%)',
  zIndex: 45,
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  maxWidth: 'calc(100vw - 32px)',
  fontFamily: fonts.ui,
  fontSize: 13,
  color: '#fff',
  background: colors.ink,
  borderRadius: radius.control,
  padding: '10px 12px 10px 16px',
  boxShadow: '0 8px 28px rgba(25,40,65,.28)',
};

const restoreNoticeButtonStyle: React.CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 13,
  fontWeight: 600,
  color: '#fff',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid rgba(255,255,255,.6)',
  padding: '0 0 1px',
  cursor: 'pointer',
};

const restoreNoticeCloseStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  flex: '0 0 auto',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: '50%',
  background: 'rgba(255,255,255,.14)',
  color: '#fff',
  fontSize: 15,
  lineHeight: 1,
  cursor: 'pointer',
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
  objectFit: 'contain',
  objectPosition: 'center top',
  borderRadius: radius.control,
  background: colors.avatarBg,
};

const characterRegenerateButtonStyle = (busy: boolean): React.CSSProperties => ({
  fontFamily: fonts.ui,
  fontSize: 11.5,
  fontWeight: 600,
  color: colors.primary,
  background: colors.surfaceCard,
  border: `1px solid ${colors.primaryBorder}`,
  borderRadius: radius.control,
  padding: '6px 9px',
  cursor: busy ? 'wait' : 'pointer',
  opacity: busy ? 0.68 : 1,
});

const storyCharacterInitialStyle: React.CSSProperties = {
  width: 52,
  height: 78,
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
