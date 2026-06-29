/**
 * Generation contract for the thin LLM proxy (design.md "PassageGenerationService").
 *
 * The proxy turns a `GenerationRequest` into a provider call whose structured output is a
 * `PassageOutput` (src/types/domain.ts). The client's PassageValidator is load-bearing for
 * meaning (span grounding, CEFR, sourceAttribute), so the schema here only fixes *shape* —
 * the orchestrator's repair loop handles semantic deviations.
 *
 * Token convention mirrors TokenizerJoinService: each token is a word OR a punctuation mark
 * OR a clitic (`'s`, `n't`); the renderer joins them with deterministic spacing. Spans are
 * half-open `[tokenStart, tokenEnd)` token ranges within one sentence.
 */

import type { GenerationRequest } from '../../src/types/domain';

const CEFR = ['A2', 'B1', 'B2', 'C1', 'C2'] as const;
const NOTICE_CATEGORIES = [
  'connotation',
  'collocation',
  'register',
  'etymology',
  'semantic_network',
  'synonym_nuance',
  'grammar_pattern',
  'word_family',
  'frequency',
  'common_error',
] as const;

const SPAN_PROPS = {
  sentenceIndex: { type: 'integer' },
  tokenStart: { type: 'integer' },
  tokenEnd: { type: 'integer' },
} as const;

/** JSON Schema for PassageOutput — used for Anthropic `output_config.format`. */
export const PASSAGE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    meta: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        theme: { type: 'string' },
        level: { type: 'string', enum: [...CEFR] },
        newCount: { type: 'integer' },
        reviewCount: { type: 'integer' },
        approxWords: { type: 'integer' },
      },
      required: ['title', 'theme', 'level', 'newCount', 'reviewCount', 'approxWords'],
    },
    sentences: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tokens: { type: 'array', items: { type: 'string' } },
          translationJa: { type: 'string' },
        },
        required: ['tokens', 'translationJa'],
      },
    },
    targetSpans: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...SPAN_PROPS,
          wordId: { type: 'string' },
          surface: { type: 'string' },
          masteryDensity: { type: 'string', enum: ['new', 'review', 'known'] },
          // Nullable + listed in `required` so the schema is OpenAI strict-mode compliant.
          reappearInfo: {
            type: ['object', 'null'],
            additionalProperties: false,
            properties: { count: { type: 'integer' }, noteJa: { type: ['string', 'null'] } },
            required: ['count', 'noteJa'],
          },
        },
        required: ['sentenceIndex', 'tokenStart', 'tokenEnd', 'wordId', 'surface', 'masteryDensity', 'reappearInfo'],
      },
    },
    collocationSpans: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...SPAN_PROPS,
          headWordId: { type: 'string' },
          collocationId: { type: 'string' },
        },
        required: ['sentenceIndex', 'tokenStart', 'tokenEnd', 'headWordId', 'collocationId'],
      },
    },
    noticeCues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'integer' },
          span: {
            type: 'object',
            additionalProperties: false,
            properties: { ...SPAN_PROPS },
            required: ['sentenceIndex', 'tokenStart', 'tokenEnd'],
          },
          category: { type: 'string', enum: [...NOTICE_CATEGORIES] },
          wordId: { type: 'string' },
          sourceAttribute: { type: 'string' },
          explanationJa: { type: 'string' },
        },
        required: ['index', 'span', 'category', 'wordId', 'sourceAttribute', 'explanationJa'],
      },
    },
  },
  required: ['meta', 'sentences', 'targetSpans', 'collocationSpans', 'noticeCues'],
} as const;

/** JSON Schema for WordData — a single dictionary card (MORE attributes are optional). */
export const WORD_DATA_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    wordId: { type: 'string' },
    headword: { type: 'string' },
    ipa: { type: 'string' },
    pos: { type: 'array', items: { type: 'string' } },
    register: { type: 'string' },
    connotation: { type: 'string' },
    frequency: { type: 'integer' },
    core: {
      type: 'object',
      additionalProperties: false,
      properties: {
        meaningsJa: { type: 'array', items: { type: 'string' } },
        examples: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { en: { type: 'string' }, ja: { type: 'string' } },
            required: ['en', 'ja'],
          },
        },
        collocations: { type: 'array', items: { type: 'string' } },
        synonymNuances: { type: 'array', items: { type: 'string' } },
      },
      required: ['meaningsJa', 'examples', 'collocations', 'synonymNuances'],
    },
  },
  required: ['wordId', 'headword', 'ipa', 'pos', 'register', 'connotation', 'frequency', 'core'],
} as const;

const APPROX_WORDS: Record<GenerationRequest['length'], number> = {
  short: 120,
  medium: 250,
  long: 400,
};

/** Output-token budget per requested length (generous; passages stay well under). */
export function maxTokensForLength(length: GenerationRequest['length']): number {
  if (length === 'long') return 3600;
  if (length === 'medium') return 2400;
  return 1400;
}

const PASSAGE_SYSTEM = [
  'You generate short English reading passages for a vocabulary-learning app whose users are',
  'Japanese speakers. You ALWAYS reply with a single JSON object matching the PassageOutput',
  'schema below — no prose, no markdown, no code fences.',
  '',
  'Tokenization (critical): each sentence is an ARRAY OF TOKENS, not a string. A token is one',
  'word, OR one punctuation mark (",", ".", "!", "?", ";", ":"), OR a clitic ("\'s", "n\'t",',
  "\"'re\"). Example: \"She stayed resilient.\" -> [\"She\",\"stayed\",\"resilient\",\".\"]. The app",
  'rejoins tokens with deterministic spacing, so punctuation MUST be its own token.',
  '',
  'For every sentence also give translationJa: a natural Japanese translation of that sentence.',
  '',
  'Target words: weave each requested target word into the passage. For each occurrence add a',
  'targetSpan whose [tokenStart, tokenEnd) selects exactly the token(s) of that word, surface =',
  'those tokens joined, and surface MUST be an inflection of the requested word (same lemma).',
  'masteryDensity copies the requested value. Keep overall vocabulary within the CEFR level.',
  '',
  'Notice cues (optional, only when grounded): a cue may ONLY cite an attribute that was supplied',
  'for that word, and category must match: connotation->connotation, register->register,',
  'collocation->core.collocations, synonym_nuance->core.synonymNuances, grammar_pattern->',
  'more.grammarPatterns, etymology->more.etymology, semantic_network->more.semanticNetwork,',
  'word_family->more.wordFamily, common_error->more.commonErrors, frequency->frequency. Omit a',
  'cue entirely if the attribute is absent. explanationJa is a short Japanese explanation.',
  '',
  'collocationSpans and noticeCues may be empty arrays. When no target words are requested, write',
  'a coherent passage on the theme and return empty targetSpans/collocationSpans/noticeCues.',
  'meta.newCount/reviewCount count distinct new/review target words; approxWords ~= total tokens.',
].join('\n');

/** JSON description of the request the model must satisfy. */
function passageUser(req: GenerationRequest): string {
  const targets = req.targetWords.map((t) => ({
    wordId: t.wordId,
    surface: t.surface,
    masteryDensity: t.masteryDensity,
    attributes: t.attributes ?? {},
  }));
  const request = {
    level: req.level,
    themes: req.themes,
    length: req.length,
    approxWords: APPROX_WORDS[req.length],
    newWordRatio: req.newWordRatio,
    targetWords: targets,
  };
  return `Generate one PassageOutput JSON for this request:\n${JSON.stringify(request, null, 2)}`;
}

export function buildPassageMessages(req: GenerationRequest): { system: string; user: string } {
  return { system: PASSAGE_SYSTEM, user: passageUser(req) };
}

const WORD_SYSTEM = [
  'You are a bilingual (English/Japanese) lexicographer for a vocabulary-learning app. Reply with',
  'a single JSON object matching the WordData schema — no prose, no markdown, no code fences.',
  'meaningsJa and example.ja are in Japanese; examples[].en are natural English sentences using',
  'the word. register is one of formal/neutral/casual/academic/business/slang. connotation is a',
  'short Japanese note. frequency is 1 (rare) to 5 (very common). Provide 1-3 meanings, 1-2',
  'examples, and a few collocations and synonym nuances.',
].join('\n');

export function buildWordMessages(wordId: string): { system: string; user: string } {
  return {
    system: WORD_SYSTEM,
    user: `Produce the WordData JSON for the English word "${wordId}". Set wordId to "${wordId}".`,
  };
}
