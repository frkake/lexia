/**
 * L1 — TokenizerJoinService: the single source of truth for token ↔ rendered text
 * ↔ offsets ↔ tokenId (design.md "TokenizerJoinService"). Generation, TTS mark
 * resolution and reading-time recall all share this one deterministic definition,
 * so a drift here would break highlight, annotation and recall simultaneously.
 */

import { ok, err, type Result } from '../../types/result';
import type {
  Sentence,
  PassageOutput,
  IndexedPassage,
  IndexedToken,
  IndexedSentence,
  ByteRange,
  TokenId,
  TokenResolveError,
  TargetSpan,
} from '../../types/domain';

export interface TokenizerJoinService {
  /** tokens → normalized render string (fixed punctuation/contraction/hyphen spacing). */
  renderText(sentence: Sentence): string;
  /** Assign stable tokenIds + UTF-16/UTF-8 offsets to every token in a passage. */
  index(passageId: string, passage: PassageOutput): IndexedPassage;
  /** Map a TTS byte range to the unique covering token (error if 0 or >1). */
  resolveMark(idx: IndexedPassage, mark: ByteRange): Result<TokenId, TokenResolveError>;
  /** Token → the TargetSpan covering it, or null. */
  hitTest(idx: IndexedPassage, tokenId: TokenId): TargetSpan | null;
}

// ── Deterministic spacing rules ──────────────────────────────────────────────

/** Closing punctuation / clitics: never take a leading space. */
const NO_SPACE_BEFORE = new Set([
  ',', '.', '!', '?', ';', ':', ')', ']', '}', '…', '%', '’', '”', '»', '-',
]);

/** Opening punctuation / quotes / prefixes: never take a trailing space. */
const NO_SPACE_AFTER = new Set(['(', '[', '{', '“', '«', '‘', '¿', '¡', '$', '#', '@', '-']);

/** A clitic attaches to the previous token: `'s`, `’re`, `n't`, … */
function isClitic(token: string): boolean {
  return token.startsWith("'") || token.startsWith('’') || token === "n't";
}

function needsSpaceBefore(prev: string, curr: string): boolean {
  if (NO_SPACE_BEFORE.has(curr) || isClitic(curr)) return false;
  if (NO_SPACE_AFTER.has(prev)) return false;
  return true;
}

// ── Implementation ───────────────────────────────────────────────────────────

const encoder = new TextEncoder();

function renderText(sentence: Sentence): string {
  let out = '';
  let prev: string | null = null;
  for (const t of sentence.tokens) {
    if (prev !== null && needsSpaceBefore(prev, t)) out += ' ';
    out += t;
    prev = t;
  }
  return out;
}

function index(passageId: string, passage: PassageOutput): IndexedPassage {
  let render = '';
  let byteLen = 0;
  const allTokens: IndexedToken[] = [];
  const sentences: IndexedSentence[] = [];

  for (const [si, sentence] of passage.sentences.entries()) {
    if (si > 0) {
      render += ' '; // single-space sentence separator (1 byte)
      byteLen += 1;
    }
    const sentenceStartChar = render.length;
    const sentenceTokens: IndexedToken[] = [];
    let prev: string | null = null;

    for (const [ti, text] of sentence.tokens.entries()) {
      if (prev !== null && needsSpaceBefore(prev, text)) {
        render += ' ';
        byteLen += 1;
      }
      const charStart = render.length;
      const byteStart = byteLen;
      render += text;
      byteLen += encoder.encode(text).length;
      const token: IndexedToken = {
        tokenId: `${passageId}:${si}:${ti}`,
        sentenceIndex: si,
        tokenIndex: ti,
        text,
        charStart,
        charEnd: render.length,
        byteStart,
        byteEnd: byteLen,
      };
      sentenceTokens.push(token);
      allTokens.push(token);
      prev = text;
    }

    sentences.push({
      sentenceIndex: si,
      renderText: render.slice(sentenceStartChar),
      tokens: sentenceTokens,
    });
  }

  return { passageId, renderText: render, sentences, tokens: allTokens, source: passage };
}

function resolveMark(idx: IndexedPassage, mark: ByteRange): Result<TokenId, TokenResolveError> {
  const overlaps = idx.tokens.filter((t) => t.byteStart < mark.end && mark.start < t.byteEnd);
  if (overlaps.length === 1) return ok(overlaps[0]!.tokenId);
  if (overlaps.length === 0) return err({ kind: 'no_token', byteRange: mark });
  return err({ kind: 'multi_token', byteRange: mark });
}

function hitTest(idx: IndexedPassage, tokenId: TokenId): TargetSpan | null {
  const token = idx.tokens.find((t) => t.tokenId === tokenId);
  if (!token) return null;
  for (const span of idx.source.targetSpans) {
    if (
      span.sentenceIndex === token.sentenceIndex &&
      token.tokenIndex >= span.tokenStart &&
      token.tokenIndex < span.tokenEnd
    ) {
      return span;
    }
  }
  return null;
}

export const tokenizer: TokenizerJoinService = { renderText, index, resolveMark, hitTest };
