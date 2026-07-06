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

import type {
  AnnotationResult,
  AnnotationStatus,
  CharacterIllustrationRequest,
  ExpressionCategory,
  GenerationRequest,
  GenerationResponse,
  NoticeCue,
  PassageAnnotationRequest,
  PassageIllustrationRequest,
  PassageOutput,
  ReviewSentenceRequest,
  Sentence,
  SentenceSyntaxNote,
  SpanRef,
  StopReason,
  SyntaxPattern,
  SyntaxSpan,
  StoryPlan,
  StoryPlanExtensionRequest,
  StoryPlanRequest,
  TranslationSpan,
  VoiceRole,
  WordData,
  WordSuggestionRequest,
} from '../../src/types/domain';
import {
  ANNOTATION_CATEGORIES,
  ANNOTATION_JSON_SCHEMA,
  PASSAGE_JSON_SCHEMA,
  REVIEW_SENTENCE_JSON_SCHEMA,
  REVIEW_SENTENCE_MAX_TOKENS,
  STORY_PLAN_EXTENSION_JSON_SCHEMA,
  STORY_PLAN_JSON_SCHEMA,
  WORD_DATA_JSON_SCHEMA,
  WORD_SUGGESTION_JSON_SCHEMA,
  annotationMaxTokens,
  buildAnnotationMessages,
  buildCharacterIllustrationPrompt,
  buildPassageMessages,
  buildPassageIllustrationPrompt,
  buildReviewSentenceMessages,
  buildStoryPlanExtensionMessages,
  buildStoryPlanMessages,
  buildSuggestionMessages,
  buildWordMessages,
  maxTokensForWordTarget,
  storyPlanMaxTokens,
  storyPlanExtensionMaxTokens,
} from './schema';
import { tokenizer } from '../../src/domain/tokenizer/joinService';
import { structureCollocations, structureMore } from '../../src/domain/wordData/structuredWordData';
import { defaultVoiceForAccent } from '../../src/domain/audio/voiceCatalog';

export type Env = Record<string, string | undefined>;

/**
 * Machine-readable failure code the proxy attaches to error responses so the client can show a
 * cause-specific message instead of a generic "try again later". `not_configured` = the API key is
 * missing; `rate_limited` = upstream 429; `upstream_auth` = upstream rejected the key (401/403);
 * `upstream_error` = any other upstream/transport failure.
 */
export type ProviderErrorCode = 'not_configured' | 'rate_limited' | 'upstream_auth' | 'upstream_error';

/** HTTP status the proxy will return; mirrors HttpContentGateway.kindForStatus. */
export class ProviderError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Optional machine-readable cause the client maps to a specific ContentGatewayError kind. */
    readonly code?: ProviderErrorCode,
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
    throw new ProviderError(
      503,
      `Generation API not configured: ${name} is missing. Set it in .env.`,
      'not_configured',
    );
  }
  return key.trim();
}

/** Configuration probe backing GET /api/health. Reports whether the active provider has a usable key. */
export function healthStatus(env: Env): { configured: boolean; provider: Provider } {
  const provider = resolveProvider(env);
  const key = provider === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;
  const configured = Boolean(key && key.trim() && !key.includes('...'));
  return { configured, provider };
}

/**
 * Per-task generation parameters. Text generation wants a creative temperature and can point at a
 * different model than the low-temperature annotation/word-data passes, all switchable via env
 * (`LLM_MODEL_PASSAGE` / `LLM_MODEL_ANNOTATION` / `LLM_MODEL_WORDPACK`).
 */
type Task = 'passage' | 'annotation' | 'wordpack' | 'story';

/** Task → optional model-override env var; unset tasks fall back to OPENAI_MODEL / ANTHROPIC_MODEL. */
const TASK_MODEL_ENV: Partial<Record<Task, string>> = {
  passage: 'LLM_MODEL_PASSAGE',
  annotation: 'LLM_MODEL_ANNOTATION',
  wordpack: 'LLM_MODEL_WORDPACK',
};

function modelFor(env: Env, provider: Provider, task?: Task): string {
  const overrideKey = task ? TASK_MODEL_ENV[task] : undefined;
  const taskOverride = overrideKey ? env[overrideKey]?.trim() : undefined;
  if (taskOverride) return taskOverride;
  if (provider === 'anthropic') return env.ANTHROPIC_MODEL?.trim() || 'claude-opus-4-8';
  return env.OPENAI_MODEL?.trim() || 'gpt-4o';
}

/** Reasoning models (o-series, gpt-5 series) reject a custom `temperature`, so omit it for them. */
function acceptsTemperature(model: string): boolean {
  const m = model.trim().toLowerCase();
  return !(/^o\d/.test(m) || m.startsWith('gpt-5'));
}

/** Map an upstream HTTP failure to the status + machine-readable code the proxy returns. */
function mapUpstream(status: number): { status: number; code: ProviderErrorCode } {
  if (status === 429) return { status: 429, code: 'rate_limited' }; // rate_limited
  if (status === 401 || status === 403) return { status: 503, code: 'upstream_auth' }; // bad/rejected key
  return { status: 503, code: 'upstream_error' }; // overload / 5xx / anything else
}

interface CallResult {
  text: string;
  stopReason: StopReason;
}

/** Optional per-call task parameters (temperature + task-specific model selection). */
interface CallOptions {
  temperature?: number;
  task?: Task;
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
  options: CallOptions = {},
): Promise<CallResult> {
  const provider = resolveProvider(env);
  const apiKey = requireKey(env, provider);
  const model = modelFor(env, provider, options.task);
  const { temperature } = options;

  let response: Response;
  try {
    if (provider === 'anthropic') {
      const body: Record<string, unknown> = {
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { format: { type: 'json_schema', schema } },
      };
      if (temperature !== undefined) body.temperature = temperature;
      response = await fetchImpl(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      });
    } else {
      const body: Record<string, unknown> = {
        model,
        // New OpenAI model series require `max_completion_tokens`; gpt-4o accepts it too, so sending
        // it (instead of the deprecated `max_tokens`) lets OPENAI_MODEL point at a newer model
        // without a 400 while staying backward-compatible.
        max_completion_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        // Structured Outputs: constrain the reply to the exact schema (no wrapper / missing fields).
        response_format: { type: 'json_schema', json_schema: { name: schemaName, schema, strict: true } },
      };
      // Reasoning models (o-series / gpt-5) reject a custom temperature, so only send it otherwise.
      if (temperature !== undefined && acceptsTemperature(model)) body.temperature = temperature;
      response = await fetchImpl(OPENAI_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
    }
  } catch (cause) {
    throw new ProviderError(
      503,
      `Generation API unreachable: ${cause instanceof Error ? cause.message : 'network error'}`,
      'upstream_error',
    );
  }

  if (!response.ok) {
    const detail = await safeText(response);
    const mapped = mapUpstream(response.status);
    throw new ProviderError(mapped.status, `${provider} API error ${response.status}: ${detail}`, mapped.code);
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

/** A translation span as the model emits it: a verbatim JA anchor, no offsets (server re-derives). */
type RawTranslationSpan = {
  anchorTextJa?: string;
  refType?: TranslationSpan['refType'];
  wordId?: string;
  isNew?: boolean;
};

/**
 * Re-derive each translation span's UTF-16 char offsets by locating its verbatim `anchorTextJa`
 * inside `translationJa` (the model quotes the JA correctly but miscounts offsets — same failure
 * mode as target/notice spans). Spans whose anchor is absent, blank, or has an invalid refType are
 * dropped; later occurrences track an advancing cursor so repeated anchors map to distinct ranges.
 * Returns `undefined` when there is nothing to emit, keeping pre-feature sentences untouched.
 */
const VALID_REF_TYPES = new Set<TranslationSpan['refType']>(['word', 'collocation', 'idiom', 'grammar']);

function reanchorTranslationSpans(translationJa: string, raw: RawTranslationSpan[]): TranslationSpan[] | undefined {
  const out: TranslationSpan[] = [];
  let cursor = 0;
  for (const span of raw) {
    const anchor = typeof span.anchorTextJa === 'string' ? span.anchorTextJa.trim() : '';
    const refType = span.refType;
    if (!anchor || !refType || !VALID_REF_TYPES.has(refType)) continue;
    let at = translationJa.indexOf(anchor, cursor);
    if (at < 0) at = translationJa.indexOf(anchor); // fall back to the first occurrence
    if (at < 0) continue; // anchor not present in the translation → drop
    cursor = at + anchor.length;
    out.push({
      charStart: at,
      charEnd: at + anchor.length,
      refType,
      ...(typeof span.wordId === 'string' && span.wordId ? { wordId: span.wordId } : {}),
      isNew: span.isNew === true,
    });
  }
  return out.length > 0 ? out : undefined;
}

/** Map a raw model sentence to a domain Sentence, re-deriving any translation-span offsets. */
function normalizeSentence(raw: Raw): Sentence {
  const tokens = asArray<string>(raw.tokens);
  const translationJa = typeof raw.translationJa === 'string' ? raw.translationJa : '';
  const rawSpans = asArray<RawTranslationSpan>(raw.translationSpans);
  const translationSpans = reanchorTranslationSpans(translationJa, rawSpans);
  // paragraphIndex (F-8②): carried through when the model supplies it; absent ⇒ single-paragraph
  // fallback in the reader (back-compat with passages generated before this field).
  const paragraphIndex = typeof raw.paragraphIndex === 'number' ? raw.paragraphIndex : undefined;
  const speakerId = typeof raw.speakerId === 'string' && raw.speakerId.trim() ? raw.speakerId.trim() : undefined;
  return {
    tokens,
    translationJa,
    ...(translationSpans ? { translationSpans } : {}),
    ...(paragraphIndex !== undefined ? { paragraphIndex } : {}),
    ...(speakerId ? { speakerId } : {}),
  };
}

function listeningSpeakers(req: GenerationRequest): NonNullable<PassageOutput['meta']['listeningScene']>['speakers'] {
  if (!req.listeningOptions) return [];
  const accent = req.listeningOptions.accent;
  const mk = (speakerId: string, label: string, role: VoiceRole, gender: 'female' | 'male') => ({
    speakerId,
    label,
    role,
    voiceProfileId: defaultVoiceForAccent(accent, gender, role).id,
  });
  switch (req.listeningOptions.sceneKind) {
    case 'radio_news':
      return [mk('anchor', 'Anchor', 'announcer', 'female'), mk('reporter', 'Reporter', 'guest', 'male')];
    case 'street_interview':
      return [
        mk('interviewer', 'Interviewer', 'interviewer', 'female'),
        mk('guest_1', 'Guest 1', 'guest', 'male'),
        mk('guest_2', 'Guest 2', 'guest', 'female'),
      ];
    case 'podcast_dialogue':
      return [mk('host', 'Host', 'interviewer', 'female'), mk('guest_1', 'Guest', 'guest', 'male')];
    case 'public_announcement':
      return [mk('announcer', 'Announcer', 'announcer', 'female')];
  }
  return [];
}

/** Ensure arrays exist and request-owned meta stays authoritative for the validator/UI. */
function normalizePassage(core: Raw, req: GenerationRequest): PassageOutput {
  const sentences = asArray<Raw>(core.sentences).map(normalizeSentence);
  const targetSpans = asArray<PassageOutput['targetSpans'][number]>(core.targetSpans);
  const collocationSpans = asArray<PassageOutput['collocationSpans'][number]>(core.collocationSpans);
  const noticeCues = asArray<PassageOutput['noticeCues'][number]>(core.noticeCues);
  const expressionSpans = asArray<RawExpressionSpan>(core.expressionSpans);
  const syntaxSpans = normalizeSyntaxSpans(asArray<RawSyntaxSpan>(core.syntaxSpans), sentences.length);
  const metaIn = (core.meta && typeof core.meta === 'object' ? core.meta : {}) as Partial<PassageOutput['meta']>;
  const distinct = new Map(targetSpans.map((s) => [s.wordId, s.masteryDensity]));
  const newCount = [...distinct.values()].filter((d) => d === 'new').length;
  const storyRef = req.storyContext
    ? { storyId: req.storyContext.storyId, chapterIndex: req.storyContext.chapterIndex }
    : metaIn.storyRef;
  const meta: PassageOutput['meta'] = {
    title: metaIn.title || 'Reading',
    intent: req.intent,
    level: req.level,
    newCount: typeof metaIn.newCount === 'number' ? metaIn.newCount : newCount,
    reviewCount: typeof metaIn.reviewCount === 'number' ? metaIn.reviewCount : distinct.size - newCount,
    approxWords:
      typeof metaIn.approxWords === 'number'
        ? metaIn.approxWords
        : sentences.reduce((n, s) => n + (Array.isArray(s.tokens) ? s.tokens.length : 0), 0),
    ...(req.contentType === 'listening_scene' && req.listeningOptions
      ? {
          listeningScene: {
            sceneKind: req.listeningOptions.sceneKind,
            noiseLevel: req.listeningOptions.noiseLevel,
            accent: req.listeningOptions.accent,
            speakers: listeningSpeakers(req),
          },
        }
      : {}),
    ...(storyRef ? { storyRef } : {}),
  };
  const reanchored = reanchorSpans(
    { meta, sentences, targetSpans, collocationSpans, noticeCues },
    req.targetWords,
    expressionSpans,
  );
  // syntaxSpans (B-3) need no re-anchoring — they carry a verbatim anchorText, not a token span. Always
  // attach (possibly empty) on new-pipeline passages so the validator's readability gates run.
  return { ...reanchored, syntaxSpans };
}

interface Loc {
  sentenceIndex: number;
  tokenStart: number;
  tokenEnd: number;
}

/** Canonical render of a token slice — identical to the validator's renderSpan + the app renderer. */
function renderSlice(tokens: string[], start: number, end: number): string {
  return tokenizer.renderText({ tokens: tokens.slice(start, end), translationJa: '' }).trim().toLowerCase();
}

/** First run [start,end) in `tokens` from `from` whose canonical render equals `surface`. */
function findRun(tokens: string[], surface: string, from: number): [number, number] | null {
  const target = surface.trim().toLowerCase();
  if (!target) return null;
  // Whole-sentence anchor (C-4): a sentence_structure cue may quote the ENTIRE sentence. Match it
  // directly so the full [0, tokens.length) span is returned. (Only meaningful from the sentence start.)
  if (from === 0 && tokens.length > 0 && renderSlice(tokens, 0, tokens.length) === target) {
    return [0, tokens.length];
  }
  // No run-length cap (C-4): clause- and sentence-spanning anchors were unlocatable at the old 6-token
  // limit, so their cues were silently dropped. The `rendered.length > target.length` guard still bounds
  // each inner scan — the render grows monotonically with `end`, so once it overshoots the target no
  // longer run can match — keeping the search from diverging on a long anchor.
  for (let start = from; start < tokens.length; start += 1) {
    for (let end = start + 1; end <= tokens.length; end += 1) {
      const rendered = renderSlice(tokens, start, end);
      if (rendered === target) return [start, end];
      if (rendered.length > target.length) break; // run already overshoots the target
    }
  }
  return null;
}

/** Locate `surface` in the passage — preferred sentence first — skipping already-used positions. */
function locate(sentences: PassageOutput['sentences'], surface: string, prefer: number, used: Set<string>): Loc | null {
  const order = [prefer, ...sentences.map((_, i) => i).filter((i) => i !== prefer)];
  for (const si of order) {
    const toks = sentences[si]?.tokens;
    if (!Array.isArray(toks)) continue;
    let from = 0;
    for (;;) {
      const run = findRun(toks, surface, from);
      if (!run) break;
      if (!used.has(`${si}:${run[0]}`)) return { sentenceIndex: si, tokenStart: run[0], tokenEnd: run[1] };
      from = run[0] + 1;
    }
  }
  return null;
}

/** Every run of `surface` in one sentence's tokens (canonical-render match). */
function runsInSentence(sentences: PassageOutput['sentences'], si: number, surface: string): Loc[] {
  const toks = sentences[si]?.tokens;
  if (!Array.isArray(toks)) return [];
  const out: Loc[] = [];
  let from = 0;
  for (;;) {
    const run = findRun(toks, surface, from);
    if (!run) break;
    out.push({ sentenceIndex: si, tokenStart: run[0], tokenEnd: run[1] });
    from = run[0] + 1;
  }
  return out;
}

/**
 * Locate a NoticeCue's `anchorText`, disambiguating repeated occurrences by the model's declared
 * `preferStart`. The model's absolute token count is unreliable, but it still indicates WHICH
 * occurrence it meant, so among equal-text runs in the declared sentence we pick the one whose
 * start is closest to `preferStart` (NOT blindly the first — that would re-introduce the badge ↔
 * explanation drift this whole fix targets). Falls back to the first run in any other sentence.
 */
function locateAnchor(
  sentences: PassageOutput['sentences'],
  anchorText: string,
  preferSentence: number,
  preferStart: number,
): Loc | null {
  const preferred = runsInSentence(sentences, preferSentence, anchorText);
  if (preferred.length > 0) {
    return preferred.reduce((best, r) =>
      Math.abs(r.tokenStart - preferStart) < Math.abs(best.tokenStart - preferStart) ? r : best,
    );
  }
  for (let si = 0; si < sentences.length; si += 1) {
    if (si === preferSentence) continue;
    const runs = runsInSentence(sentences, si, anchorText);
    if (runs.length > 0) return runs[0]!;
  }
  return null;
}

/** An expressionSpan as the model emits it: a verbatim surface + nested span (server re-derives). */
type RawExpressionSpan = {
  span?: { sentenceIndex?: number; tokenStart?: number; tokenEnd?: number };
  surface?: string;
  category?: string;
  meaningJa?: string;
};

const EXPRESSION_CATEGORY_SET = new Set<ExpressionCategory>(['idiom', 'phrasal_verb', 'set_phrase']);

/** A self-reported syntactic construction as the model emits it (B-3): sentenceIndex + a verbatim
 * anchorText snippet (no token span — a construction may be discontinuous, so the client validator
 * checks anchorText verbatim rather than re-deriving a span). */
type RawSyntaxSpan = {
  sentenceIndex?: number;
  pattern?: string;
  anchorText?: string;
  noteJa?: string;
};

const SYNTAX_PATTERN_SET = new Set<SyntaxPattern>([
  'nonrestrictive_relative',
  'participial',
  'inversion',
  'cleft',
  'subjunctive',
  'appositive',
  'other',
]);

/**
 * Carry the model's self-reported syntaxSpans through to the domain shape (B-3). Unlike target /
 * collocation / expression spans, a SyntaxSpan has no token span to re-anchor — it references a
 * sentence + a verbatim anchorText, which the PassageValidator checks in place. Drop entries with an
 * unknown pattern, an out-of-range sentenceIndex, or an empty anchorText; keep an empty array so the
 * validator's readability gates run on new-pipeline passages (mirrors expressionSpans).
 */
function normalizeSyntaxSpans(raw: RawSyntaxSpan[], sentenceCount: number): SyntaxSpan[] {
  const out: SyntaxSpan[] = [];
  for (const s of raw) {
    const pattern = s.pattern as SyntaxPattern | undefined;
    const anchorText = typeof s.anchorText === 'string' ? s.anchorText.trim() : '';
    if (
      typeof s.sentenceIndex !== 'number' ||
      s.sentenceIndex < 0 ||
      s.sentenceIndex >= sentenceCount ||
      !pattern ||
      !SYNTAX_PATTERN_SET.has(pattern) ||
      !anchorText
    ) {
      continue;
    }
    out.push({
      sentenceIndex: s.sentenceIndex,
      pattern,
      anchorText,
      noteJa: typeof s.noteJa === 'string' ? s.noteJa : '',
    });
  }
  return out;
}

/** Strip fullwidth/halfwidth angle-bracket slot markers from a collocation pattern, leaving the head
 * form (e.g. "accept ＜提案・招待＞" → "accept", "＜経済が＞ recover" → "recover"). */
function collocationHeadForm(pattern: string): string {
  return pattern
    .replace(/＜[^＞]*＞/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve a collocationId to the surface text to locate in the passage, per design decision D4's
 * "id ⇄ 旧文字列" fallback: for structured word data whose core.collocations entries carry a stable
 * `id` (C-3's CollocationEntry), return the entry's locatable surface — a legacy verbatim surface
 * field if present, otherwise the `pattern` with its ＜slot＞ markers stripped to the head form (the
 * pattern itself is not verbatim in the passage). For legacy plain-string collocations (and anything
 * unmatched) the collocationId IS the surface, so it is returned unchanged.
 */
function collocationSurfaceFor(collocationId: string, targetWords: GenerationRequest['targetWords']): string {
  for (const t of targetWords) {
    const colls = (t.attributes as { core?: { collocations?: unknown } } | undefined)?.core?.collocations;
    if (!Array.isArray(colls)) continue;
    for (const c of colls) {
      if (c && typeof c === 'object' && (c as { id?: unknown }).id === collocationId) {
        const entry = c as { text?: unknown; surface?: unknown; phrase?: unknown; collocation?: unknown; pattern?: unknown };
        const legacy = entry.text ?? entry.surface ?? entry.phrase ?? entry.collocation;
        if (typeof legacy === 'string' && legacy.trim()) return legacy;
        if (typeof entry.pattern === 'string') {
          const head = collocationHeadForm(entry.pattern);
          if (head) return head;
        }
      }
    }
  }
  return collocationId; // legacy: the id itself is the collocation surface string
}

/**
 * Models reliably miscount the token indices of their own spans (the prose is correct but
 * [tokenStart,tokenEnd) points at the wrong tokens, which the PassageValidator rejects as
 * surface_mismatch). Re-derive each span's indices by locating its declared text in the passage
 * so the client validator + renderer + TTS see correct spans. Target/expression spans relocate by
 * their `surface`; collocation spans by the surface resolved from `collocationId` (D4). Notice cues
 * are NOT produced here — they come from the separate annotation pass (annotatePassage); generation
 * leaves noticeCues empty.
 */
function reanchorSpans(
  passage: PassageOutput,
  targetWords: GenerationRequest['targetWords'],
  rawExpressionSpans: RawExpressionSpan[] = [],
): PassageOutput {
  const usedTarget = new Set<string>();
  const targetSpans = passage.targetSpans
    .map((span) => {
      const loc = locate(passage.sentences, span.surface, span.sentenceIndex, usedTarget);
      if (!loc) return null;
      usedTarget.add(`${loc.sentenceIndex}:${loc.tokenStart}`);
      return { ...span, ...loc };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  // Collocations legitimately overlap target words, so they track their own occupancy.
  const usedColl = new Set<string>();
  const collocationSpans = passage.collocationSpans
    .map((span) => {
      const surface = collocationSurfaceFor(span.collocationId, targetWords);
      const loc = locate(passage.sentences, surface, span.sentenceIndex, usedColl);
      if (!loc) return null;
      usedColl.add(`${loc.sentenceIndex}:${loc.tokenStart}`);
      return { ...span, ...loc };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  // Expression spans (idioms / phrasal verbs / set phrases, B-1/B-2) relocate by their verbatim
  // `surface`; drop ones with an unknown category or an unlocatable surface.
  const usedExpr = new Set<string>();
  const expressionSpans = rawExpressionSpans
    .map((raw) => {
      const surface = typeof raw.surface === 'string' ? raw.surface : '';
      const category = raw.category as ExpressionCategory | undefined;
      if (!surface || !category || !EXPRESSION_CATEGORY_SET.has(category)) return null;
      const prefer = typeof raw.span?.sentenceIndex === 'number' ? raw.span.sentenceIndex : 0;
      const loc = locate(passage.sentences, surface, prefer, usedExpr);
      if (!loc) return null;
      usedExpr.add(`${loc.sentenceIndex}:${loc.tokenStart}`);
      return { span: loc, surface, category, meaningJa: typeof raw.meaningJa === 'string' ? raw.meaningJa : '' };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  // Notices are produced by the separate annotation pass (annotatePassage), not by generation.
  return { ...passage, targetSpans, collocationSpans, noticeCues: [], expressionSpans };
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
    maxTokensForWordTarget(req.wordTarget),
    PASSAGE_JSON_SCHEMA,
    'passage_output',
    { temperature: 0.8, task: 'passage' },
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
    meta: {
      title: '',
      intent: req.intent,
      level: req.level,
      newCount: 0,
      reviewCount: 0,
      approxWords: 0,
      ...(req.contentType === 'listening_scene' && req.listeningOptions
        ? {
            listeningScene: {
              sceneKind: req.listeningOptions.sceneKind,
              noiseLevel: req.listeningOptions.noiseLevel,
              accent: req.listeningOptions.accent,
              speakers: listeningSpeakers(req),
            },
          }
        : {}),
      ...(req.storyContext
        ? { storyRef: { storyId: req.storyContext.storyId, chapterIndex: req.storyContext.chapterIndex } }
        : {}),
    },
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
  // Larger budget than before: the rich `more` attributes need more output tokens.
  const { text } = await callModel(env, fetchImpl, system, user, 1800, WORD_DATA_JSON_SCHEMA, 'word_data', {
    temperature: 0.4,
    task: 'wordpack',
  });
  const parsed = parseJson<Partial<WordData>>(text, 'word data');
  if (!parsed.headword || !parsed.core) {
    throw new ProviderError(502, 'Generation API returned incomplete word data.');
  }
  return normalizeWordData(parsed, wordId);
}

const MEMORY_TIP_KINDS = new Set(['image', 'etymology', 'collocation', 'contrast', 'sound', 'mistake']);

function normalizeMemoryTips(value: unknown): WordData['memoryTips'] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tips = value
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const item = raw as { kind?: unknown; tipJa?: unknown };
      const kind = typeof item.kind === 'string' ? item.kind : '';
      const tipJa = typeof item.tipJa === 'string' ? item.tipJa.trim() : '';
      if (!MEMORY_TIP_KINDS.has(kind) || !tipJa) return null;
      return { kind: kind as NonNullable<WordData['memoryTips']>[number]['kind'], tipJa };
    })
    .filter((tip): tip is NonNullable<WordData['memoryTips']>[number] => tip !== null);
  return tips.length > 0 ? tips : undefined;
}

/**
 * Structure the rich attributes (C-1/2/3) and drop null/empty `more` fields so stored WordData
 * matches the optional domain shape and the validator's grounding rule (empty ⇒ absent) stays
 * consistent with what the UI renders. `structureCollocations`/`structureMore` accept both the new
 * structured shape and the legacy shape, so a model that still emits bare strings is lifted rather
 * than rejected (the same lift the client applies to legacy cache rows).
 */
function normalizeWordData(parsed: Partial<WordData>, wordId: string): WordData {
  const data = { ...parsed, wordId } as WordData;
  const memoryTips = normalizeMemoryTips((parsed as { memoryTips?: unknown }).memoryTips);
  if (memoryTips) data.memoryTips = memoryTips;
  else delete (data as { memoryTips?: unknown }).memoryTips;
  if (data.core) {
    data.core = { ...data.core, collocations: structureCollocations((data.core as { collocations?: unknown }).collocations) };
  }
  const more = structureMore((parsed as { more?: unknown }).more);
  if (more) data.more = more;
  else delete (data as { more?: unknown }).more;
  return data;
}

/** Propose base-form lemmas to teach for a level + theme (used when no targets are picked). */
export async function suggestWords(
  env: Env,
  req: WordSuggestionRequest,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<string[]> {
  const count = Math.max(1, Math.min(req.count || 6, 12));
  const { system, user } = buildSuggestionMessages({ ...req, count });
  const { text } = await callModel(env, fetchImpl, system, user, 400, WORD_SUGGESTION_JSON_SCHEMA, 'word_suggestion');
  const parsed = parseJson<{ words?: unknown }>(text, 'word suggestions');
  const raw = Array.isArray(parsed.words) ? parsed.words : [];
  const exclude = new Set((req.exclude ?? []).map((w) => w.toLowerCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of raw) {
    if (typeof w !== 'string') continue;
    const lemma = w.trim().toLowerCase();
    // Keep single base-form lemmas only; drop blanks, multiword phrases, dups, and excluded.
    if (!lemma || /\s/.test(lemma) || seen.has(lemma) || exclude.has(lemma)) continue;
    seen.add(lemma);
    out.push(lemma);
    if (out.length >= count) break;
  }
  return out;
}

/**
 * Generate ONE fresh review-context sentence for a word (C-5c). Lightweight, low-token task; the
 * client uses it as the third material tier and treats any failure (or an empty/off-topic reply) as
 * a fall-through to the bare-headword card.
 */
export async function reviewSentence(
  env: Env,
  req: ReviewSentenceRequest,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<string> {
  const { system, user } = buildReviewSentenceMessages({
    headword: req.headword,
    level: req.level,
    meaningJa: req.meaningJa,
    collocations: req.collocations,
  });
  const { text } = await callModel(
    env,
    fetchImpl,
    system,
    user,
    REVIEW_SENTENCE_MAX_TOKENS,
    REVIEW_SENTENCE_JSON_SCHEMA,
    'review_sentence',
    { temperature: 0.7, task: 'passage' },
  );
  const parsed = parseJson<{ sentence?: unknown }>(text, 'review sentence');
  return typeof parsed.sentence === 'string' ? parsed.sentence.trim() : '';
}

/** Monotonic-ish story id (server-side; the client persists it under this key). */
let storyCounter = 0;
function nextStoryId(): string {
  storyCounter += 1;
  return `story_${Date.now()}_${storyCounter}`;
}

/** Generate a story plan (characters/synopsis/chapters) — Requirement 6.2. */
export async function planStory(
  env: Env,
  req: StoryPlanRequest,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<StoryPlan> {
  const contentType = req.contentType === 'long_story' ? 'long_story' : 'short_story';
  const { system, user } = buildStoryPlanMessages({
    contentType,
    genre: req.genre,
    homageTitle: req.homageTitle,
    intent: req.intent,
    level: req.level,
  });
  const { text, stopReason } = await callModel(
    env,
    fetchImpl,
    system,
    user,
    storyPlanMaxTokens(),
    STORY_PLAN_JSON_SCHEMA,
    'story_plan',
    { temperature: 0.7, task: 'story' },
  );
  if (stopReason === 'refusal') throw new ProviderError(502, 'Story plan generation was refused.');
  const parsed = parseJson<Partial<StoryPlan>>(text, 'story plan');
  const chaptersRaw = Array.isArray(parsed.chapters) ? parsed.chapters : [];
  // A short story is a single chapter regardless of what the model returned.
  const chapters = (contentType === 'short_story' ? chaptersRaw.slice(0, 1) : chaptersRaw).map((c, i) => ({
    index: i,
    headingJa: typeof c?.headingJa === 'string' ? c.headingJa : '',
    beatJa: typeof c?.beatJa === 'string' ? c.beatJa : '',
  }));
  if (chapters.length === 0) throw new ProviderError(502, 'Story plan has no chapters.');
  return {
    storyId: nextStoryId(),
    contentType,
    genre: req.genre,
    ...(req.homageTitle ? { homage: { title: req.homageTitle, styleNoteJa: '' } } : {}),
    titleJa: typeof parsed.titleJa === 'string' ? parsed.titleJa : '',
    synopsisJa: typeof parsed.synopsisJa === 'string' ? parsed.synopsisJa : '',
    characters: Array.isArray(parsed.characters)
      ? parsed.characters
          .filter((c): c is NonNullable<typeof c> => !!c && typeof c === 'object')
          .map((c) => ({
            name: typeof c.name === 'string' ? c.name : '',
            role: typeof c.role === 'string' ? c.role : '',
            descriptionJa: typeof c.descriptionJa === 'string' ? c.descriptionJa : '',
          }))
      : [],
    chapters,
  };
}

/** Extend a long-story plan with future chapter beats when the existing outline is exhausted. */
export async function extendStoryPlan(
  env: Env,
  req: StoryPlanExtensionRequest,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<StoryPlan> {
  if (req.plan.contentType !== 'long_story') {
    throw new ProviderError(400, 'Only long_story plans can be extended.');
  }
  const additionalChapters = Math.max(1, Math.min(req.additionalChapters ?? 3, 6));
  const { system, user } = buildStoryPlanExtensionMessages({ ...req, additionalChapters });
  const { text, stopReason } = await callModel(
    env,
    fetchImpl,
    system,
    user,
    storyPlanExtensionMaxTokens(additionalChapters),
    STORY_PLAN_EXTENSION_JSON_SCHEMA,
    'story_plan_extension',
    { temperature: 0.7, task: 'story' },
  );
  if (stopReason === 'refusal') throw new ProviderError(502, 'Story plan extension was refused.');
  const parsed = parseJson<{ synopsisJa?: unknown; chapters?: unknown }>(text, 'story plan extension');
  const rawChapters = Array.isArray(parsed.chapters) ? parsed.chapters : [];
  const newChapters = rawChapters.slice(0, additionalChapters).map((c, i) => {
    const raw = c && typeof c === 'object' ? (c as Partial<StoryPlan['chapters'][number]>) : {};
    return {
      index: req.nextChapterIndex + i,
      headingJa: typeof raw.headingJa === 'string' ? raw.headingJa : `第${req.nextChapterIndex + i + 1}章`,
      beatJa: typeof raw.beatJa === 'string' ? raw.beatJa : 'これまでの出来事を受けて物語が進む。',
    };
  });
  if (newChapters.length === 0) throw new ProviderError(502, 'Story plan extension has no chapters.');
  const oldChapters = req.plan.chapters.filter((chapter) => chapter.index < req.nextChapterIndex);
  return {
    ...req.plan,
    synopsisJa: typeof parsed.synopsisJa === 'string' && parsed.synopsisJa.trim() ? parsed.synopsisJa : req.plan.synopsisJa,
    chapters: [...oldChapters, ...newChapters],
  };
}

// ── Image illustration (Requirement 6.8 + passage scene enrichment) ──────────
//
// Image generation is a SEPARATE provider axis from text: Anthropic has no image API, so the image
// provider is resolved independently of LLM_PROVIDER. Providers are declared ONCE in a descriptor
// table (endpoint / key env / default model / capability flags / MIME / wire family) so adding a
// fourth provider is one record — not five scattered if/else arms (design decision D8: the same
// "descriptor table + per-task env" shape the text path uses for TASK_MODEL_ENV).
//
// Two USE PROFILES sit on top of the provider axis: `fast` (character art rendered while the learner
// waits at the story confirmation gate — speed matters) and `quality` (article scene art / one-off
// assets read slowly — crispness matters). Each profile picks its own provider + model + OpenAI
// `quality` hint via env (IMAGE_PROVIDER_FAST/_QUALITY, IMAGE_MODEL_FAST/_QUALITY), each falling
// back to the legacy single IMAGE_PROVIDER / IMAGE_MODEL, then the descriptor default. Images come
// back as base64 and are returned as `data:` URLs the client stores inline (there is no CDN).
// Failures raise ProviderError like the text path so the caller can degrade to no illustration.

/** Speed-vs-quality use profile. `fast` = character art during the confirmation gate; `quality` = article scene art. */
export type ImageProfile = 'fast' | 'quality';

type ImageProvider = 'openai' | 'grok' | 'gemini';

/** Declarative description of one image provider so the fetch/parse logic stays provider-agnostic. */
interface ImageProviderSpec {
  /** Wire-shape family: `openai` = OpenAI-compatible `/images/generations`; `gemini` = Imagen `:predict`. */
  family: 'openai' | 'gemini';
  /** Endpoint the request is POSTed to (Gemini appends `/{model}:predict`). */
  baseUrl: string;
  /** Env var(s) holding the API key, tried in order (first non-empty, non-placeholder wins). */
  keyEnvNames: readonly string[];
  /** Default model when no IMAGE_MODEL* override is set. */
  defaultModel: string;
  /** Whether the provider accepts an OpenAI `size` field. */
  supportsSize: boolean;
  /** Whether the provider accepts an OpenAI `quality` field. */
  supportsQuality: boolean;
  /** MIME of the returned base64 payload, used to build the `data:` URL (Grok returns JPEG, not PNG). */
  mime: string;
}

const IMAGE_PROVIDER_SPECS: Record<ImageProvider, ImageProviderSpec> = {
  openai: {
    family: 'openai',
    baseUrl: 'https://api.openai.com/v1/images/generations',
    keyEnvNames: ['OPENAI_API_KEY'],
    defaultModel: 'gpt-image-1',
    supportsSize: true,
    supportsQuality: true,
    mime: 'image/png',
  },
  grok: {
    // xAI Grok images: OpenAI-compatible endpoint, but no size/quality params and returns JPEG.
    family: 'openai',
    baseUrl: 'https://api.x.ai/v1/images/generations',
    keyEnvNames: ['XAI_API_KEY', 'GROK_API_KEY'],
    defaultModel: 'grok-2-image',
    supportsSize: false,
    supportsQuality: false,
    mime: 'image/jpeg',
  },
  gemini: {
    family: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    keyEnvNames: ['GEMINI_API_KEY'],
    defaultModel: 'imagen-3.0-generate-002',
    supportsSize: false,
    supportsQuality: false,
    mime: 'image/png',
  },
};

/** Map a raw IMAGE_PROVIDER value (or alias) to a known provider, or `undefined` if unrecognized. */
function imageProviderAlias(raw: string): ImageProvider | undefined {
  const v = raw.trim().toLowerCase();
  if (v === '' || v === 'openai') return 'openai';
  if (v === 'grok' || v === 'xai') return 'grok';
  if (v === 'gemini' || v === 'google' || v === 'imagen') return 'gemini';
  return undefined;
}

/**
 * Resolve the provider for a use profile: IMAGE_PROVIDER_FAST/_QUALITY, else the legacy IMAGE_PROVIDER,
 * else openai. An unrecognized value is NOT silently coerced to openai — it throws 503 so a `.env`
 * typo (e.g. `IMAGE_PROVIDER=grk`) surfaces immediately instead of quietly using the wrong provider.
 */
function resolveImageProvider(env: Env, profile: ImageProfile): ImageProvider {
  const profileVar = profile === 'fast' ? env.IMAGE_PROVIDER_FAST : env.IMAGE_PROVIDER_QUALITY;
  const raw = (profileVar ?? env.IMAGE_PROVIDER ?? 'openai').trim();
  const resolved = imageProviderAlias(raw);
  if (!resolved) {
    throw new ProviderError(
      503,
      `Unknown IMAGE_PROVIDER: "${raw}". Use one of: openai, grok, gemini.`,
      'not_configured',
    );
  }
  return resolved;
}

/** The configured key for the active image provider, or throw 503 so the UI shows "unavailable". */
export function requireImageKey(env: Env, provider: ImageProvider): string {
  const spec = IMAGE_PROVIDER_SPECS[provider];
  for (const name of spec.keyEnvNames) {
    const key = env[name];
    if (key && key.trim() && !key.includes('...')) return key.trim();
  }
  throw new ProviderError(
    503,
    `Image API not configured: ${spec.keyEnvNames.join(' or ')} is missing. Set it in .env.`,
    'not_configured',
  );
}

/** Model for a use profile: IMAGE_MODEL_FAST/_QUALITY, else legacy IMAGE_MODEL, else the descriptor default. */
function imageModelFor(env: Env, provider: ImageProvider, profile: ImageProfile): string {
  const profileModel = (profile === 'fast' ? env.IMAGE_MODEL_FAST : env.IMAGE_MODEL_QUALITY)?.trim();
  if (profileModel) return profileModel;
  const legacy = env.IMAGE_MODEL?.trim();
  if (legacy) return legacy;
  return IMAGE_PROVIDER_SPECS[provider].defaultModel;
}

/** Startup diagnostic for one use profile: what the `.env` resolves to, so a typo/missing key is visible. */
export interface ImageConfigDiagnostic {
  profile: ImageProfile;
  /** Resolved provider, or `'unknown'` when the configured value is a typo (surfaces as a startup warning + 503). */
  provider: ImageProvider | 'unknown';
  /** The raw configured provider value (for typo diagnostics); never a secret. */
  rawProvider: string;
  /** Env var reported for the key (`''` when the provider is unknown). */
  keyEnvName: string;
  /** Length of the present key (0 when absent) — never the value. */
  keyLength: number;
  /** Resolved model (`''` when the provider is unknown). */
  model: string;
  status: 'ok' | 'missing_key' | 'placeholder_key' | 'unknown_provider';
}

/**
 * Resolve the fast + quality image profiles from env WITHOUT throwing, so the dev/preview startup
 * banner can surface a typo'd IMAGE_PROVIDER or a missing key up-front (the request path still throws
 * 503). Reads the same descriptor table as the request path, so the two never drift.
 */
export function describeImageConfig(env: Env): ImageConfigDiagnostic[] {
  return (['fast', 'quality'] as const).map((profile): ImageConfigDiagnostic => {
    const profileVar = profile === 'fast' ? env.IMAGE_PROVIDER_FAST : env.IMAGE_PROVIDER_QUALITY;
    const rawProvider = (profileVar ?? env.IMAGE_PROVIDER ?? 'openai').trim();
    const provider = imageProviderAlias(rawProvider);
    if (!provider) {
      return { profile, provider: 'unknown', rawProvider, keyEnvName: '', keyLength: 0, model: '', status: 'unknown_provider' };
    }
    const spec = IMAGE_PROVIDER_SPECS[provider];
    let keyEnvName = spec.keyEnvNames[0]!;
    let keyLength = 0;
    let status: ImageConfigDiagnostic['status'] = 'missing_key';
    // Mirror requireImageKey's selection: prefer the first non-empty, NON-placeholder key so the
    // banner reports whatever the request path would actually use. A placeholder key is only a
    // fallback — requireImageKey skips it (`!key.includes('...')`) and falls through to the next
    // env name, so reporting it as the active key here would falsely flag a working provider.
    let placeholder: { name: string; length: number } | undefined;
    for (const name of spec.keyEnvNames) {
      const key = env[name];
      if (!key || !key.trim()) continue;
      if (key.includes('...')) {
        if (!placeholder) placeholder = { name, length: key.length };
        continue;
      }
      keyEnvName = name;
      keyLength = key.length;
      status = 'ok';
      break;
    }
    if (status !== 'ok' && placeholder) {
      // Every candidate key was empty or a placeholder — the request path would 503, so surface the
      // placeholder that the operator most likely intended to replace.
      keyEnvName = placeholder.name;
      keyLength = placeholder.length;
      status = 'placeholder_key';
    }
    return { profile, provider, rawProvider, keyEnvName, keyLength, model: imageModelFor(env, provider, profile), status };
  });
}

/**
 * Pick the use profile for a request: an explicit body `imagePreference` ('fast'/'quality') wins;
 * otherwise the endpoint's use-based default (character art = fast, scene art = quality). Kept as one
 * function so the two illustrate endpoints share the exact same precedence instead of duplicating it.
 */
export function resolveImageProfile(
  body: { imagePreference?: ImageProfile } | null | undefined,
  endpointDefault: ImageProfile,
): ImageProfile {
  const pref = body?.imagePreference;
  return pref === 'fast' || pref === 'quality' ? pref : endpointDefault;
}

/** Target geometry per illustration kind: OpenAI `size`, Gemini `aspectRatio`, and a prompt suffix for size-less providers. */
interface ImageGeometry {
  openAiSize: string;
  geminiAspectRatio: string;
  /** Appended to the prompt for OpenAI-compatible providers that ignore `size` (Grok) to steer aspect via wording. */
  aspectPromptSuffix: string;
}

const FULL_BODY_ASPECT_SUFFIX =
  'Compose the image as a vertical 3:4 portrait-orientation full-body illustration with the character fully in frame.';
const PORTRAIT_ASPECT_SUFFIX = 'Compose the image as a square 1:1 head-and-shoulders portrait, centered.';
const SCENE_ASPECT_SUFFIX = 'Compose the image in a wide 16:9 landscape format, like a book illustration spread.';

async function generateImageDataUrl(
  env: Env,
  prompt: string,
  fetchImpl: typeof fetch,
  profile: ImageProfile,
  geometry: ImageGeometry,
): Promise<string> {
  const provider = resolveImageProvider(env, profile);
  const spec = IMAGE_PROVIDER_SPECS[provider];
  const apiKey = requireImageKey(env, provider);
  const model = imageModelFor(env, provider, profile);
  // Size-less OpenAI-compatible providers (Grok) can't take a `size` param, so steer aspect in words.
  const appendAspect = spec.family === 'openai' && !spec.supportsSize;
  const finalPrompt = appendAspect ? `${prompt}\n\n${geometry.aspectPromptSuffix}` : prompt;

  let response: Response;
  try {
    if (spec.family === 'gemini') {
      response = await fetchImpl(
        `${spec.baseUrl}/${model}:predict?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt }],
            parameters: { sampleCount: 1, aspectRatio: geometry.geminiAspectRatio },
          }),
        },
      );
    } else {
      // OpenAI-compatible providers (openai, grok). Only send fields the provider supports.
      const requestBody: Record<string, unknown> = { model, prompt: finalPrompt, n: 1 };
      if (spec.supportsSize) requestBody.size = geometry.openAiSize;
      if (spec.supportsQuality) requestBody.quality = profile === 'quality' ? 'high' : 'low';
      response = await fetchImpl(spec.baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(requestBody),
      });
    }
  } catch (cause) {
    throw new ProviderError(
      503,
      `Image API unreachable: ${cause instanceof Error ? cause.message : 'network error'}`,
      'upstream_error',
    );
  }

  if (!response.ok) {
    const detail = await safeText(response);
    const mapped = mapUpstream(response.status);
    throw new ProviderError(mapped.status, `${provider} image API error ${response.status}: ${detail}`, mapped.code);
  }

  const responseBody = (await response.json()) as unknown;
  const b64 = spec.family === 'gemini' ? parseGeminiImage(responseBody) : parseOpenAiImage(responseBody);
  if (!b64) throw new ProviderError(502, `${provider} image API returned no image.`);
  return `data:${spec.mime};base64,${b64}`;
}

/**
 * Generate one character illustration, returning a `data:<mime>;base64,...` URL (Requirement 6.8).
 * Defaults to the `fast` profile — character art is rendered while the learner waits at the story
 * confirmation gate, so speed beats crispness. OpenAI/Grok hit an OpenAI-compatible Images endpoint
 * (`b64_json`); Gemini/Imagen hits the model `:predict` endpoint (`predictions[].bytesBase64Encoded`,
 * key as query param per the REST contract).
 */
export async function illustrateCharacter(
  env: Env,
  req: CharacterIllustrationRequest,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  profile: ImageProfile = 'fast',
): Promise<string> {
  const prompt = buildCharacterIllustrationPrompt(req);
  const variant = req.variant ?? 'full_body';
  const geometry: ImageGeometry =
    variant === 'portrait'
      ? { openAiSize: '1024x1024', geminiAspectRatio: '1:1', aspectPromptSuffix: PORTRAIT_ASPECT_SUFFIX }
      : { openAiSize: '1024x1536', geminiAspectRatio: '3:4', aspectPromptSuffix: FULL_BODY_ASPECT_SUFFIX };
  return generateImageDataUrl(env, prompt, fetchImpl, profile, geometry);
}

/**
 * Generate one passage-level scene illustration as a `data:<mime>;base64,...` URL. Defaults to the
 * `quality` profile — article scene art is read slowly, so crispness is worth the extra latency.
 */
export async function illustratePassage(
  env: Env,
  req: PassageIllustrationRequest,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  profile: ImageProfile = 'quality',
): Promise<string> {
  const prompt = buildPassageIllustrationPrompt(req);
  const geometry: ImageGeometry = {
    openAiSize: '1536x1024',
    geminiAspectRatio: '16:9',
    aspectPromptSuffix: SCENE_ASPECT_SUFFIX,
  };
  return generateImageDataUrl(env, prompt, fetchImpl, profile, geometry);
}

function parseOpenAiImage(body: unknown): string | undefined {
  const b64 = (body as { data?: { b64_json?: string }[] }).data?.[0]?.b64_json;
  return typeof b64 === 'string' && b64 ? b64 : undefined;
}

function parseGeminiImage(body: unknown): string | undefined {
  const b64 = (body as { predictions?: { bytesBase64Encoded?: string }[] }).predictions?.[0]?.bytesBase64Encoded;
  return typeof b64 === 'string' && b64 ? b64 : undefined;
}

type RawCue = {
  span?: { sentenceIndex?: number; tokenStart?: number; tokenEnd?: number };
  category?: NoticeCue['category'];
  anchorText?: string;
  explanationJa?: string;
  detailJa?: string | null;
  anchorTextParts?: string[] | null;
};

const ANNOTATION_CATEGORY_SET = new Set<string>(ANNOTATION_CATEGORIES);

/**
 * Locate the extra contiguous parts of a DISCONTINUOUS expression (C-4) within the anchor's sentence,
 * after the main part, in reading order. `parts` is the model's `anchorTextParts` (which includes the
 * first part); the part(s) equal to `anchorText` are skipped since the main `span` already covers them.
 */
function resolveExtraSpans(
  sentences: PassageOutput['sentences'],
  main: Loc,
  anchorText: string,
  parts: string[],
): SpanRef[] {
  const toks = sentences[main.sentenceIndex]?.tokens;
  if (!Array.isArray(toks)) return [];
  const target = anchorText.trim().toLowerCase();
  const extras: SpanRef[] = [];
  let from = main.tokenEnd; // subsequent parts follow the main part in the same sentence
  for (const rawPart of parts) {
    const part = typeof rawPart === 'string' ? rawPart.trim() : '';
    if (!part || part.toLowerCase() === target) continue; // skip the main part
    const run = findRun(toks, part, from);
    if (!run) continue;
    extras.push({ sentenceIndex: main.sentenceIndex, tokenStart: run[0], tokenEnd: run[1] });
    from = run[1];
  }
  return extras;
}

/**
 * Turn the annotation model's raw cues into grounded NoticeCues: re-derive each span from its
 * verbatim `anchorText` (the model quotes the text correctly but miscounts indices), drop cues whose
 * anchor cannot be located or whose category is unknown, and number survivors in READING ORDER —
 * matching PassageRenderer, which flushes a badge when the cursor passes the cue's tokenEnd.
 */
function anchorCues(sentences: PassageOutput['sentences'], raw: RawCue[]): NoticeCue[] {
  return raw
    .map((cue): NoticeCue | null => {
      const anchorText = typeof cue.anchorText === 'string' ? cue.anchorText.trim() : '';
      const category = cue.category;
      if (!anchorText || !category || !ANNOTATION_CATEGORY_SET.has(category)) return null;
      const loc = locateAnchor(sentences, anchorText, cue.span?.sentenceIndex ?? 0, cue.span?.tokenStart ?? 0);
      if (!loc) return null;
      const detailJa = typeof cue.detailJa === 'string' && cue.detailJa.trim() ? cue.detailJa.trim() : undefined;
      const extraSpans = Array.isArray(cue.anchorTextParts)
        ? resolveExtraSpans(sentences, loc, anchorText, cue.anchorTextParts)
        : [];
      return {
        index: 0,
        span: loc,
        category,
        anchorText,
        explanationJa: typeof cue.explanationJa === 'string' ? cue.explanationJa : '',
        ...(detailJa ? { detailJa } : {}),
        ...(extraSpans.length > 0 ? { extraSpans } : {}),
      };
    })
    .filter((c): c is NoticeCue => c !== null)
    .sort(
      (a, b) =>
        a.span.sentenceIndex - b.span.sentenceIndex ||
        a.span.tokenEnd - b.span.tokenEnd ||
        a.span.tokenStart - b.span.tokenStart,
    )
    .map((cue, i) => ({ ...cue, index: i + 1 }));
}

/**
 * Sentences per annotation request (F-6 本命). Passages longer than this are annotated in parallel
 * contiguous slices so a long passage's later sentences still get「気づき」cues — the old single
 * request flat-lined near 24 sentences and truncated the whole reply to an empty array. Each chunk
 * carries absolute sentence indices plus its share of REQUIRED COVERAGE.
 */
const ANNOTATION_CHUNK_SENTENCES = 20;

/** How many annotation chunks are in flight at once. A very long passage is annotated in waves so we
 * never fan out an unbounded number of simultaneous upstream calls. */
const ANNOTATION_CHUNK_CONCURRENCY = 4;

/**
 * Split an annotation request into contiguous ≤`chunkSize`-sentence slices (F-6). A passage at or
 * under the limit stays a single whole-passage request (no chunk framing, so short passages behave
 * exactly as before). Longer passages become slices that keep ABSOLUTE `sentenceIndex` values on
 * their spans and set `sentenceIndexBase`, so `buildAnnotationMessages` numbers sentences absolutely,
 * distributes each coverage item to the slice that contains it, and the model copies absolute indices.
 */
export function planAnnotationChunks(req: PassageAnnotationRequest, chunkSize: number): PassageAnnotationRequest[] {
  const total = req.sentences.length;
  if (total <= chunkSize) return [req];
  const chunks: PassageAnnotationRequest[] = [];
  for (let start = 0; start < total; start += chunkSize) {
    const end = Math.min(start + chunkSize, total);
    chunks.push({
      level: req.level,
      // C-4: carry the readability band + writer-flagged hard sentences into each slice so every slice
      // emits its share of sentenceNotes (buildAnnotationMessages filters the hard list to the slice).
      readabilityLevel: req.readabilityLevel,
      hardSentenceIndexes: req.hardSentenceIndexes,
      sentences: req.sentences.slice(start, end),
      sentenceIndexBase: start,
      targetSpans: (req.targetSpans ?? []).filter((s) => s.sentenceIndex >= start && s.sentenceIndex < end),
      collocationSpans: (req.collocationSpans ?? []).filter((s) => s.sentenceIndex >= start && s.sentenceIndex < end),
      expressionSpans: (req.expressionSpans ?? []).filter((s) => s.span.sentenceIndex >= start && s.span.sentenceIndex < end),
    });
  }
  return chunks;
}

/**
 * Recover the complete objects of a named top-level array from a truncated (max_tokens) reply (F-6
 * partial recovery). The model streamed a valid PREFIX of `"<key>":[ {…}, {…}, {…<cut off>` — scan the
 * array, keeping every object that closed cleanly and discarding the final partial one. Returns [] if
 * the array can't be located. String contents (which may contain braces) are skipped correctly.
 */
function salvageObjectArray<T>(text: string, keyName: string): T[] {
  const key = text.indexOf(`"${keyName}"`);
  if (key < 0) return [];
  const arrStart = text.indexOf('[', key);
  if (arrStart < 0) return [];
  const out: T[] = [];
  let depth = 0; // object-brace depth; 0 = between top-level objects
  let objStart = -1;
  let inString = false;
  let escaped = false;
  for (let i = arrStart + 1; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      if (depth === 0) objStart = i;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && objStart >= 0) {
        try {
          out.push(JSON.parse(text.slice(objStart, i + 1)) as T);
        } catch {
          // Skip an object we somehow can't parse; keep the ones we already recovered.
        }
        objStart = -1;
      }
    } else if (ch === ']' && depth === 0) {
      break; // array closed cleanly — nothing was truncated
    }
  }
  return out;
}

/** Salvage the closed noticeCue objects from a truncated annotation reply (F-6 partial recovery). */
export function salvageCues(text: string): RawCue[] {
  return salvageObjectArray<RawCue>(text, 'noticeCues');
}

/** A sentenceNote as the model emits it (C-4); server clamps token ranges + drops out-of-range notes. */
type RawSentenceNote = {
  sentenceIndex?: number;
  patternNameJa?: string;
  structureJa?: string;
  readingJa?: string;
  chunks?: { tokenStart?: number; tokenEnd?: number; roleJa?: string }[];
};

/**
 * Ground the model's raw sentenceNotes (C-4) against the FULL passage: keep only notes whose
 * `sentenceIndex` exists and that carry a pattern label, clamp each chunk's half-open token range to
 * the sentence's own token count (dropping empty/inverted ranges), and de-duplicate by sentence
 * (first note per sentence wins). Notes carry absolute sentence indices, so no re-anchoring is needed.
 */
function normalizeSentenceNotes(raw: RawSentenceNote[], sentences: PassageOutput['sentences']): SentenceSyntaxNote[] {
  const seen = new Set<number>();
  const out: SentenceSyntaxNote[] = [];
  for (const note of raw) {
    const sentenceIndex = note?.sentenceIndex;
    if (typeof sentenceIndex !== 'number' || !Number.isInteger(sentenceIndex)) continue;
    const sentence = sentences[sentenceIndex];
    if (!sentence || seen.has(sentenceIndex)) continue;
    const patternNameJa = typeof note.patternNameJa === 'string' ? note.patternNameJa.trim() : '';
    if (!patternNameJa) continue;
    const tokenCount = sentence.tokens.length;
    const chunks: SentenceSyntaxNote['chunks'] = [];
    for (const c of Array.isArray(note.chunks) ? note.chunks : []) {
      const start = typeof c?.tokenStart === 'number' ? Math.max(0, Math.trunc(c.tokenStart)) : NaN;
      const end = typeof c?.tokenEnd === 'number' ? Math.min(tokenCount, Math.trunc(c.tokenEnd)) : NaN;
      const roleJa = typeof c?.roleJa === 'string' ? c.roleJa.trim() : '';
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || !roleJa) continue;
      chunks.push({ tokenStart: start, tokenEnd: end, roleJa });
    }
    seen.add(sentenceIndex);
    out.push({
      sentenceIndex,
      patternNameJa,
      structureJa: typeof note.structureJa === 'string' ? note.structureJa.trim() : '',
      readingJa: typeof note.readingJa === 'string' ? note.readingJa.trim() : '',
      chunks,
    });
  }
  return out.sort((a, b) => a.sentenceIndex - b.sentenceIndex);
}

/** Combine per-chunk statuses (F-6): all complete ⇒ complete, all failed ⇒ failed, otherwise partial
 * (some slices contributed cues, some didn't — the reader still gets the survivors). */
function mergeAnnotationStatus(statuses: AnnotationStatus[]): AnnotationStatus {
  if (statuses.every((s) => s === 'complete')) return 'complete';
  if (statuses.every((s) => s === 'failed')) return 'failed';
  return 'partial';
}

/** Run `fn` over `items` with at most `limit` in flight, preserving input order in the results. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Annotate one slice (or the whole passage). Returns raw cues (indices are re-anchored by the caller
 * against the FULL passage) plus the slice's outcome status. */
async function annotateChunk(
  env: Env,
  fetchImpl: typeof fetch,
  chunk: PassageAnnotationRequest,
): Promise<{ raw: RawCue[]; notes: RawSentenceNote[]; status: AnnotationStatus }> {
  const { system, user } = buildAnnotationMessages(chunk);
  const { text, stopReason } = await callModel(
    env,
    fetchImpl,
    system,
    user,
    annotationMaxTokens(chunk.sentences.length),
    ANNOTATION_JSON_SCHEMA,
    'passage_annotation',
    { temperature: 0.3, task: 'annotation' },
  );
  const base = chunk.sentenceIndexBase ?? 0;
  if (stopReason === 'refusal') {
    console.warn(`[annotate] refusal (base=${base}, ${chunk.sentences.length} sentences)`);
    return { raw: [], notes: [], status: 'failed' };
  }
  if (stopReason === 'max_tokens') {
    // Partial recovery: salvage the cues (and any complete sentenceNotes) that streamed before the cut.
    const salvaged = salvageCues(text);
    const notes = salvageObjectArray<RawSentenceNote>(text, 'sentenceNotes');
    console.warn(`[annotate] truncated (base=${base}): salvaged ${salvaged.length} cue(s), ${notes.length} note(s)`);
    return { raw: salvaged, notes, status: salvaged.length > 0 ? 'partial' : 'failed' };
  }
  const parsed = parseJson<{ noticeCues?: unknown; sentenceNotes?: unknown }>(text, 'annotation');
  const raw = Array.isArray(parsed.noticeCues) ? (parsed.noticeCues as RawCue[]) : [];
  const notes = Array.isArray(parsed.sentenceNotes) ? (parsed.sentenceNotes as RawSentenceNote[]) : [];
  return { raw, notes, status: 'complete' };
}

/**
 * Second LLM pass: exhaustively annotate a finished passage with in-text notice cues (F-6 本命).
 * Long passages are split into ≤20-sentence slices annotated in parallel and merged, so late
 * sentences still get cues and a single slice's truncation no longer wipes the whole passage. Each
 * slice's cues are re-anchored against the FULL passage (their spans carry absolute indices) and the
 * survivors are renumbered in global reading order. `status` is `partial` when some slices dropped
 * out (or a slice was salvaged from a truncated reply) so the reader can offer a regenerate.
 */
export async function annotatePassage(
  env: Env,
  req: PassageAnnotationRequest,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<AnnotationResult> {
  if (!Array.isArray(req.sentences) || req.sentences.length === 0) {
    return { noticeCues: [], status: 'complete', sentenceNotes: [] };
  }
  const chunks = planAnnotationChunks(req, ANNOTATION_CHUNK_SENTENCES);
  const results = await mapWithConcurrency(chunks, ANNOTATION_CHUNK_CONCURRENCY, (chunk) =>
    annotateChunk(env, fetchImpl, chunk),
  );
  const raw = results.flatMap((r) => r.raw);
  // sentenceNotes carry absolute indices; merge across slices and ground against the full passage.
  const sentenceNotes = normalizeSentenceNotes(results.flatMap((r) => r.notes), req.sentences);
  return {
    noticeCues: anchorCues(req.sentences, raw),
    status: mergeAnnotationStatus(results.map((r) => r.status)),
    sentenceNotes,
  };
}
