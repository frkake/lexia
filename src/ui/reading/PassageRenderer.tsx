/**
 * L4 — PassageRenderer: renders an IndexedPassage as annotated prose (design.md
 * "ReadingScreen", 4.2/4.3/4.6). Target words carry their mastery-density underline,
 * collocations are tinted chips with the target nested inside, and each NoticeCue gets
 * a circled number badge. Selecting a target word drives the WordDetailCard; the active
 * TTS token is emphasized. Spacing is reconstructed from the tokenizer's char offsets so
 * the rendered text is byte-for-byte the string the TTS engine read. Per-sentence
 * translations are injected by the caller via `renderAfterSentence` (SentenceTranslation).
 */

import type { CSSProperties, ReactNode } from 'react';
import { AnnotatedSpan, type AnnotationKind } from '../shared/AnnotatedSpan';
import { noticeStyle, colors, fonts } from '../theme/tokens';
import type {
  IndexedPassage,
  IndexedSentence,
  IndexedToken,
  TargetSpan,
  CollocationSpan,
  NoticeCue,
  TokenId,
} from '../../types/domain';

const BASE_PROSE_PX = 19;

export interface PassageRendererProps {
  passage: IndexedPassage;
  fontScale?: number;
  /** Token currently under the TTS playhead (emphasized when within a target). */
  activeTokenId?: TokenId | null;
  onSelectWord?: (wordId: string) => void;
  /** Block content to inject after a sentence (per-sentence translation). */
  renderAfterSentence?: (sentenceIndex: number) => ReactNode;
}

function NoticeBadge({ cue }: { cue: NoticeCue }) {
  return (
    <span
      data-testid={`notice-badge-${cue.index}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 15,
        height: 15,
        borderRadius: '50%',
        background: noticeStyle(cue.category).numberColor,
        color: '#fff',
        fontFamily: fonts.num,
        fontSize: 9,
        fontWeight: 700,
        verticalAlign: '8px',
        marginLeft: 1,
        lineHeight: 1,
      }}
    >
      {cue.index}
    </span>
  );
}

export function PassageRenderer({
  passage,
  fontScale = 1,
  activeTokenId = null,
  onSelectWord,
  renderAfterSentence,
}: PassageRendererProps) {
  const { source } = passage;

  const proseStyle: CSSProperties = {
    fontFamily: fonts.serifJp,
    fontSize: Math.round(BASE_PROSE_PX * fontScale * 100) / 100,
    lineHeight: 1.95,
    color: colors.body,
    letterSpacing: '.003em',
  };

  const densityKind = (span: TargetSpan): AnnotationKind => span.masteryDensity;

  const isActive = (tokens: IndexedToken[], start: number, end: number): boolean =>
    activeTokenId != null && tokens.slice(start, end).some((t) => t.tokenId === activeTokenId);

  function renderSentence(sentence: IndexedSentence): ReactNode {
    const { sentenceIndex, tokens } = sentence;
    const targets = source.targetSpans.filter((s) => s.sentenceIndex === sentenceIndex);
    const collocations = source.collocationSpans.filter((s) => s.sentenceIndex === sentenceIndex);
    const cuesByEnd = new Map<number, NoticeCue[]>();
    for (const cue of source.noticeCues.filter((c) => c.span.sentenceIndex === sentenceIndex)) {
      const list = cuesByEnd.get(cue.span.tokenEnd) ?? [];
      list.push(cue);
      cuesByEnd.set(cue.span.tokenEnd, list);
    }
    const targetAt = (i: number): TargetSpan | undefined => targets.find((s) => s.tokenStart === i);
    const collAt = (i: number): CollocationSpan | undefined => collocations.find((s) => s.tokenStart === i);

    const out: ReactNode[] = [];
    let lastCharEnd: number | null = null;

    const surface = (start: number, end: number): string =>
      tokens.slice(start, end).map((t) => t.text).join(' '); // surface only used for word lookup label

    const emitGapBefore = (token: IndexedToken): void => {
      if (lastCharEnd !== null && token.charStart > lastCharEnd) out.push(' ');
    };

    /** Inner rendering of a collocation: targets stay annotated, the rest goes italic. */
    function renderInner(start: number, end: number): ReactNode[] {
      const inner: ReactNode[] = [];
      let i = start;
      let innerLast: number | null = null;
      while (i < end) {
        const tok = tokens[i]!;
        if (innerLast !== null && tok.charStart > innerLast) inner.push(' ');
        const t = targetAt(i);
        if (t && t.tokenEnd <= end) {
          inner.push(
            <AnnotatedSpan
              key={tok.tokenId}
              kind={densityKind(t)}
              active={isActive(tokens, t.tokenStart, t.tokenEnd)}
              onSelect={onSelectWord ? () => onSelectWord(t.wordId) : undefined}
              title={t.wordId}
            >
              {t.surface}
            </AnnotatedSpan>,
          );
          innerLast = tokens[t.tokenEnd - 1]!.charEnd;
          i = t.tokenEnd;
        } else {
          inner.push(
            <span key={tok.tokenId} style={{ fontStyle: 'italic' }}>
              {tok.text}
            </span>,
          );
          innerLast = tok.charEnd;
          i += 1;
        }
      }
      return inner;
    }

    const emitBadges = (end: number): void => {
      for (const cue of cuesByEnd.get(end) ?? []) out.push(<NoticeBadge key={`badge-${cue.index}`} cue={cue} />);
    };

    let i = 0;
    while (i < tokens.length) {
      const tok = tokens[i]!;
      const coll = collAt(i);
      if (coll) {
        emitGapBefore(tok);
        out.push(
          <AnnotatedSpan key={`coll-${tok.tokenId}`} kind="collocation">
            {renderInner(coll.tokenStart, coll.tokenEnd)}
          </AnnotatedSpan>,
        );
        lastCharEnd = tokens[coll.tokenEnd - 1]!.charEnd;
        emitBadges(coll.tokenEnd);
        i = coll.tokenEnd;
        continue;
      }
      const target = targetAt(i);
      if (target) {
        emitGapBefore(tok);
        out.push(
          <AnnotatedSpan
            key={tok.tokenId}
            kind={densityKind(target)}
            active={isActive(tokens, target.tokenStart, target.tokenEnd)}
            onSelect={onSelectWord ? () => onSelectWord(target.wordId) : undefined}
            title={target.wordId}
          >
            {target.surface || surface(target.tokenStart, target.tokenEnd)}
          </AnnotatedSpan>,
        );
        lastCharEnd = tokens[target.tokenEnd - 1]!.charEnd;
        emitBadges(target.tokenEnd);
        i = target.tokenEnd;
        continue;
      }
      emitGapBefore(tok);
      out.push(<span key={tok.tokenId}>{tok.text}</span>);
      lastCharEnd = tok.charEnd;
      emitBadges(i + 1);
      i += 1;
    }

    return out;
  }

  return (
    <div data-testid="passage-prose" style={proseStyle}>
      {passage.sentences.map((sentence) => (
        <span key={sentence.sentenceIndex}>
          {renderSentence(sentence)}
          {renderAfterSentence ? renderAfterSentence(sentence.sentenceIndex) : null}
          {sentence.sentenceIndex < passage.sentences.length - 1 ? ' ' : null}
        </span>
      ))}
    </div>
  );
}
