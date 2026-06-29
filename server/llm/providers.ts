/**
 * Provider-agnostic LLM calls for the generation proxy. Selected by `LLM_PROVIDER`
 * (default "openai"; "claude"/"anthropic" switch to the Messages API). Credentials are
 * read from the server-side environment and never reach the client.
 *
 * Dependency-free on purpose: the project ships no LLM SDK, and this proxy must speak to
 * either provider chosen at runtime, so we call each REST API over `fetch`. Failures raise
 * a `ProviderError` whose `status` is the HTTP code the proxy should return — the client's
 * HttpContentGateway maps that status into a typed error the UI surfaces (503 -> "service
 * unavailable", etc.). That is how "show an error when the generation API is missing/down"
 * is honored end-to-end.
 */

import type { GenerationRequest, GenerationResponse, PassageOutput, StopReason, WordData } from '../../src/types/domain';
import {
  PASSAGE_JSON_SCHEMA,
  WORD_DATA_JSON_SCHEMA,
  buildPassageMessages,
  buildWordMessages,
  maxTokensForLength,
} from './schema';

export type Env = Record<string, string | undefined>;

/** HTTP status the proxy will return; mirrors HttpContentGateway.kindForStatus. */
export class ProviderError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

type Provider = 'openai' | 'anthropic';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

function resolveProvider(env: Env): Provider {
  const raw = (env.LLM_PROVIDER ?? 'openai').trim().toLowerCase();
  return raw === 'claude' || raw === 'anthropic' ? 'anthropic' : 'openai';
}

/** The configured key for the active provider, or throw 503 so the UI shows "unavailable". */
function requireKey(env: Env, provider: Provider): string {
  const key = provider === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;
  if (!key || !key.trim() || key.includes('...')) {
    const name = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
    throw new ProviderError(503, `Generation API not configured: ${name} is missing. Set it in .env.`);
  }
  return key.trim();
}

function modelFor(env: Env, provider: Provider): string {
  if (provider === 'anthropic') return env.ANTHROPIC_MODEL?.trim() || 'claude-opus-4-8';
  return env.OPENAI_MODEL?.trim() || 'gpt-4o';
}

/** Map an upstream HTTP status to the status the proxy returns to the client. */
function mapUpstreamStatus(status: number): number {
  if (status === 429) return 429; // rate_limited
  return 503; // auth / overload / 5xx / anything else -> "service unavailable"
}

interface CallResult {
  text: string;
  stopReason: StopReason;
}

/** One structured-JSON completion. `schema` drives Anthropic's output_config; OpenAI uses json_object. */
async function callModel(
  env: Env,
  fetchImpl: typeof fetch,
  system: string,
  user: string,
  maxTokens: number,
  schema: unknown,
  schemaName: string,
): Promise<CallResult> {
  const provider = resolveProvider(env);
  const apiKey = requireKey(env, provider);
  const model = modelFor(env, provider);

  let response: Response;
  try {
    response =
      provider === 'anthropic'
        ? await fetchImpl(ANTHROPIC_URL, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': ANTHROPIC_VERSION,
            },
            body: JSON.stringify({
              model,
              max_tokens: maxTokens,
              system,
              messages: [{ role: 'user', content: user }],
              output_config: { format: { type: 'json_schema', schema } },
            }),
          })
        : await fetchImpl(OPENAI_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model,
              max_tokens: maxTokens,
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
              ],
              // Structured Outputs: constrain the reply to the exact schema (no wrapper / missing fields).
              response_format: { type: 'json_schema', json_schema: { name: schemaName, schema, strict: true } },
            }),
          });
  } catch (cause) {
    throw new ProviderError(503, `Generation API unreachable: ${cause instanceof Error ? cause.message : 'network error'}`);
  }

  if (!response.ok) {
    const detail = await safeText(response);
    throw new ProviderError(mapUpstreamStatus(response.status), `${provider} API error ${response.status}: ${detail}`);
  }

  const body = (await response.json()) as unknown;
  return provider === 'anthropic' ? parseAnthropic(body) : parseOpenAI(body);
}

function parseOpenAI(body: unknown): CallResult {
  const choice = (body as { choices?: { message?: { content?: string }; finish_reason?: string }[] }).choices?.[0];
  const text = choice?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    throw new ProviderError(502, 'OpenAI returned an empty completion.');
  }
  const finish = choice?.finish_reason;
  const stopReason: StopReason = finish === 'length' ? 'max_tokens' : finish === 'content_filter' ? 'refusal' : 'end_turn';
  return { text, stopReason };
}

function parseAnthropic(body: unknown): CallResult {
  const msg = body as { content?: { type?: string; text?: string }[]; stop_reason?: string };
  const text = msg.content?.find((b) => b.type === 'text')?.text;
  if (typeof text !== 'string' || !text.trim()) {
    throw new ProviderError(502, 'Anthropic returned an empty completion.');
  }
  const valid: StopReason[] = ['end_turn', 'max_tokens', 'refusal', 'stop_sequence', 'tool_use', 'pause_turn'];
  const sr = msg.stop_reason ?? 'end_turn';
  const stopReason: StopReason = (valid as string[]).includes(sr) ? (sr as StopReason) : 'end_turn';
  return { text, stopReason };
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '(no body)';
  }
}

function parseJson<T>(text: string, what: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError(502, `Generation API returned non-JSON ${what}.`);
  }
}

type Raw = Record<string, unknown>;

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Some models wrap the result as `{ meta, passage: { sentences, ... } }`; lift it back to flat. */
function unwrapPassage(parsed: Raw): Raw {
  if (Array.isArray(parsed.sentences)) return parsed;
  const inner = parsed.passage;
  if (inner && typeof inner === 'object' && Array.isArray((inner as Raw).sentences)) {
    return { meta: parsed.meta ?? (inner as Raw).meta, ...(inner as Raw) };
  }
  return parsed;
}

/** Ensure arrays exist and meta is complete (backfilled from the request) for the validator/UI. */
function normalizePassage(core: Raw, req: GenerationRequest): PassageOutput {
  const sentences = asArray<PassageOutput['sentences'][number]>(core.sentences);
  const targetSpans = asArray<PassageOutput['targetSpans'][number]>(core.targetSpans);
  const collocationSpans = asArray<PassageOutput['collocationSpans'][number]>(core.collocationSpans);
  const noticeCues = asArray<PassageOutput['noticeCues'][number]>(core.noticeCues);
  const metaIn = (core.meta && typeof core.meta === 'object' ? core.meta : {}) as Partial<PassageOutput['meta']>;
  const distinct = new Map(targetSpans.map((s) => [s.wordId, s.masteryDensity]));
  const newCount = [...distinct.values()].filter((d) => d === 'new').length;
  const meta: PassageOutput['meta'] = {
    title: metaIn.title || (req.themes[0] ?? 'Reading'),
    theme: metaIn.theme || req.themes[0] || '',
    level: metaIn.level || req.level,
    newCount: typeof metaIn.newCount === 'number' ? metaIn.newCount : newCount,
    reviewCount: typeof metaIn.reviewCount === 'number' ? metaIn.reviewCount : distinct.size - newCount,
    approxWords:
      typeof metaIn.approxWords === 'number'
        ? metaIn.approxWords
        : sentences.reduce((n, s) => n + (Array.isArray(s.tokens) ? s.tokens.length : 0), 0),
  };
  return { meta, sentences, targetSpans, collocationSpans, noticeCues };
}

export async function generatePassage(
  env: Env,
  req: GenerationRequest,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<GenerationResponse> {
  const { system, user } = buildPassageMessages(req);
  const { text, stopReason } = await callModel(
    env,
    fetchImpl,
    system,
    user,
    maxTokensForLength(req.length),
    PASSAGE_JSON_SCHEMA,
    'passage_output',
  );
  // Pass refusal/max_tokens straight through so the orchestrator can regenerate.
  if (stopReason === 'refusal' || stopReason === 'max_tokens') {
    return { passage: emptyPassage(req), stopReason };
  }
  const core = unwrapPassage(parseJson<Raw>(text, 'passage'));
  if (!Array.isArray(core.sentences) || core.sentences.length === 0) {
    throw new ProviderError(502, 'Generation API returned a passage with no sentences.');
  }
  return { passage: normalizePassage(core, req), stopReason };
}

function emptyPassage(req: GenerationRequest): PassageOutput {
  return {
    meta: { title: '', theme: req.themes[0] ?? '', level: req.level, newCount: 0, reviewCount: 0, approxWords: 0 },
    sentences: [],
    targetSpans: [],
    collocationSpans: [],
    noticeCues: [],
  };
}

export async function getWordData(
  env: Env,
  wordId: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<WordData> {
  const { system, user } = buildWordMessages(wordId);
  const { text } = await callModel(env, fetchImpl, system, user, 900, WORD_DATA_JSON_SCHEMA, 'word_data');
  const parsed = parseJson<Partial<WordData>>(text, 'word data');
  if (!parsed.headword || !parsed.core) {
    throw new ProviderError(502, 'Generation API returned incomplete word data.');
  }
  return { ...parsed, wordId } as WordData;
}
