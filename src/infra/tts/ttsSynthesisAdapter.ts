/**
 * L2 — TtsSynthesisAdapter: the TtsSynthesisPort over a TTS backend (Polly Neural
 * etc.; design.md "TtsSynthesisPort"). It synthesizes passage×voice audio + word
 * speech marks, resolves each mark's byte range to a unique tokenId via the
 * single-source-of-truth tokenizer, and — before the asset is published — verifies
 * "mark coverage == word-token count". A token-resolved, time-ordered TimingMap is
 * returned (binary-searchable by the HighlightController); the (passageId, voiceId)
 * key makes re-synthesis an idempotent overwrite at the TimingMapRepository.
 * Engines without word timestamps (OpenAI) return zero marks; the TimingMap is then
 * estimated from token lengths, so highlight follow-along is approximate.
 */

import { tokenizer } from '../../domain/tokenizer/joinService';
import type { TtsSynthesisPort } from '../../types/ports';
import type {
  AmbientNoiseLevel,
  AudioAsset,
  IndexedPassage,
  ListeningSceneKind,
  TimingMap,
  VoiceProfile,
  VoiceProvider,
  WordMark,
} from '../../types/domain';

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

export interface TtsSynthesisSegment {
  text: string;
  byteStart: number;
  voiceId: string;
  speakerId?: string;
}

export interface TtsSynthesisOptions {
  segments?: TtsSynthesisSegment[];
  scene?: {
    sceneKind: ListeningSceneKind;
    noiseLevel: AmbientNoiseLevel;
  };
}

/** A catalog voice + whether the server's .env can actually synthesize it (no fallback exists). */
export type VoiceCatalogEntry = VoiceProfile & { available: boolean };

export interface TtsBackend {
  synthesize(text: string, voiceId: string, options?: TtsSynthesisOptions): Promise<TtsSynthesisResult>;
  wordClipUrl(wordId: string, voiceId: string): Promise<string>;
  /** Voice catalog with per-voice availability (absent on backends without the endpoint). */
  voices?(): Promise<{ voices: VoiceCatalogEntry[]; providers: Record<VoiceProvider, boolean> }>;
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
    const result = await this.backend.synthesize(passage.renderText, voiceId, synthesisOptions(passage, voiceId));

    // Engines without word timestamps (OpenAI) return zero marks; estimate timing from the
    // passage's own word tokens instead. One mark per word token by construction, so the
    // byte-range resolution and coverage checks below are unnecessary on this path. Keyed on
    // the engine, never on an empty mark set: mark-capable engines (Azure/Polly) returning
    // no marks is a fault the coverage check must surface, not an estimation fallback.
    const marks = result.engine === 'openai' ? estimatedWordMarks(passage, result.durationMs) : resolvedMarks(passage, result);

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

  /** Per-voice availability from the server .env; undefined when the backend has no endpoint. */
  async voices(): Promise<VoiceCatalogEntry[] | undefined> {
    if (!this.backend.voices) return undefined;
    return (await this.backend.voices()).voices;
  }
}

function resolvedMarks(passage: IndexedPassage, result: TtsSynthesisResult): WordMark[] {
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
  return marks;
}

/**
 * Estimated timing for engines that provide no speech marks: each word token's window is
 * proportional to its text length, spread over the full duration. Highlight follow-along
 * is therefore approximate, unlike the exact per-word timestamps from Azure/Polly.
 */
export function estimatedWordMarks(passage: IndexedPassage, durationMs: number): WordMark[] {
  const wordTokens = passage.tokens.filter((t) => isWordToken(t.text));
  if (wordTokens.length === 0) return [];
  const weights = wordTokens.map((t) => Math.max(2, t.text.length));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let elapsed = 0;
  const starts = weights.map((w) => {
    const start = Math.round((elapsed / total) * durationMs);
    elapsed += w;
    return start;
  });
  return wordTokens.map((t, i) => ({
    tokenId: t.tokenId,
    startMs: starts[i]!,
    endMs: i + 1 < starts.length ? starts[i + 1]! : durationMs,
  }));
}

function synthesisOptions(passage: IndexedPassage, voiceId: string): TtsSynthesisOptions | undefined {
  const scene = passage.source.meta.listeningScene;
  if (!scene) return undefined;
  const speakerVoice = new Map(scene.speakers.map((s) => [s.speakerId, s.voiceProfileId]));
  const segments: TtsSynthesisSegment[] = passage.sentences
    .map((sentence) => {
      const first = sentence.tokens[0];
      if (!first) return null;
      const sourceSentence = passage.source.sentences[sentence.sentenceIndex];
      const speakerId = sourceSentence?.speakerId;
      return {
        text: sentence.renderText,
        byteStart: first.byteStart,
        voiceId: (speakerId && speakerVoice.get(speakerId)) || voiceId,
        ...(speakerId ? { speakerId } : {}),
      };
    })
    .filter((s): s is TtsSynthesisSegment => s !== null);
  return segments.length > 0
    ? {
        segments,
        scene: { sceneKind: scene.sceneKind, noiseLevel: scene.noiseLevel },
      }
    : undefined;
}

function fail(kind: TtsSynthesisErrorKind, message: string): TtsSynthesisError {
  return { kind, message };
}
