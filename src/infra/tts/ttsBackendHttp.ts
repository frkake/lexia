/**
 * L2 — HttpTtsBackend: the TtsBackend over the thin server proxy (design.md
 * "TtsSynthesisPort"). It POSTs the canonical passage string to the synthesis endpoint
 * and reads back the audio asset metadata + word speech marks (UTF-8 byte ranges + onset
 * times); the TtsSynthesisAdapter then resolves marks to tokenIds. Non-2xx responses
 * reject so the generation pipeline degrades gracefully (text continues, player marked
 * unavailable). Credentials stay server-side; the client never sees the TTS engine key.
 */

import type { TtsBackend, TtsSynthesisOptions, TtsSynthesisResult, TtsWordMark, VoiceCatalogEntry } from './ttsSynthesisAdapter';
import type { AudioAsset, VoiceProvider } from '../../types/domain';

export interface HttpTtsBackendOptions {
  baseUrl?: string;
  /** Injectable fetch (defaults to the global) for testability. */
  fetch?: typeof fetch;
}

export interface TtsSynthesizeBody {
  audioUrl: string;
  format: AudioAsset['format'];
  durationMs: number;
  engine: AudioAsset['engine'];
  marks: TtsWordMark[];
}

/** Machine-readable cause codes the TTS proxy attaches to error bodies (server ProviderErrorCode). */
export type TtsErrorCode = 'not_configured' | 'voice_unavailable' | 'rate_limited' | 'upstream_auth' | 'upstream_error';

/** A non-2xx TTS proxy reply, keeping the typed `code` so the UI can say WHY narration failed. */
export class TtsHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: TtsErrorCode,
  ) {
    super(message);
    this.name = 'TtsHttpError';
  }
}

/**
 * User-facing Japanese reason for a failed synthesize. The unavailability cases are explicit —
 * the server no longer falls back to a different voice, so the UI must say what cannot be
 * generated (and why) instead of playing something the user did not choose.
 */
export function ttsUnavailableReasonJa(error: unknown): string {
  if (error instanceof TtsHttpError) {
    if (error.code === 'voice_unavailable')
      return 'この話者の音声はこの環境では生成できません（.env のTTSプロバイダ設定を確認してください）。別の話者に切り替えると再生できます。';
    if (error.code === 'not_configured')
      return '音声合成が未設定です。.env に AZURE_SPEECH_KEY / AWS_REGION / OPENAI_API_KEY のいずれかを設定してください。';
    if (error.code === 'rate_limited') return '音声合成のレート制限に達しました。しばらく待って再試行してください。';
    if (error.code === 'upstream_auth') return '音声合成プロバイダの認証に失敗しました（APIキーを確認してください）。';
    return '音声の生成に失敗しました。';
  }
  return '音声の生成に失敗しました。';
}

export class HttpTtsBackend implements TtsBackend {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpTtsBackendOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
    // Bind to the global (a bare method-call of window.fetch throws "Illegal invocation").
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async synthesize(text: string, voiceId: string, options: TtsSynthesisOptions = {}): Promise<TtsSynthesisResult> {
    const body = await this.request<TtsSynthesizeBody>('/api/tts:synthesize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        voiceId,
        ...(options.segments ? { segments: options.segments } : {}),
        ...(options.scene ? { scene: options.scene } : {}),
      }),
    });
    return {
      audioUrl: body.audioUrl,
      format: body.format,
      durationMs: body.durationMs,
      engine: body.engine,
      marks: body.marks,
    };
  }

  async wordClipUrl(wordId: string, voiceId: string): Promise<string> {
    const body = await this.request<{ url: string }>(
      `/api/tts/word?wordId=${encodeURIComponent(wordId)}&voiceId=${encodeURIComponent(voiceId)}`,
      { method: 'GET' },
    );
    return body.url;
  }

  /** Voice catalog with per-voice availability, decided by the server's .env. */
  async voices(): Promise<{ voices: VoiceCatalogEntry[]; providers: Record<VoiceProvider, boolean> }> {
    return this.request(`/api/tts:voices`, { method: 'GET' });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      // The proxy replies { error, code? }; keep the code so the UI can name the cause.
      let message = `TTS request failed (${response.status})`;
      let code: TtsErrorCode | undefined;
      try {
        const body = (await response.json()) as { error?: string; code?: TtsErrorCode };
        if (body.error) message = body.error;
        code = body.code;
      } catch {
        // non-JSON error body — keep the generic message
      }
      throw new TtsHttpError(response.status, message, code);
    }
    return (await response.json()) as T;
  }
}
