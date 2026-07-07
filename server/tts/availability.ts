/**
 * TTS provider availability, decided ONLY by the server-side environment (.env). The client
 * shows availability per voice from this; synthesis never falls back across providers, so a
 * voice whose provider is unconfigured is reported (and rejected) as unavailable instead of
 * being silently swapped for another engine's voice.
 */

import type { VoiceProvider } from '../../src/types/domain';
import type { Env } from '../llm/providers';

export function hasAzure(env: Env): boolean {
  return Boolean((env.AZURE_SPEECH_KEY || env.SPEECH_KEY)?.trim() && (env.AZURE_SPEECH_REGION || env.SPEECH_REGION)?.trim());
}

export function hasPolly(env: Env): boolean {
  return Boolean(env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim());
}

/** The key is shared with the LLM axis, so an LLM-only .env still enables narration. */
export function hasOpenAiTts(env: Env): boolean {
  const key = env.OPENAI_API_KEY;
  return Boolean(key && key.trim() && !key.includes('...')); // '...' = .env placeholder, not a key
}

export function ttsProviderAvailability(env: Env): Record<VoiceProvider, boolean> {
  return { azure: hasAzure(env), polly: hasPolly(env), openai: hasOpenAiTts(env) };
}

/** Configured providers in preference order (mirrors the voice catalog's ordering). */
export function availableTtsProviders(env: Env): VoiceProvider[] {
  const avail = ttsProviderAvailability(env);
  return (['azure', 'polly', 'openai'] as const).filter((p) => avail[p]);
}

/** What .env needs for each provider — quoted in the voice_unavailable error message. */
export const TTS_PROVIDER_REQUIREMENT: Record<VoiceProvider, string> = {
  azure: 'AZURE_SPEECH_KEY / AZURE_SPEECH_REGION',
  polly: 'AWS_REGION (Amazon Polly credentials)',
  openai: 'OPENAI_API_KEY',
};
