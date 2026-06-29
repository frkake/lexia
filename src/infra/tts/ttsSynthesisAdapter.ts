/**
 * L2 — TtsSynthesisAdapter: the TtsSynthesisPort over a TTS backend (Polly Neural
 * etc.; design.md "TtsSynthesisPort"). It synthesizes passage×voice audio + word
 * speech marks, resolves each mark's byte range to a unique tokenId via the
 * single-source-of-truth tokenizer, and — before the asset is published — verifies
 * "mark coverage == word-token count". A token-resolved, time-ordered TimingMap is
 * returned (binary-searchable by the HighlightController); the (passageId, voiceId)
 * key makes re-synthesis an idempotent overwrite at the TimingMapRepository.
 */

import { tokenizer } from '../../domain/tokenizer/joinService';
import type { TtsSynthesisPort } from '../../types/ports';
import type { AudioAsset, IndexedPassage, TimingMap, WordMark } from '../../types/domain';

/** A word-type speech mark from the backend: UTF-8 byte range + onset time (ms). */
export interface TtsWordMark {
  start: number;
  end: number;
  timeMs: number;
}

export interface TtsSynthesisResult {
  audioUrl: string;
  format: AudioAsset['format'];
  durationMs: number;
  engine: AudioAsset['engine'];
  marks: TtsWordMark[];
}

export interface TtsBackend {
  synthesize(text: string, voiceId: string): Promise<TtsSynthesisResult>;
  wordClipUrl(wordId: string, voiceId: string): Promise<string>;
}

export type TtsSynthesisErrorKind = 'mark_unresolved' | 'coverage_mismatch';

export interface TtsSynthesisError {
  kind: TtsSynthesisErrorKind;
  message: string;
}

const isWordToken = (text: string): boolean => /[a-zA-Z0-9]/.test(text);

export class TtsSynthesisAdapter implements TtsSynthesisPort {
  constructor(private readonly backend: TtsBackend) {}

  async synthesize(
    passage: IndexedPassage,
    voiceId: string,
  ): Promise<{ asset: AudioAsset; timing: TimingMap }> {
    const result = await this.backend.synthesize(passage.renderText, voiceId);

    // Resolve each mark to its unique covering token via the shared tokenizer.
    const ordered = [...result.marks].sort((a, b) => a.timeMs - b.timeMs);
    const marks: WordMark[] = [];
    const covered = new Set<string>();
    for (let i = 0; i < ordered.length; i += 1) {
      const m = ordered[i]!;
      const resolved = tokenizer.resolveMark(passage, { start: m.start, end: m.end });
      if (!resolved.ok) {
        throw fail('mark_unresolved', `mark [${m.start},${m.end}) resolves to no single token`);
      }
      covered.add(resolved.value);
      const endMs = i + 1 < ordered.length ? ordered[i + 1]!.timeMs : result.durationMs;
      marks.push({ tokenId: resolved.value, startMs: m.timeMs, endMs });
    }

    // Coverage check: every word token (punctuation excluded) must be marked exactly once.
    const wordTokenIds = passage.tokens.filter((t) => isWordToken(t.text)).map((t) => t.tokenId);
    if (covered.size !== wordTokenIds.length || !wordTokenIds.every((id) => covered.has(id))) {
      throw fail('coverage_mismatch', `covered ${covered.size} of ${wordTokenIds.length} word tokens`);
    }

    const asset: AudioAsset = {
      passageId: passage.passageId,
      voiceId,
      audioUrl: result.audioUrl,
      format: result.format,
      durationMs: result.durationMs,
      engine: result.engine,
    };
    const timing: TimingMap = { passageId: passage.passageId, voiceId, marks };
    return { asset, timing };
  }

  wordClipUrl(wordId: string, voiceId: string): Promise<string> {
    return this.backend.wordClipUrl(wordId, voiceId);
  }
}

function fail(kind: TtsSynthesisErrorKind, message: string): TtsSynthesisError {
  return { kind, message };
}
