/**
 * L4 — WordDetailCard (design.md "WordDetailCard", 8.1–8.5, 7.6). Header (headword / IPA /
 * pronounce / POS / register / connotation / frequency / mastery) + an always-expanded Core
 * (meaning / examples / collocations / nuance / illustration) + collapsible MORE rows
 * (etymology / semantic network / word family / idioms / grammar / metaphor / common errors).
 * Every attribute is optional-tolerant: absent fields are skipped so the card never breaks.
 */

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { colors, fonts, radius, shadow } from '../theme/tokens';
import { dueLabel } from '../shared/dueLabel';
import { playerStore } from '../../state/stores/playerStore';
import type { EtymologyV2, MasteryStage, SemanticRelation, WordData } from '../../types/domain';
import { structuredWordData } from '../../domain/wordData/structuredWordData';

const MASTERY_JA: Record<MasteryStage, string> = {
  New: '未学習',
  Learning: '学習中',
  Consolidating: '定着',
  Mastered: '習熟',
};

export interface WordDetailCardProps {
  word: WordData;
  stage?: MasteryStage;
  /**
   * D-3: FSRS transparency for a learned word (absent for never-scheduled words, so nothing shows).
   * `dueAt` renders「次回復習: 明日」via the shared dueLabel; `repsToConsolidate` (fsrs.repsToConsolidate)
   * renders「定着まであと N 回」— a text placeholder until the C-5c log progress bar lands.
   */
  scheduling?: { dueAt: number; repsToConsolidate: number };
  /** Clock for the relative due label (defaults to now). */
  now?: number;
  audioUrl?: string;
  onMarkUnknown?: (wordId: string) => void | Promise<void>;
  /** Whether this word is currently suspended as known (C-5d); drives the mark-known/restore action. */
  suspended?: boolean;
  /** 「もう覚えた（復習から外す）」: suspend the word (excluded from review/suggestions/seeding). */
  onMarkKnown?: (wordId: string) => void | Promise<void>;
  /** 「復習に戻す」: clear the known flag so the word rejoins the review loop. */
  onRestore?: (wordId: string) => void | Promise<void>;
  /** A-3-2「次の文章に織り込む」: carry this word to Home as a manual addition and generate around it. */
  onWeave?: (wordId: string) => void;
  /** C-2: open another word's card (semantic-network neighbor / cognate tap). */
  onOpenWord?: (word: string) => void;
  onClose?: () => void;
}

const chipStyle = (tint = false): React.CSSProperties => ({
  fontFamily: fonts.ui,
  fontSize: 12,
  color: tint ? colors.primary : colors.inkSoft,
  background: tint ? '#EAF0F8' : '#EDF1F6',
  borderRadius: 5,
  padding: '3px 10px',
});

const sectionLabel = (text: string, accent: string) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
    <span style={{ fontFamily: fonts.ui, fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: accent }}>
      {text}
    </span>
    <span style={{ flex: 1, height: 1, background: colors.dividerSection }} />
  </div>
);

function Frequency({ value }: { value: number }) {
  return (
    <div data-testid="frequency" data-frequency={value} style={{ color: colors.primary, fontSize: 15, letterSpacing: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{ color: i <= value ? colors.primary : colors.dotInactive }}>
          ★
        </span>
      ))}
    </div>
  );
}

function MoreRow({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  /** C-2: initial expansion (e.g. auto-open 語源 for New/Learning words). */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: `1px solid ${colors.dividerRow}` }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 4px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ fontFamily: fonts.ui, fontSize: 14, color: colors.body }}>
          {title}
          {summary ? <span style={{ color: colors.faint, fontSize: 12, marginLeft: 8 }}>{summary}</span> : null}
        </span>
        <span style={{ color: '#B5BFCB', fontSize: 13 }}>{open ? '−' : '＋'}</span>
      </button>
      {open ? (
        <div
          data-testid={`more-detail-${title}`}
          style={{ padding: '0 4px 14px', fontFamily: fonts.bodyJp, fontSize: 13, lineHeight: 1.7, color: colors.inkSoft }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** Japanese label per semantic relation (C-2). */
const RELATION_JA: Record<SemanticRelation, string> = {
  synonym: '類義',
  antonym: '反義',
  hypernym: '上位',
  hyponym: '下位',
  related: '関連',
};
const RELATION_ORDER: SemanticRelation[] = ['synonym', 'antonym', 'hypernym', 'hyponym', 'related'];

/** A tappable「word — noteJa」chip; a button when navigation is wired, a static chip otherwise. */
function NeighborChip({ word, note, onOpenWord }: { word: string; note?: string; onOpenWord?: (w: string) => void }) {
  const label = note ? `${word} — ${note}` : word;
  if (onOpenWord) {
    return (
      <button type="button" data-testid={`open-word-${word}`} onClick={() => onOpenWord(word)} style={neighborButtonStyle}>
        {label}
      </button>
    );
  }
  return <span style={neighborChipStyle}>{label}</span>;
}

/** Distinct tints for the segmented headword / part rows (C-2 spelling correspondence). */
const SEG_TINTS = ['#EAF0F8', '#EAF4EE', '#F6EFE6', '#F1ECF7'];
const SEG_INKS = [colors.primaryDeep, colors.greenDeep, '#9A6B2F', '#6B4E9A'];

/** C-2 etymology decomposition: segmented headword → part/meaning table → bridge chain → cognates. */
function EtymologyBreakdown({ etymology, onOpenWord }: { etymology: EtymologyV2; onOpenWord?: (w: string) => void }) {
  const parts = Array.isArray(etymology.parts) ? etymology.parts.filter((p) => p && text(p.form)) : [];
  const cognates = Array.isArray(etymology.cognates) ? etymology.cognates.filter((c) => c && text(c.word)) : [];
  return (
    <div>
      {parts.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {parts.map((p, i) => (
            <span key={`seg-${i}`} style={{ ...etymSegStyle, background: SEG_TINTS[i % SEG_TINTS.length], color: SEG_INKS[i % SEG_INKS.length] }}>
              {p.form}
              {text(p.surfaceIn) ? <span style={{ opacity: 0.65, marginLeft: 4 }}>({p.surfaceIn})</span> : null}
            </span>
          ))}
        </div>
      ) : null}
      {parts.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
          {parts.map((p, i) => (
            <div key={`part-${i}`} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
              <span style={{ fontFamily: fonts.num, fontSize: 13, fontWeight: 600, color: SEG_INKS[i % SEG_INKS.length], minWidth: 72 }}>{p.form}</span>
              <span style={{ fontFamily: fonts.bodyJp, fontSize: 13, color: colors.inkSoft }}>{text(p.meaningJa) ?? '—'}</span>
            </div>
          ))}
        </div>
      ) : null}
      {text(etymology.bridgeJa) ? (
        <div style={etymBridgeStyle} data-testid="etymology-bridge">
          {etymology.bridgeJa}
        </div>
      ) : null}
      {text(etymology.sourceJa) ? (
        <div style={{ fontFamily: fonts.bodyJp, fontSize: 12, color: colors.muted, marginTop: 8 }}>由来: {etymology.sourceJa}</div>
      ) : null}
      {cognates.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontFamily: fonts.ui, fontSize: 11, fontWeight: 600, color: colors.muted, marginBottom: 6 }}>同じ語根の仲間</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {cognates.map((cg) => (
              <NeighborChip key={cg.word} word={cg.word} note={text(cg.noteJa)} onOpenWord={onOpenWord} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function WordDetailCard({ word: rawWord, stage, scheduling, now = Date.now(), audioUrl, onMarkUnknown, suspended, onMarkKnown, onRestore, onWeave, onOpenWord, onClose }: WordDetailCardProps) {
  const [markingUnknown, setMarkingUnknown] = useState(false);
  const [suspending, setSuspending] = useState(false);
  // Structure defensively so a legacy (pre-C-1/2/3) cache row that skipped the read-time lift still
  // renders with the new attribute shapes instead of crashing (idempotent for already-structured data).
  const word = structuredWordData(rawWord);
  const more = word.more;
  const effectiveAudioUrl = audioUrl ?? word.audioUrl;
  const etymology = more?.etymology;
  const etymologySummary =
    etymology?.parts && etymology.parts.length > 0
      ? etymology.parts.map((p) => p.form).join(' + ')
      : text(etymology?.bridgeJa) ?? '';
  const pos = strings(word.pos);
  const meanings = strings(word.core?.meaningsJa);
  const examples = Array.isArray(word.core?.examples)
    ? word.core.examples.filter((ex): ex is { en: string; ja: string } => !!ex && typeof ex.en === 'string' && typeof ex.ja === 'string')
    : [];
  const collocations = Array.isArray(word.core?.collocations)
    ? word.core.collocations.filter((c) => c && text(c.pattern))
    : [];
  const synonymNuances = strings(word.core?.synonymNuances);
  const memoryTips = Array.isArray(word.memoryTips)
    ? word.memoryTips.filter((tip): tip is NonNullable<WordData['memoryTips']>[number] => !!tip && typeof tip.tipJa === 'string' && tip.tipJa.trim().length > 0)
    : [];
  const semanticNetwork = Array.isArray(more?.semanticNetwork)
    ? more.semanticNetwork.filter((n) => n && text(n.word))
    : [];
  const networkByRelation = RELATION_ORDER.map((relation) => ({
    relation,
    items: semanticNetwork.filter((n) => n.relation === relation),
  })).filter((g) => g.items.length > 0);
  const networkSummary = networkByRelation.map((g) => `${RELATION_JA[g.relation]}${g.items.length}`).join(' · ');
  const wordFamily = strings(more?.wordFamily);
  const idioms = Array.isArray(more?.idioms) ? more.idioms.filter((idm) => idm && text(idm.expression)) : [];
  const idiomSummary = idioms.length > 0 ? `${idioms[0]!.expression}${idioms.length > 1 ? ` ほか${idioms.length - 1}件` : ''}` : '';
  const grammarPatterns = strings(more?.grammarPatterns);
  const metaphor = text(more?.metaphor);
  const metaphorSummary = metaphor && metaphor.length > 20 ? `${metaphor.slice(0, 20)}…` : metaphor;
  const commonErrors = strings(more?.commonErrors);
  // C-2: New/Learning words auto-open 語源 so the decomposition is seen at first study.
  const etymologyDefaultOpen = stage === 'New' || stage === 'Learning';
  const hasMore =
    !!etymology ||
    semanticNetwork.length > 0 ||
    wordFamily.length > 0 ||
    idioms.length > 0 ||
    grammarPatterns.length > 0 ||
    !!metaphor ||
    commonErrors.length > 0;

  const markUnknown = async (): Promise<void> => {
    if (!onMarkUnknown || markingUnknown) return;
    setMarkingUnknown(true);
    try {
      await onMarkUnknown(word.wordId);
    } catch {
      // Unknown marking is a learning signal; the card stays usable if persistence fails.
    } finally {
      setMarkingUnknown(false);
    }
  };

  const toggleSuspended = async (): Promise<void> => {
    const handler = suspended ? onRestore : onMarkKnown;
    if (!handler || suspending) return;
    setSuspending(true);
    try {
      await handler(word.wordId);
    } catch {
      // Known-word declaration is best-effort; the card stays usable if persistence fails.
    } finally {
      setSuspending(false);
    }
  };

  return (
    <div
      style={{
        background: colors.surfaceCard,
        borderRadius: radius.card,
        boxShadow: shadow.card,
        overflow: 'hidden',
        maxWidth: 780,
        width: '100%',
        maxHeight: '90vh',
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ padding: '30px 34px 24px', borderBottom: `1px solid ${colors.dividerSection}` }}>
        {/* D-6: `flexWrap` lets the right meta/action column drop below the headword on a narrow
            (≤414px) viewport instead of colliding with / overflowing off the headword. */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
              {/* D-6: fluid headword — shrinks with the viewport and wraps long words instead of
                  overflowing the card on a phone. */}
              <span style={{ fontFamily: fonts.serif, fontSize: 'clamp(28px, 8vw, 42px)', fontWeight: 600, color: colors.ink, letterSpacing: '.005em', overflowWrap: 'anywhere' }}>
                {word.headword}
              </span>
              <span style={{ fontFamily: fonts.num, fontSize: 15, color: colors.faint }}>{word.ipa}</span>
              <button
                type="button"
                aria-label="発音を再生"
                disabled={!effectiveAudioUrl}
                onClick={() => effectiveAudioUrl && playerStore.getState().playWord(effectiveAudioUrl)}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  background: effectiveAudioUrl ? colors.surfaceBlue : '#F1F4F8',
                  border: 'none',
                  color: effectiveAudioUrl ? colors.primary : colors.faint,
                  cursor: effectiveAudioUrl ? 'pointer' : 'not-allowed',
                  fontSize: 14,
                }}
              >
                ▶
              </button>
            </div>
            <div style={{ display: 'flex', gap: 7, marginTop: 14, flexWrap: 'wrap' }}>
              {pos.length > 0 ? <span style={chipStyle()}>{pos.join('・')}</span> : null}
              {word.register ? <span style={chipStyle(true)}>レジスター: {word.register}</span> : null}
              {word.connotation ? <span style={chipStyle()}>コノテーション: {word.connotation}</span> : null}
            </div>
            {/* Actions sit under the headword/chips (left column) so they fill the space beside the
                right meta column instead of leaving a blank band — and wrap onto one row rather than
                stacking into a tall column. */}
            {onWeave || suspended || onMarkUnknown || onMarkKnown ? (
              <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                {onWeave ? (
                  <button type="button" data-testid="weave-word" onClick={() => onWeave(word.wordId)} style={weaveButtonStyle}>
                    次の文章に織り込む
                  </button>
                ) : null}
                {suspended ? (
                  <>
                    <span data-testid="suspended-indicator" style={suspendedTagStyle}>
                      復習から除外中
                    </span>
                    {onRestore ? (
                      <button
                        type="button"
                        data-testid="restore-word"
                        onClick={() => void toggleSuspended()}
                        disabled={suspending}
                        aria-busy={suspending}
                        style={knownButtonStyle(suspending)}
                      >
                        {suspending ? '戻しています…' : '復習に戻す'}
                      </button>
                    ) : null}
                  </>
                ) : (
                  <>
                    {onMarkUnknown ? (
                      <button
                        type="button"
                        data-testid="mark-unknown"
                        onClick={() => void markUnknown()}
                        disabled={markingUnknown}
                        aria-busy={markingUnknown}
                        style={unknownButtonStyle(markingUnknown)}
                      >
                        {markingUnknown ? '記録中…' : '知らなかった'}
                      </button>
                    ) : null}
                    {onMarkKnown ? (
                      <button
                        type="button"
                        data-testid="mark-known"
                        onClick={() => void toggleSuspended()}
                        disabled={suspending}
                        aria-busy={suspending}
                        style={knownButtonStyle(suspending)}
                      >
                        {suspending ? '記録中…' : 'もう覚えた（復習から外す）'}
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>
          <div style={{ textAlign: 'right', flex: 'none' }}>
            {onClose ? (
              <button
                type="button"
                aria-label="閉じる"
                onClick={onClose}
                style={{
                  width: 44,
                  height: 44,
                  display: 'inline-grid',
                  placeItems: 'center',
                  border: 'none',
                  background: 'transparent',
                  color: colors.faint,
                  fontSize: 22,
                  lineHeight: 1,
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            ) : null}
            <div style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginBottom: 5 }}>頻度・重要度</div>
            <Frequency value={word.frequency} />
            {stage ? (
              <div style={{ marginTop: 14 }}>
                <span style={{ fontFamily: fonts.ui, fontSize: 11, fontWeight: 600, color: colors.green, background: colors.greenBg, borderRadius: 10, padding: '3px 10px' }}>
                  習熟度: {MASTERY_JA[stage]}
                </span>
              </div>
            ) : null}
            {/* D-3: FSRS transparency — next-review date + progress toward 定着. Only learned words
                (with a scheduling record) reach here, so a never-studied word shows neither line. */}
            {scheduling ? (
              <div data-testid="scheduling-info" style={{ marginTop: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                <div style={schedulingLineStyle}>
                  次回復習: <b style={{ color: colors.ink }}>{dueLabel(scheduling.dueAt, now)}</b>
                </div>
                {scheduling.repsToConsolidate > 0 ? (
                  <div style={schedulingLineStyle}>
                    定着まであと <b style={{ color: colors.ink }}>{scheduling.repsToConsolidate}</b> 回
                  </div>
                ) : (
                  <div style={schedulingLineStyle}>定着済み</div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* CORE (always expanded) */}
      <div style={{ padding: '26px 34px 10px' }}>
        {sectionLabel('CORE · コア', colors.primary)}

        {word.illustrationUrl ? (
          <div style={illustrationWrapStyle}>
            <img src={word.illustrationUrl} alt={word.headword} style={illustrationStyle} />
          </div>
        ) : null}

        {meanings.length > 0 ? (
          <div style={{ fontFamily: fonts.bodyJp, fontSize: 15, lineHeight: 1.7, color: colors.body }}>
            <b style={{ color: colors.ink }}>意味</b> ／ {meanings.join(' / ')}
          </div>
        ) : null}

        {memoryTips.length > 0 ? (
          <div style={memoryTipsStyle}>
            <div style={{ fontFamily: fonts.ui, fontSize: 12, fontWeight: 600, color: colors.greenDeep, marginBottom: 8 }}>
              覚えるコツ
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {memoryTips.map((tip, i) => (
                <div key={`${tip.kind}:${i}`}>{tip.tipJa}</div>
              ))}
            </div>
          </div>
        ) : null}

        {examples.length > 0 ? (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontFamily: fonts.ui, fontSize: 12, fontWeight: 600, color: colors.muted, marginBottom: 8 }}>
              例文 / Examples
            </div>
            {examples.map((ex, i) => (
              <div key={i} style={{ borderLeft: `2px solid ${colors.primaryBorder}`, paddingLeft: 14, marginBottom: 12 }}>
                <div style={{ fontFamily: fonts.serif, fontSize: 16, lineHeight: 1.55, color: colors.body }}>{ex.en}</div>
                <div style={{ fontFamily: fonts.bodyJp, fontSize: 13, color: colors.muted, marginTop: 3 }}>{ex.ja}</div>
              </div>
            ))}
          </div>
        ) : null}

        {collocations.length > 0 ? (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontFamily: fonts.ui, fontSize: 12, fontWeight: 600, color: colors.muted, marginBottom: 8 }}>
              コロケーション / Collocations
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {collocations.map((col) => (
                <div key={col.id} data-testid={`collocation-${col.id}`} style={collocationRowStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: fonts.num, fontSize: 14, fontWeight: 600, color: colors.primaryDeep }}>{col.pattern}</span>
                    <span style={collocationTypeBadge}>{col.type}</span>
                    {col.l1Contrast ? (
                      <span data-testid="l1-contrast" style={l1ContrastBadge}>
                        ⚠日本語と発想が違う
                      </span>
                    ) : null}
                  </div>
                  {col.slotExamples.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>
                      {col.slotExamples.map((ex) => (
                        <span key={ex} style={slotExampleChip}>
                          {ex}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {col.glossJa ? (
                    <div style={{ fontFamily: fonts.bodyJp, fontSize: 12, color: colors.muted, marginTop: 7 }}>{col.glossJa}</div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {synonymNuances.length > 0 ? (
          <div style={{ marginTop: 18, background: colors.surfacePage, border: `1px solid ${colors.borderCard}`, borderRadius: radius.card, padding: '14px 16px' }}>
            <div style={{ fontFamily: fonts.ui, fontSize: 12, fontWeight: 600, color: colors.ink, marginBottom: 9 }}>
              ニュアンスの違い / Synonyms
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontFamily: fonts.bodyJp, fontSize: 13, lineHeight: 1.5, color: colors.inkSoft }}>
              {synonymNuances.map((n, i) => (
                <div key={i}>{n}</div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* MORE (collapsed; only present attributes render) */}
      {hasMore ? (
        <div style={{ padding: '18px 34px 30px' }}>
          {sectionLabel('MORE · さらに掘り下げる', colors.faint)}
          {etymology ? (
            <MoreRow title="語源" summary={etymologySummary} defaultOpen={etymologyDefaultOpen}>
              <EtymologyBreakdown etymology={etymology} onOpenWord={onOpenWord} />
            </MoreRow>
          ) : null}
          {networkByRelation.length > 0 ? (
            <MoreRow title="意味のネットワーク" summary={networkSummary}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {networkByRelation.map((group) => (
                  <div key={group.relation}>
                    <div style={{ fontFamily: fonts.ui, fontSize: 11, fontWeight: 600, color: colors.muted, marginBottom: 6 }}>
                      {RELATION_JA[group.relation]}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {group.items.map((n) => (
                        <NeighborChip key={`${n.relation}:${n.word}`} word={n.word} note={text(n.noteJa)} onOpenWord={onOpenWord} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </MoreRow>
          ) : null}
          {wordFamily.length > 0 ? (
            <MoreRow title="語のファミリー" summary={wordFamily.join(' · ')}>
              {wordFamily.join(' · ')}
            </MoreRow>
          ) : null}
          {idioms.length > 0 ? (
            <MoreRow title="イディオム・フレーズ" summary={idiomSummary}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {idioms.map((idm, i) => (
                  <div key={`${idm.expression}:${i}`} style={idiomCardStyle}>
                    <div style={{ fontFamily: fonts.num, fontSize: 14, fontWeight: 700, color: colors.ink }}>{idm.expression}</div>
                    {text(idm.meaningJa) ? (
                      <div style={{ fontFamily: fonts.bodyJp, fontSize: 13, color: colors.body, marginTop: 3 }}>{idm.meaningJa}</div>
                    ) : null}
                    {text(idm.originJa) ? (
                      <div style={idiomOriginStyle} data-testid="idiom-origin">
                        💡 {idm.originJa}
                      </div>
                    ) : null}
                    {text(idm.exampleEn) ? (
                      <div style={{ fontFamily: fonts.serif, fontSize: 13, color: colors.inkSoft, marginTop: 6 }}>
                        {idm.exampleEn}
                        {text(idm.exampleJa) ? <span style={{ fontFamily: fonts.bodyJp, color: colors.muted }}> — {idm.exampleJa}</span> : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </MoreRow>
          ) : null}
          {grammarPatterns.length > 0 ? (
            <MoreRow title="文法パターン" summary={grammarPatterns[0]}>
              {grammarPatterns.join(' / ')}
            </MoreRow>
          ) : null}
          {metaphor ? (
            <MoreRow title="メタファー" summary={metaphorSummary}>
              {metaphor}
            </MoreRow>
          ) : null}
          {commonErrors.length > 0 ? (
            <MoreRow title="誤用しやすい点" summary={commonErrors[0]}>
              {commonErrors.join(' / ')}
            </MoreRow>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const illustrationWrapStyle: CSSProperties = {
  float: 'right',
  width: 118,
  height: 118,
  margin: '0 0 14px 20px',
  borderRadius: radius.card,
  overflow: 'hidden',
  border: `1px solid ${colors.borderCard}`,
  background: colors.surfaceSubtle,
};

const illustrationStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const memoryTipsStyle: CSSProperties = {
  marginTop: 18,
  background: colors.greenBg,
  border: `1px solid ${colors.greenBorder}`,
  borderRadius: radius.card,
  padding: '13px 15px',
  fontFamily: fonts.bodyJp,
  fontSize: 13,
  lineHeight: 1.65,
  color: colors.inkSoft,
};

// ── C-3 collocation rows ─────────────────────────────────────────────────────
const collocationRowStyle: CSSProperties = {
  background: colors.surfacePage,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: radius.card,
  padding: '11px 14px',
};

const collocationTypeBadge: CSSProperties = {
  fontFamily: fonts.num,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '.04em',
  color: colors.primary,
  background: '#EAF0F8',
  borderRadius: 4,
  padding: '2px 6px',
};

const l1ContrastBadge: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 11,
  fontWeight: 600,
  color: colors.terracotta,
  background: '#FBF3F0',
  border: `1px solid ${colors.terracottaBorder}`,
  borderRadius: radius.chip,
  padding: '2px 8px',
};

const slotExampleChip: CSSProperties = {
  fontFamily: fonts.num,
  fontSize: 12,
  color: colors.inkSoft,
  background: '#EDF1F6',
  borderRadius: radius.chip,
  padding: '3px 9px',
};

// ── C-2 etymology breakdown ──────────────────────────────────────────────────
const etymSegStyle: CSSProperties = {
  fontFamily: fonts.num,
  fontSize: 15,
  fontWeight: 600,
  borderRadius: 6,
  padding: '5px 10px',
};

const etymBridgeStyle: CSSProperties = {
  fontFamily: fonts.bodyJp,
  fontSize: 13,
  lineHeight: 1.7,
  color: colors.body,
  background: colors.surfacePage,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: radius.card,
  padding: '10px 13px',
};

// ── C-2 tappable neighbor / cognate chips ────────────────────────────────────
const neighborChipStyle: CSSProperties = {
  fontFamily: fonts.bodyJp,
  fontSize: 12,
  color: colors.inkSoft,
  background: '#EDF1F6',
  borderRadius: radius.chip,
  padding: '4px 10px',
};

const neighborButtonStyle: CSSProperties = {
  ...neighborChipStyle,
  color: colors.primaryDeep,
  background: '#EAF0F8',
  border: `1px solid ${colors.primaryBorder}`,
  cursor: 'pointer',
};

// ── C-1 idiom cards ──────────────────────────────────────────────────────────
const idiomCardStyle: CSSProperties = {
  background: colors.surfacePage,
  border: `1px solid ${colors.borderCard}`,
  borderRadius: radius.card,
  padding: '11px 14px',
};

const idiomOriginStyle: CSSProperties = {
  fontFamily: fonts.bodyJp,
  fontSize: 12,
  lineHeight: 1.6,
  color: colors.muted,
  background: colors.surfaceSubtle,
  borderRadius: 6,
  padding: '7px 10px',
  marginTop: 7,
};

const unknownButtonStyle = (busy: boolean): CSSProperties => ({
  fontFamily: fonts.ui,
  fontSize: 12,
  fontWeight: 600,
  color: busy ? colors.faint : colors.terracotta,
  background: busy ? '#F4F6F9' : '#FBF3F0',
  border: `1px solid ${busy ? colors.borderControl : colors.terracottaBorder}`,
  borderRadius: radius.chip,
  padding: '6px 11px',
  cursor: busy ? 'wait' : 'pointer',
});

const knownButtonStyle = (busy: boolean): CSSProperties => ({
  fontFamily: fonts.ui,
  fontSize: 12,
  fontWeight: 600,
  color: busy ? colors.faint : colors.green,
  background: busy ? '#F4F6F9' : colors.greenBg,
  border: `1px solid ${busy ? colors.borderControl : colors.greenBorder}`,
  borderRadius: radius.chip,
  padding: '6px 11px',
  cursor: busy ? 'wait' : 'pointer',
});

const weaveButtonStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 12,
  fontWeight: 600,
  color: '#fff',
  background: colors.primary,
  border: '1px solid transparent',
  borderRadius: radius.chip,
  padding: '6px 13px',
  cursor: 'pointer',
};

const schedulingLineStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 11,
  color: colors.muted,
};

const suspendedTagStyle: CSSProperties = {
  fontFamily: fonts.ui,
  fontSize: 11,
  fontWeight: 600,
  color: colors.muted,
  background: colors.surfaceSubtle,
  border: `1px solid ${colors.borderControl}`,
  borderRadius: radius.chip,
  padding: '3px 9px',
};
