/**
 * Server-side TTS provider bridge. Credentials stay in the Vite middleware process; the
 * browser only receives a playable data URL plus byte/time word marks.
 */

import type { PollyClient as PollyClientType, VoiceId } from '@aws-sdk/client-polly';
import type {
  AmbientNoiseLevel,
  AudioAsset,
  EnglishAccent,
  ListeningSceneKind,
  VoiceProfile,
  VoiceProvider,
} from '../../src/types/domain';
import {
  compatibleVoiceForProvider,
  resolveVoiceProfile,
  VOICE_PROFILES,
} from '../../src/domain/audio/voiceCatalog';
import type { TtsWordMark } from '../../src/infra/tts/ttsSynthesisAdapter';
import { ProviderError, type Env, type ProviderErrorCode } from '../llm/providers';
import { availableTtsProviders, TTS_PROVIDER_REQUIREMENT, ttsProviderAvailability } from './availability';

export interface TtsSegmentRequest {
  text: string;
  byteStart: number;
  voiceId: string;
  speakerId?: string;
}

export interface TtsSynthesizeRequest {
  text: string;
  voiceId: string;
  segments?: TtsSegmentRequest[];
  scene?: {
    sceneKind: ListeningSceneKind;
    noiseLevel: AmbientNoiseLevel;
  };
}

export interface TtsSynthesizeResponse {
  audioUrl: string;
  format: AudioAsset['format'];
  durationMs: number;
  engine: AudioAsset['engine'];
  marks: TtsWordMark[];
}

interface SegmentAudio {
  audio: Buffer;
  marks: TtsWordMark[];
  durationMs: number;
}

const encoder = new TextEncoder();

const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';

/**
 * Voice catalog + per-voice availability, decided by the server .env (the client cannot know
 * which providers are configured). `available: false` voices are selectable nowhere and the
 * UI says so instead of silently synthesizing with a different voice.
 */
export function voiceCatalogResponse(env: Env) {
  const avail = ttsProviderAvailability(env);
  return {
    voices: VOICE_PROFILES.map((v) => ({ ...v, available: avail[v.provider] })),
    providers: avail,
  };
}

/**
 * Strict availability gate: the requested voice's own provider must be configured. There is
 * deliberately NO cross-provider fallback — synthesizing with a different voice than the one
 * the user picked hides the misconfiguration; a typed 503 surfaces it instead.
 */
function requireVoiceAvailable(env: Env, voiceId: string | undefined): ReturnType<typeof resolveVoiceProfile> {
  const profile = resolveVoiceProfile(voiceId);
  const avail = ttsProviderAvailability(env);
  if (avail[profile.provider]) return profile;
  if (availableTtsProviders(env).length === 0) {
    throw new ProviderError(
      503,
      'TTS API not configured: set AZURE_SPEECH_KEY/AZURE_SPEECH_REGION, AWS Polly credentials, or OPENAI_API_KEY.',
      'not_configured',
    );
  }
  throw new ProviderError(
    503,
    `Voice "${profile.labelJa}" (${profile.id}) needs the ${profile.provider} provider, which is not configured: set ${TTS_PROVIDER_REQUIREMENT[profile.provider]} in .env.`,
    'voice_unavailable',
  );
}

export function utf16RangeToUtf8ByteRange(text: string, charStart: number, charLength: number, baseByteStart = 0): { start: number; end: number } {
  const start = baseByteStart + encoder.encode(text.slice(0, charStart)).length;
  const end = start + encoder.encode(text.slice(charStart, charStart + charLength)).length;
  return { start, end };
}

export function azureAudioOffsetToMs(audioOffset: number): number {
  return Math.round(audioOffset / 10_000); // Azure reports 100-nanosecond units.
}

export function parsePollyMarks(text: string, baseByteStart: number, timeOffsetMs: number): TtsWordMark[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type?: string; start?: number; end?: number; time?: number })
    .filter((m) => m.type === 'word' && typeof m.start === 'number' && typeof m.end === 'number' && typeof m.time === 'number')
    .map((m) => ({ start: baseByteStart + m.start!, end: baseByteStart + m.end!, timeMs: timeOffsetMs + m.time! }));
}

export async function synthesizeSpeech(
  env: Env,
  req: TtsSynthesizeRequest,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<TtsSynthesizeResponse> {
  const segments = normalizedSegments(req);
  // The request's primary voice decides the engine, strictly: unavailable ⇒ typed 503, never a
  // silent swap. Stray segments from ANOTHER provider (legacy persisted scenes) are unified onto
  // the primary provider for format/mark consistency — new scenes are assigned availability-aware
  // voices at generation time, so this remap is a legacy-only path.
  const firstProfile = requireVoiceAvailable(env, segments[0]?.voiceId ?? req.voiceId);

  if (firstProfile.provider === 'azure') {
    const rendered = await Promise.all(
      segments.map((segment) => synthesizeAzureSegment(env, providerSegment(segment, 'azure'))),
    );
    const joined = concatWav(rendered);
    const audio = applySceneEffectToWav(joined.audio, req.scene);
    return {
      audioUrl: dataUrl(audio, 'audio/wav'),
      format: 'audio/wav',
      durationMs: joined.durationMs,
      engine: 'azure',
      marks: joined.marks,
    };
  }

  if (firstProfile.provider === 'polly') {
    const rendered = await synthesizePollyWhole(env, req.text, compatibleVoiceForProvider(req.voiceId, 'polly').id);
    return {
      audioUrl: dataUrl(rendered.audio, 'audio/mpeg'),
      format: 'audio/mpeg',
      durationMs: rendered.durationMs,
      engine: 'polly',
      marks: rendered.marks,
    };
  }

  return synthesizeOpenAiSpeech(env, req, segments, fetchImpl);
}

export async function synthesizeWordClip(
  env: Env,
  wordId: string,
  voiceId: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<{ url: string }> {
  const profile = requireVoiceAvailable(env, voiceId);
  if (profile.provider === 'azure') {
    const rendered = await synthesizeAzureSegment(env, { text: wordId, byteStart: 0, voiceId: profile.id });
    return { url: dataUrl(rendered.audio, 'audio/wav') };
  }
  if (profile.provider === 'polly') {
    const rendered = await synthesizePollyAudio(env, wordId, profile.id);
    return { url: dataUrl(rendered, 'audio/mpeg') };
  }
  const rendered = await synthesizeOpenAiSegment(
    env,
    { text: wordId, byteStart: 0, voiceId: profile.id },
    undefined,
    fetchImpl,
  );
  return { url: dataUrl(rendered.audio, 'audio/wav') };
}

function normalizedSegments(req: TtsSynthesizeRequest): TtsSegmentRequest[] {
  const valid = req.segments?.filter((s) => s.text.trim() && Number.isFinite(s.byteStart) && s.voiceId.trim()) ?? [];
  return valid.length > 0 ? valid : [{ text: req.text, byteStart: 0, voiceId: req.voiceId }];
}

function providerSegment(segment: TtsSegmentRequest, provider: VoiceProvider): TtsSegmentRequest {
  return { ...segment, voiceId: compatibleVoiceForProvider(segment.voiceId, provider).id };
}

async function synthesizeAzureSegment(env: Env, segment: TtsSegmentRequest): Promise<SegmentAudio> {
  const sdk = await import('microsoft-cognitiveservices-speech-sdk');
  const key = (env.AZURE_SPEECH_KEY || env.SPEECH_KEY || '').trim();
  const region = (env.AZURE_SPEECH_REGION || env.SPEECH_REGION || '').trim();
  if (!key || !region) throw new ProviderError(503, 'Azure Speech is not configured.');

  const profile = resolveVoiceProfile(segment.voiceId);
  const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
  speechConfig.speechSynthesisVoiceName = profile.providerVoiceId;
  speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm;

  const marks: TtsWordMark[] = [];
  const synthesizer = new sdk.SpeechSynthesizer(speechConfig, undefined);
  synthesizer.wordBoundary = (_sender, event) => {
    const e = event as { audioOffset?: number; textOffset?: number; wordLength?: number };
    if (typeof e.audioOffset !== 'number' || typeof e.textOffset !== 'number' || typeof e.wordLength !== 'number') return;
    const range = utf16RangeToUtf8ByteRange(segment.text, e.textOffset, e.wordLength, segment.byteStart);
    marks.push({ ...range, timeMs: azureAudioOffsetToMs(e.audioOffset) });
  };

  try {
    const audio = await new Promise<Buffer>((resolve, reject) => {
      synthesizer.speakTextAsync(
        segment.text,
        (result) => resolve(Buffer.from(result.audioData)),
        (error) => reject(new ProviderError(503, `Azure Speech synthesis failed: ${String(error)}`)),
      );
    });
    return { audio, marks, durationMs: wavDurationMs(audio) };
  } finally {
    synthesizer.close();
  }
}

async function synthesizeOpenAiSpeech(
  env: Env,
  req: TtsSynthesizeRequest,
  segments: TtsSegmentRequest[],
  fetchImpl: typeof fetch,
): Promise<TtsSynthesizeResponse> {
  const rendered = await Promise.all(
    segments.map((segment) => synthesizeOpenAiSegment(env, providerSegment(segment, 'openai'), req.scene?.sceneKind, fetchImpl)),
  );
  const joined = concatWav(rendered);
  const audio = applySceneEffectToWav(joined.audio, req.scene);
  return {
    audioUrl: dataUrl(audio, 'audio/wav'),
    format: 'audio/wav',
    durationMs: joined.durationMs,
    engine: 'openai',
    // OpenAI returns no word timestamps; the client estimates highlight timing.
    marks: [],
  };
}

async function synthesizeOpenAiSegment(
  env: Env,
  segment: TtsSegmentRequest,
  sceneKind: ListeningSceneKind | undefined,
  fetchImpl: typeof fetch,
): Promise<SegmentAudio> {
  const key = (env.OPENAI_API_KEY || '').trim();
  if (!key || key.includes('...')) {
    throw new ProviderError(503, 'TTS API not configured: OPENAI_API_KEY is missing. Set it in .env.', 'not_configured');
  }
  const profile = resolveVoiceProfile(segment.voiceId);
  const model = env.OPENAI_TTS_MODEL?.trim() || 'gpt-4o-mini-tts';
  const body: Record<string, unknown> = {
    model,
    voice: profile.providerVoiceId,
    input: segment.text,
    // WAV keeps the 24 kHz/16-bit/mono pipeline (segment concat + scene texture) applicable.
    response_format: 'wav',
  };
  // Only the gpt-4o TTS family accepts `instructions`; tts-1 / tts-1-hd reject the field.
  if (model.startsWith('gpt-4o')) body.instructions = openAiInstructions(profile, sceneKind);

  let response: Response;
  try {
    response = await fetchImpl(OPENAI_TTS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new ProviderError(
      503,
      `TTS API unreachable: ${cause instanceof Error ? cause.message : 'network error'}`,
      'upstream_error',
    );
  }
  if (!response.ok) {
    const detail = await safeText(response);
    const mapped = mapUpstream(response.status);
    throw new ProviderError(mapped.status, `openai TTS API error ${response.status}: ${detail}`, mapped.code);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  // No word timestamps from OpenAI: marks stay empty and the client estimates timing.
  return { audio, marks: [], durationMs: wavDurationMs(audio) };
}

/** OpenAI voices are accent-neutral, so accent (and scene delivery) rides on instructions. */
function openAiInstructions(profile: VoiceProfile, sceneKind?: ListeningSceneKind): string {
  const parts = [OPENAI_ACCENT_INSTRUCTIONS[profile.accent]];
  if (sceneKind) parts.push(OPENAI_SCENE_INSTRUCTIONS[sceneKind]);
  return parts.join(' ');
}

const OPENAI_ACCENT_INSTRUCTIONS: Record<EnglishAccent, string> = {
  us: 'Speak with a General American English accent.',
  gb: 'Speak with a British English accent.',
  au: 'Speak with an Australian English accent.',
  in: 'Speak with an Indian English accent.',
};

const OPENAI_SCENE_INSTRUCTIONS: Record<ListeningSceneKind, string> = {
  radio_news: 'Deliver it like a radio news anchor.',
  street_interview: 'Deliver it like a spontaneous street interview answer.',
  podcast_dialogue: 'Deliver it like a relaxed podcast conversation.',
  public_announcement: 'Deliver it like a public address announcement.',
  casual_conversation: 'Speak casually, like friends chatting.',
  tv_broadcast: 'Deliver it like a TV news broadcast.',
};

/** Mirrors server/llm/providers mapUpstream (not exported there). */
function mapUpstream(status: number): { status: number; code: ProviderErrorCode } {
  if (status === 429) return { status: 429, code: 'rate_limited' };
  if (status === 401 || status === 403) return { status: 503, code: 'upstream_auth' };
  return { status: 503, code: 'upstream_error' };
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '(no body)';
  }
}

/** Joins rendered segments; assumes the shared 24 kHz/16-bit/mono RIFF format (Azure and OpenAI). */
function concatWav(segments: SegmentAudio[]): SegmentAudio {
  if (segments.length === 1) return segments[0]!;
  const chunks = segments.map((s) => wavDataChunk(s.audio));
  const data = Buffer.concat(chunks);
  let timeOffset = 0;
  const marks: TtsWordMark[] = [];
  for (const segment of segments) {
    marks.push(...segment.marks.map((m) => ({ ...m, timeMs: m.timeMs + timeOffset })));
    timeOffset += segment.durationMs;
  }
  return { audio: wavWithHeader(data), marks, durationMs: wavDurationMs(wavWithHeader(data)) };
}

export function applySceneEffectToWav(
  wav: Buffer,
  scene?: { sceneKind: ListeningSceneKind; noiseLevel: AmbientNoiseLevel },
): Buffer {
  if (!scene || scene.noiseLevel === 'none') return wav;
  const source = wavDataChunk(wav);
  if (source.length < 2) return wav;
  const data = Buffer.from(source);
  const amplitude = scene.noiseLevel === 'medium' ? 900 : 360;
  for (let offset = 0, i = 0; offset + 1 < data.length; offset += 2, i += 1) {
    const sample = data.readInt16LE(offset);
    const texture = sceneTextureSample(i, scene.sceneKind);
    data.writeInt16LE(clampPcm16(sample + Math.round(texture * amplitude)), offset);
  }
  return wavWithHeader(data);
}

function sceneTextureSample(i: number, sceneKind: ListeningSceneKind): number {
  const white = deterministicNoise(i);
  // tv_broadcast shares the radio_news broadcast hum; casual_conversation stays on the quiet
  // indoor fallback like podcast_dialogue.
  if (sceneKind === 'radio_news' || sceneKind === 'tv_broadcast')
    return white * 0.35 + Math.sin((2 * Math.PI * 120 * i) / 24_000) * 0.18;
  if (sceneKind === 'street_interview') return white * 0.75 + Math.sin((2 * Math.PI * 180 * i) / 24_000) * 0.12;
  if (sceneKind === 'public_announcement') return white * 0.28 + Math.sin((2 * Math.PI * 90 * i) / 24_000) * 0.15;
  return white * 0.45;
}

function deterministicNoise(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function clampPcm16(value: number): number {
  return Math.max(-32_768, Math.min(32_767, value));
}

function wavDataChunk(wav: Buffer): Buffer {
  if (wav.toString('ascii', 0, 4) !== 'RIFF') return wav;
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === 'data') return wav.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size;
  }
  return wav.subarray(44);
}

function wavWithHeader(data: Buffer): Buffer {
  const sampleRate = 24_000;
  const bitsPerSample = 16;
  const channels = 1;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function wavDurationMs(wav: Buffer): number {
  const data = wavDataChunk(wav);
  return Math.round((data.length / (24_000 * 2)) * 1000);
}

async function synthesizePollyWhole(env: Env, text: string, voiceId: string): Promise<SegmentAudio> {
  const [audio, marksText] = await Promise.all([
    synthesizePollyAudio(env, text, voiceId),
    synthesizePollyMarks(env, text, voiceId),
  ]);
  const marks = parsePollyMarks(marksText, 0, 0);
  return { audio, marks, durationMs: Math.max(1_000, (marks.at(-1)?.timeMs ?? 0) + 700) };
}

async function synthesizePollyAudio(env: Env, text: string, voiceId: string): Promise<Buffer> {
  const { SynthesizeSpeechCommand } = await import('@aws-sdk/client-polly');
  const response = await (await polly(env)).send(
    new SynthesizeSpeechCommand({
      Text: text,
      OutputFormat: 'mp3',
      Engine: (env.POLLY_ENGINE?.trim() || 'neural') as 'neural' | 'standard',
      VoiceId: resolveVoiceProfile(voiceId).providerVoiceId as VoiceId,
    }),
  );
  return streamToBuffer(response.AudioStream);
}

async function synthesizePollyMarks(env: Env, text: string, voiceId: string): Promise<string> {
  const { SynthesizeSpeechCommand } = await import('@aws-sdk/client-polly');
  const response = await (await polly(env)).send(
    new SynthesizeSpeechCommand({
      Text: text,
      OutputFormat: 'json',
      SpeechMarkTypes: ['word'],
      Engine: (env.POLLY_ENGINE?.trim() || 'neural') as 'neural' | 'standard',
      VoiceId: resolveVoiceProfile(voiceId).providerVoiceId as VoiceId,
    }),
  );
  return (await streamToBuffer(response.AudioStream)).toString('utf8');
}

async function polly(env: Env): Promise<PollyClientType> {
  const { PollyClient } = await import('@aws-sdk/client-polly');
  return new PollyClient({ region: (env.AWS_REGION || env.AWS_DEFAULT_REGION || 'us-east-1').trim() });
}

async function streamToBuffer(stream: unknown): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0);
  if (stream instanceof Uint8Array) return Buffer.from(stream);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function dataUrl(buffer: Buffer, mime: string): string {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}
