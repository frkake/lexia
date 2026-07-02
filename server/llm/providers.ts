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
  CharacterIllustrationRequest,
  GenerationRequest,
  GenerationResponse,
  NoticeCue,
  PassageAnnotationRequest,
  PassageOutput,
  Sentence,
  StopReason,
  StoryPlan,
  StoryPlanExtensionRequest,
  StoryPlanRequest,
  TranslationSpan,
  WordData,
  WordSuggestionRequest,
} from '../../src/types/domain';
import {
  ANNOTATION_CATEGORIES,
  ANNOTATION_JSON_SCHEMA,
  PASSAGE_JSON_SCHEMA,
  STORY_PLAN_EXTENSION_JSON_SCHEMA,
  STORY_PLAN_JSON_SCHEMA,
  WORD_DATA_JSON_SCHEMA,
  WORD_SUGGESTION_JSON_SCHEMA,
  annotationMaxTokens,
  buildAnnotationMessages,
  buildCharacterIllustrationPrompt,
  buildPassageMessages,
  buildStoryPlanExtensionMessages,
  buildStoryPlanMessages,
  buildSuggestionMessages,
  buildWordMessages,
  maxTokensForWordTarget,
  storyPlanMaxTokens,
  storyPlanExtensionMaxTokens,
} from './schema';
import { tokenizer } from '../../src/domain/tokenizer/joinService';

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
  return { tokens, translationJa, ...(translationSpans ? { translationSpans } : {}) };
}

/** Ensure arrays exist and meta is complete (backfilled from the request) for the validator/UI. */
function normalizePassage(core: Raw, req: GenerationRequest): PassageOutput {
  const sentences = asArray<Raw>(core.sentences).map(normalizeSentence);
  const targetSpans = asArray<PassageOutput['targetSpans'][number]>(core.targetSpans);
  const collocationSpans = asArray<PassageOutput['collocationSpans'][number]>(core.collocationSpans);
  const noticeCues = asArray<PassageOutput['noticeCues'][number]>(core.noticeCues);
  const metaIn = (core.meta && typeof core.meta === 'object' ? core.meta : {}) as Partial<PassageOutput['meta']>;
  const distinct = new Map(targetSpans.map((s) => [s.wordId, s.masteryDensity]));
  const newCount = [...distinct.values()].filter((d) => d === 'new').length;
  const storyRef = req.storyContext
    ? { storyId: req.storyContext.storyId, chapterIndex: req.storyContext.chapterIndex }
    : metaIn.storyRef;
  const meta: PassageOutput['meta'] = {
    title: metaIn.title || 'Reading',
    intent: metaIn.intent || req.intent,
    level: metaIn.level || req.level,
    newCount: typeof metaIn.newCount === 'number' ? metaIn.newCount : newCount,
    reviewCount: typeof metaIn.reviewCount === 'number' ? metaIn.reviewCount : distinct.size - newCount,
    approxWords:
      typeof metaIn.approxWords === 'number'
        ? metaIn.approxWords
        : sentences.reduce((n, s) => n + (Array.isArray(s.tokens) ? s.tokens.length : 0), 0),
    ...(storyRef ? { storyRef } : {}),
  };
  return reanchorSpans({ meta, sentences, targetSpans, collocationSpans, noticeCues });
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
  for (let start = from; start < tokens.length; start += 1) {
    for (let end = start + 1; end <= Math.min(tokens.length, start + 6); end += 1) {
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

/**
 * Models reliably miscount the token indices of their own spans (the prose is correct but
 * [tokenStart,tokenEnd) points at the wrong tokens, which the PassageValidator rejects as
 * surface_mismatch). Re-derive each span's indices by locating its declared text in the passage
 * so the client validator + renderer + TTS see correct spans. Target/collocation spans relocate by
 * their `surface`/`collocationId`. Notice cues are NOT produced here — they come from the separate
 * annotation pass (annotatePassage); generation leaves noticeCues empty.
 */
function reanchorSpans(passage: PassageOutput): PassageOutput {
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
      const loc = locate(passage.sentences, span.collocationId, span.sentenceIndex, usedColl);
      if (!loc) return null;
      usedColl.add(`${loc.sentenceIndex}:${loc.tokenStart}`);
      return { ...span, ...loc };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  // Notices are produced by the separate annotation pass (annotatePassage), not by generation.
  return { ...passage, targetSpans, collocationSpans, noticeCues: [] };
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
  const { text } = await callModel(env, fetchImpl, system, user, 1800, WORD_DATA_JSON_SCHEMA, 'word_data');
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
 * Drop null/empty `more` fields so stored WordData matches the optional domain shape and the
 * validator's grounding rule (empty ⇒ absent) stays consistent with what the UI renders.
 */
function normalizeWordData(parsed: Partial<WordData>, wordId: string): WordData {
  const data = { ...parsed, wordId } as WordData;
  const memoryTips = normalizeMemoryTips((parsed as { memoryTips?: unknown }).memoryTips);
  if (memoryTips) data.memoryTips = memoryTips;
  else delete (data as { memoryTips?: unknown }).memoryTips;
  const more = pruneEmpty((parsed as { more?: unknown }).more);
  if (more && Object.keys(more).length > 0) data.more = more as WordData['more'];
  else delete (data as { more?: unknown }).more;
  return data;
}

/** Recursively strip null/empty values; returns undefined when nothing meaningful remains. */
function pruneEmpty(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      if (v.length > 0) out[key] = v;
    } else if (typeof v === 'object') {
      const inner = pruneEmpty(v);
      if (inner && Object.keys(inner).length > 0) out[key] = inner;
    } else if (typeof v === 'string') {
      if (v.trim().length > 0) out[key] = v;
    } else {
      out[key] = v;
    }
  }
  return out;
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

// ── Character illustration (Requirement 6.8) ─────────────────────────────────
//
// Image generation is a SEPARATE provider axis from text: Anthropic has no image API, so
// `IMAGE_PROVIDER` (default "openai"; "gemini"/"google" -> Imagen) is resolved independently of
// LLM_PROVIDER. The portrait comes back as base64 and is returned as a `data:` URL the client stores
// inline with the plan (there is no CDN). Failures raise ProviderError like the text path so the
// caller can degrade to no portrait.

type ImageProvider = 'openai' | 'gemini';

const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/generations';
const GEMINI_IMAGE_MODEL_DEFAULT = 'imagen-3.0-generate-002';
const OPENAI_IMAGE_MODEL_DEFAULT = 'gpt-image-1';

function resolveImageProvider(env: Env): ImageProvider {
  const raw = (env.IMAGE_PROVIDER ?? 'openai').trim().toLowerCase();
  return raw === 'gemini' || raw === 'google' || raw === 'imagen' ? 'gemini' : 'openai';
}

/** The configured key for the active image provider, or throw 503 so the UI shows "unavailable". */
function requireImageKey(env: Env, provider: ImageProvider): string {
  // OpenAI image generation reuses OPENAI_API_KEY; Gemini/Imagen uses its own GEMINI_API_KEY.
  const key = provider === 'gemini' ? env.GEMINI_API_KEY : env.OPENAI_API_KEY;
  if (!key || !key.trim() || key.includes('...')) {
    const name = provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY';
    throw new ProviderError(503, `Image API not configured: ${name} is missing. Set it in .env.`);
  }
  return key.trim();
}

function imageModelFor(env: Env, provider: ImageProvider): string {
  const configured = env.IMAGE_MODEL?.trim();
  if (configured) return configured;
  return provider === 'gemini' ? GEMINI_IMAGE_MODEL_DEFAULT : OPENAI_IMAGE_MODEL_DEFAULT;
}

/**
 * Generate one character's portrait, returning a `data:image/png;base64,...` URL (Requirement 6.8).
 * OpenAI hits the Images endpoint (`b64_json`); Gemini/Imagen hits the model `:predict` endpoint
 * (`predictions[].bytesBase64Encoded`, key as query param per the REST contract). Small size + low
 * quality keep the data URL light since it lands in IndexedDB.
 */
export async function illustrateCharacter(
  env: Env,
  req: CharacterIllustrationRequest,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<string> {
  const provider = resolveImageProvider(env);
  const apiKey = requireImageKey(env, provider);
  const model = imageModelFor(env, provider);
  const prompt = buildCharacterIllustrationPrompt(req);

  let response: Response;
  try {
    response =
      provider === 'gemini'
        ? await fetchImpl(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${encodeURIComponent(apiKey)}`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                instances: [{ prompt }],
                parameters: { sampleCount: 1, aspectRatio: '1:1' },
              }),
            },
          )
        : await fetchImpl(OPENAI_IMAGE_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model, prompt, n: 1, size: '1024x1024', quality: 'low' }),
          });
  } catch (cause) {
    throw new ProviderError(503, `Image API unreachable: ${cause instanceof Error ? cause.message : 'network error'}`);
  }

  if (!response.ok) {
    const detail = await safeText(response);
    throw new ProviderError(mapUpstreamStatus(response.status), `${provider} image API error ${response.status}: ${detail}`);
  }

  const body = (await response.json()) as unknown;
  const b64 = provider === 'gemini' ? parseGeminiImage(body) : parseOpenAiImage(body);
  if (!b64) throw new ProviderError(502, `${provider} image API returned no image.`);
  return `data:image/png;base64,${b64}`;
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
};

const ANNOTATION_CATEGORY_SET = new Set<string>(ANNOTATION_CATEGORIES);

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
      return {
        index: 0,
        span: loc,
        category,
        anchorText,
        explanationJa: typeof cue.explanationJa === 'string' ? cue.explanationJa : '',
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

/** Second LLM pass: exhaustively annotate a finished passage with in-text notice cues. */
export async function annotatePassage(
  env: Env,
  req: PassageAnnotationRequest,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<NoticeCue[]> {
  if (!Array.isArray(req.sentences) || req.sentences.length === 0) return [];
  const { system, user } = buildAnnotationMessages(req);
  const { text, stopReason } = await callModel(
    env,
    fetchImpl,
    system,
    user,
    annotationMaxTokens(req.sentences.length),
    ANNOTATION_JSON_SCHEMA,
    'passage_annotation',
  );
  // Refusal / truncation yield no usable annotations; degrade to none rather than failing.
  if (stopReason === 'refusal' || stopReason === 'max_tokens') return [];
  const parsed = parseJson<{ noticeCues?: unknown }>(text, 'annotation');
  const raw = Array.isArray(parsed.noticeCues) ? (parsed.noticeCues as RawCue[]) : [];
  return anchorCues(req.sentences, raw);
}
