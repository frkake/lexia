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

import type { GenerationRequest, PassageAnnotationRequest } from '../../src/types/domain';
import { APPROX_WORDS } from '../../src/domain/generation/lengthSpec';

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
  'idiom',
  'phrasal_verb',
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
          anchorText: { type: 'string' },
          explanationJa: { type: 'string' },
        },
        required: ['index', 'span', 'category', 'wordId', 'sourceAttribute', 'anchorText', 'explanationJa'],
      },
    },
  },
  required: ['meta', 'sentences', 'targetSpans', 'collocationSpans', 'noticeCues'],
} as const;

/**
 * JSON Schema for WordData.more — the rich attributes that ground the advanced notice
 * categories (etymology / semantic_network / grammar_pattern / word_family / common_error).
 * Strict-mode shape: every property is `required`; optionals are nullable and empties are
 * pruned server-side (normalizeWordData) so the validator's grounding check stays honest.
 */
const WORD_MORE_JSON_SCHEMA = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: {
    etymology: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        prefix: { type: ['string', 'null'] },
        root: { type: ['string', 'null'] },
        suffix: { type: ['string', 'null'] },
      },
      required: ['prefix', 'root', 'suffix'],
    },
    semanticNetwork: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        synonyms: { type: 'array', items: { type: 'string' } },
        antonyms: { type: 'array', items: { type: 'string' } },
        hypernyms: { type: 'array', items: { type: 'string' } },
        hyponyms: { type: 'array', items: { type: 'string' } },
        related: { type: 'array', items: { type: 'string' } },
      },
      required: ['synonyms', 'antonyms', 'hypernyms', 'hyponyms', 'related'],
    },
    wordFamily: { type: 'array', items: { type: 'string' } },
    idioms: { type: 'array', items: { type: 'string' } },
    grammarPatterns: { type: 'array', items: { type: 'string' } },
    metaphor: { type: ['string', 'null'] },
    commonErrors: { type: 'array', items: { type: 'string' } },
  },
  required: ['etymology', 'semanticNetwork', 'wordFamily', 'idioms', 'grammarPatterns', 'metaphor', 'commonErrors'],
} as const;

/** JSON Schema for WordData — a single dictionary card (rich MORE attributes for notices). */
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
    more: WORD_MORE_JSON_SCHEMA,
  },
  required: ['wordId', 'headword', 'ipa', 'pos', 'register', 'connotation', 'frequency', 'core', 'more'],
} as const;

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
  'masteryDensity copies the requested value.',
  '',
  'Constraints (the request fields are hard requirements, not hints — satisfy ALL of them):',
  '- Theme: set the passage in / about the requested theme(s). The situation, roles, named',
  '  entities, and domain vocabulary must clearly belong to that theme. Put the primary theme',
  '  in meta.theme and give a title that fits it. (If no theme is given, pick a coherent one.)',
  '- Length: the total number of words across all sentences MUST be close to approxWords (aim',
  '  within ±20%): short≈120 (about 8-12 sentences), medium≈250 (about 16-22 sentences),',
  '  long≈400 (about 26-34 sentences). Keep writing sentences until you reach that word count —',
  '  do not stop early. meta.approxWords MUST equal the actual number of words you wrote.',
  '- Level: keep ALL non-target vocabulary at or below the requested CEFR level; only the listed',
  '  target words may exceed it. Prefer a simpler synonym over a more advanced word.',
  '- Target words & ratio: include EVERY requested target word at least once, copying its',
  '  masteryDensity, so the new/review balance matches newWordRatio.',
  '',
  'Collocations: actively REUSE each target word\'s supplied core.collocations in the passage —',
  'a learner needs to see the word in its natural phrases. For every collocation you weave in, add',
  'a collocationSpan covering exactly its tokens, with headWordId = that word\'s wordId and',
  'collocationId = the collocation string taken from core.collocations.',
  '',
  'When target words ARE requested, collocationSpans should be NON-empty (use the supplied',
  'core.collocations). Leave noticeCues an EMPTY array — in-passage "notice" insights are added by a',
  'SEPARATE annotation step, not here. With no target words, write a coherent themed passage with',
  'empty targetSpans/collocationSpans/noticeCues.',
  'meta.newCount/reviewCount count distinct new/review target words; approxWords ~= total words.',
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
  const lines = [
    'Generate one PassageOutput JSON that satisfies ALL of these constraints:',
    JSON.stringify(request, null, 2),
  ];
  if (req.repairFeedback && req.repairFeedback.length > 0) {
    lines.push(
      '',
      'Your previous attempt was rejected. Fix every problem below and regenerate:',
      ...req.repairFeedback.map((f) => `- ${f}`),
    );
  }
  return lines.join('\n');
}

export function buildPassageMessages(req: GenerationRequest): { system: string; user: string } {
  return { system: PASSAGE_SYSTEM, user: passageUser(req) };
}

// ── Annotation pass (exhaustive in-passage notice cues) ──────────────────────

/** Expression categories the annotation pass may emit (the in-text, phrase-level subset). */
export const ANNOTATION_CATEGORIES = [
  'collocation',
  'idiom',
  'phrasal_verb',
  'connotation',
  'register',
  'grammar_pattern',
] as const;

/** JSON Schema for the annotation reply: a flat list of location-anchored notice cues. */
export const ANNOTATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    noticeCues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          span: {
            type: 'object',
            additionalProperties: false,
            properties: { ...SPAN_PROPS },
            required: ['sentenceIndex', 'tokenStart', 'tokenEnd'],
          },
          category: { type: 'string', enum: [...ANNOTATION_CATEGORIES] },
          anchorText: { type: 'string' },
          explanationJa: { type: 'string' },
        },
        required: ['span', 'category', 'anchorText', 'explanationJa'],
      },
    },
  },
  required: ['noticeCues'],
} as const;

const ANNOTATION_SYSTEM = [
  'You annotate an already-written English reading passage for Japanese learners. You receive the',
  'passage as sentences of TOKENS (one word / punctuation mark / clitic per token, joined with',
  'deterministic spacing) and reply with a SINGLE JSON object {"noticeCues":[...]} matching the',
  'schema — no prose, no markdown, no code fences.',
  '',
  'Find EVERY expression in the passage a learner should pause on, across these categories:',
  'collocation, idiom, phrasal_verb, connotation, register, grammar_pattern. Be exhaustive — do not',
  'stop at a few. For each, add a cue:',
  '- anchorText: the EXACT word(s) in the passage the note is about, copied VERBATIM from that',
  "  sentence's tokens (the joined surface). It MUST appear verbatim in the passage.",
  '- span: { sentenceIndex, tokenStart, tokenEnd } (half-open) for those tokens. Do NOT agonize over',
  '  exact indices — the app re-derives the span from anchorText — but point at the right sentence.',
  '- category: the single best fit from the list above.',
  '- explanationJa: a short Japanese note on what to notice (nuance, fixed phrasing, why it matters).',
  '',
  'Quality bar: only high-confidence, pedagogically worthwhile items at or above the requested CEFR',
  'level. Skip transparent, trivial sequences ("go to", "in the"). Aim for at most ~2-3 cues per',
  'sentence so the page stays readable; add nothing for a sentence with nothing notable. Returning',
  'few or zero cues for a plain passage is fine.',
].join('\n');

export function buildAnnotationMessages(req: PassageAnnotationRequest): { system: string; user: string } {
  const sentences = req.sentences.map((s, i) => ({ sentenceIndex: i, tokens: s.tokens }));
  const user = [
    `Passage CEFR level: ${req.level}.`,
    'Annotate this passage exhaustively. Reply with {"noticeCues":[...]} only.',
    JSON.stringify({ sentences }, null, 2),
  ].join('\n');
  return { system: ANNOTATION_SYSTEM, user };
}

/** Output-token budget for the annotation pass: generous, scales with passage size. */
export function annotationMaxTokens(sentenceCount: number): number {
  return Math.min(4000, 500 + sentenceCount * 150);
}

const WORD_SYSTEM = [
  'You are a bilingual (English/Japanese) lexicographer for a vocabulary-learning app. Reply with',
  'a single JSON object matching the WordData schema — no prose, no markdown, no code fences.',
  'meaningsJa and example.ja are in Japanese; examples[].en are natural English sentences using',
  'the word. register is one of formal/neutral/casual/academic/business/slang. connotation is a',
  'short Japanese note. frequency is 1 (rare) to 5 (very common). Provide 1-3 meanings, 1-2',
  'examples, and a few collocations and synonym nuances.',
  'Also fill "more" as richly as the word allows — these power the in-passage "notice" insights:',
  '- etymology: prefix/root/suffix when the word has them (else null for that part).',
  '- semanticNetwork: synonyms, antonyms, hypernyms, hyponyms, related (arrays; [] if none).',
  '- wordFamily: derived forms / part-of-speech variants (e.g. ["decision","decisive"]).',
  '- grammarPatterns: typical constructions (e.g. ["depend on N","it depends whether ..."]).',
  '- commonErrors: mistakes Japanese learners typically make with this word.',
  '- idioms and metaphor: fixed expressions and a short Japanese note on any metaphorical sense.',
  'Use [] for arrays and null for scalars/objects that genuinely do not apply — never invent.',
].join('\n');

export function buildWordMessages(wordId: string): { system: string; user: string } {
  return {
    system: WORD_SYSTEM,
    user: `Produce the WordData JSON for the English word "${wordId}". Set wordId to "${wordId}".`,
  };
}

/** JSON Schema for a vocabulary suggestion reply: a flat list of base-form lemmas. */
export const WORD_SUGGESTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { words: { type: 'array', items: { type: 'string' } } },
  required: ['words'],
} as const;

const SUGGEST_SYSTEM = [
  'You curate vocabulary for a CEFR-graded English reading app whose users are Japanese speakers.',
  'Given a CEFR level and theme(s), propose distinct English words a learner at that level should',
  'study next. Choose words that clearly belong to the theme/domain and sit AT or slightly ABOVE',
  'the given level — useful and worth learning, not trivial function words (the, go, very) and not',
  'absurdly rare. Each must be a single base-form lemma (no spaces), lowercase. Never include any',
  'word from the exclude list. Reply with JSON {"words":[...]} only — no prose, no code fences.',
].join('\n');

export function buildSuggestionMessages(req: {
  level: string;
  themes: string[];
  count: number;
  exclude?: string[];
}): { system: string; user: string } {
  const ask = {
    level: req.level,
    themes: req.themes,
    count: req.count,
    exclude: req.exclude ?? [],
  };
  return {
    system: SUGGEST_SYSTEM,
    user: `Propose exactly ${req.count} lemmas for this request:\n${JSON.stringify(ask, null, 2)}`,
  };
}
