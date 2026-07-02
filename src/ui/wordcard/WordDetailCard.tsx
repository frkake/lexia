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
import { playerStore } from '../../state/stores/playerStore';
import type { MasteryStage, WordData } from '../../types/domain';

const MASTERY_JA: Record<MasteryStage, string> = {
  New: '未学習',
  Learning: '学習中',
  Consolidating: '定着',
  Mastered: '習熟',
};

export interface WordDetailCardProps {
  word: WordData;
  stage?: MasteryStage;
  audioUrl?: string;
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

function MoreRow({ title, summary, children }: { title: string; summary?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
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

export function WordDetailCard({ word, stage, audioUrl, onClose }: WordDetailCardProps) {
  const more = word.more;
  const effectiveAudioUrl = audioUrl ?? word.audioUrl;
  const etymology = more?.etymology;
  const etymologyParts = etymology ? [text(etymology.prefix), text(etymology.root), text(etymology.suffix)].filter(Boolean).join(' + ') : '';
  const etymologyNote = text(etymology?.noteJa);
  const etymologySummary = etymologyParts || etymologyNote || '';
  const pos = strings(word.pos);
  const meanings = strings(word.core?.meaningsJa);
  const examples = Array.isArray(word.core?.examples)
    ? word.core.examples.filter((ex): ex is { en: string; ja: string } => !!ex && typeof ex.en === 'string' && typeof ex.ja === 'string')
    : [];
  const collocations = strings(word.core?.collocations);
  const synonymNuances = strings(word.core?.synonymNuances);
  const memoryTips = Array.isArray(word.memoryTips)
    ? word.memoryTips.filter((tip): tip is NonNullable<WordData['memoryTips']>[number] => !!tip && typeof tip.tipJa === 'string' && tip.tipJa.trim().length > 0)
    : [];
  const semanticNetwork = more?.semanticNetwork;
  const synonyms = strings(semanticNetwork?.synonyms);
  const antonyms = strings(semanticNetwork?.antonyms);
  const wordFamily = strings(more?.wordFamily);
  const idioms = strings(more?.idioms);
  const grammarPatterns = strings(more?.grammarPatterns);
  const metaphor = text(more?.metaphor);
  const commonErrors = strings(more?.commonErrors);
  const hasMore =
    !!etymology ||
    synonyms.length > 0 ||
    antonyms.length > 0 ||
    wordFamily.length > 0 ||
    idioms.length > 0 ||
    grammarPatterns.length > 0 ||
    !!metaphor ||
    commonErrors.length > 0;

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
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: fonts.serif, fontSize: 42, fontWeight: 600, color: colors.ink, letterSpacing: '.005em' }}>
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
          </div>
          <div style={{ textAlign: 'right', flex: 'none' }}>
            {onClose ? (
              <button
                type="button"
                aria-label="閉じる"
                onClick={onClose}
                style={{ border: 'none', background: 'transparent', color: colors.faint, fontSize: 20, cursor: 'pointer', marginBottom: 6 }}
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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {collocations.map((c) => (
                <span key={c} style={{ fontFamily: fonts.num, fontSize: 13, color: colors.primaryDeep, background: '#EAF0F8', borderRadius: radius.chip, padding: '5px 11px' }}>
                  {c}
                </span>
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
            <MoreRow title="語源" summary={etymologySummary}>
              {etymologyParts ? <div>{etymologyParts}</div> : null}
              {etymologyNote ? <div style={{ marginTop: etymologyParts ? 8 : 0 }}>{etymologyNote}</div> : null}
            </MoreRow>
          ) : null}
          {synonyms.length > 0 || antonyms.length > 0 ? (
            <MoreRow title="意味のネットワーク" summary="類義 · 反義 · 上位/下位語">
              {synonyms.length > 0 ? `類義: ${synonyms.join('、')}` : null}
              {synonyms.length > 0 && antonyms.length > 0 ? ' / ' : null}
              {antonyms.length > 0 ? `反義: ${antonyms.join('、')}` : null}
            </MoreRow>
          ) : null}
          {wordFamily.length > 0 ? (
            <MoreRow title="語のファミリー" summary={wordFamily.join(' · ')}>
              {wordFamily.join(' · ')}
            </MoreRow>
          ) : null}
          {idioms.length > 0 ? (
            <MoreRow title="イディオム・フレーズ" summary={idioms[0]}>
              {idioms.join(' / ')}
            </MoreRow>
          ) : null}
          {grammarPatterns.length > 0 ? (
            <MoreRow title="文法パターン" summary={grammarPatterns[0]}>
              {grammarPatterns.join(' / ')}
            </MoreRow>
          ) : null}
          {metaphor ? (
            <MoreRow title="メタファー" summary={metaphor}>
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
