/**
 * L2 — HttpTtsBackend: the TtsBackend over the thin server proxy (design.md
 * "TtsSynthesisPort"). It POSTs the canonical passage string to the synthesis endpoint
 * and reads back the audio asset metadata + word speech marks (UTF-8 byte ranges + onset
 * times); the TtsSynthesisAdapter then resolves marks to tokenIds. Non-2xx responses
 * reject so the generation pipeline degrades gracefully (text continues, player marked
 * unavailable). Credentials stay server-side; the client never sees the TTS engine key.
 */

import type { TtsBackend, TtsSynthesisResult, TtsWordMark } from './ttsSynthesisAdapter';
import type { AudioAsset } from '../../types/domain';

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

export class HttpTtsBackend implements TtsBackend {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpTtsBackendOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
    // Bind to the global (a bare method-call of window.fetch throws "Illegal invocation").
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async synthesize(text: string, voiceId: string): Promise<TtsSynthesisResult> {
    const body = await this.request<TtsSynthesizeBody>('/api/tts:synthesize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, voiceId }),
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

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      throw new Error(`TTS request failed (${response.status})`);
    }
    return (await response.json()) as T;
  }
}
