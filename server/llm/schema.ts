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

import type {
  CharacterIllustrationRequest,
  ExpressionCategory,
  GenerationRequest,
  LearningIntent,
  PassageAnnotationRequest,
  PassageIllustrationRequest,
  Sentence,
  StoryPlan,
  StoryPlanExtensionRequest,
} from '../../src/types/domain';
import { lengthSpec, idiomQuotaFor, setPhraseQuotaFor } from '../../src/domain/generation/lengthSpec';
import { tokenizer } from '../../src/domain/tokenizer/joinService';
import { readabilityForCefr } from '../../src/domain/difficulty/levelPreset';

const CEFR = ['A2', 'B1', 'B2', 'C1', 'C2'] as const;
const LEARNING_INTENTS = ['business', 'daily', 'toeic', 'eiken', 'academic', 'travel'] as const;

/** Exam-style intents whose passages should bias toward that exam's high-frequency vocab/format (8.4). */
const EXAM_INTENTS: Partial<Record<LearningIntent, string>> = {
  toeic: 'TOEIC (business correspondence, workplace scenarios, and TOEIC-frequent vocabulary and question-style phrasing)',
  eiken: '英検 (Eiken exam topics, essay/opinion registers, and Eiken-frequent vocabulary)',
};

/**
 * Illustrative set phrases native speakers reach for in each intent (B-2). Injected into the user
 * message for the requested intent only (not the static system prompt) so the model weaves the
 * genre-appropriate formulaic language into its "natural" position — a greeting opening a letter, an
 * announcement formula opening an announcement — instead of leaving it to chance. Not exhaustive.
 */
const SET_PHRASE_HINTS: Record<LearningIntent, string[]> = {
  business: [
    'I am writing to inquire about',
    'Please find attached',
    'I look forward to hearing from you',
    'as per our discussion',
    'moving forward',
    'at your earliest convenience',
    'please do not hesitate to contact me',
    'with regard to',
    'I would appreciate it if',
    'thank you for your prompt reply',
  ],
  toeic: [
    'Attention, passengers.',
    'Please note that',
    'We apologize for any inconvenience.',
    'Thank you for your patience.',
    'Please be advised that',
    'due to scheduled maintenance',
    'as a reminder',
    'effective immediately',
    'for further information, please contact',
    'we regret to inform you that',
  ],
  travel: [
    "I'd like to check in",
    'Could you tell me how to get to',
    'Is breakfast included?',
    'Have a safe trip.',
    'Do you have any vacancies?',
    'How much is it per night?',
    'Could I have the bill, please?',
    'Where is the nearest station?',
    "I'd like to book a table for two.",
    'Is there anything you recommend?',
  ],
  daily: [
    "It's been a while.",
    'You know what?',
    'No wonder',
    'That makes sense.',
    'To be honest,',
    'By the way,',
    'Come to think of it,',
    'That reminds me,',
    'Long story short,',
    'It depends.',
  ],
  eiken: [
    'It is widely believed that',
    'This suggests that',
    'In conclusion',
    'in contrast to',
    'for this reason',
    'there is no doubt that',
    'on the one hand ... on the other hand',
    'as a result of',
    'in my opinion',
    'take everything into account',
  ],
  academic: [
    'It is widely believed that',
    'This suggests that',
    'In conclusion',
    'in contrast to',
    'a growing body of research',
    'these findings indicate that',
    'it is worth noting that',
    'to a large extent',
    'in light of',
    'this raises the question of',
  ],
};
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
  'phrase',
  'metaphor',
  'usage',
  'memory_tip',
  'sentence_structure',
] as const;

/** Difficult syntactic constructions the model self-reports in syntaxSpans (B-3). */
const SYNTAX_PATTERNS = [
  'nonrestrictive_relative',
  'participial',
  'inversion',
  'cleft',
  'subjunctive',
  'appositive',
  'other',
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
        intent: { type: 'string', enum: [...LEARNING_INTENTS] },
        level: { type: 'string', enum: [...CEFR] },
        newCount: { type: 'integer' },
        reviewCount: { type: 'integer' },
        approxWords: { type: 'integer' },
      },
      required: ['title', 'intent', 'level', 'newCount', 'reviewCount', 'approxWords'],
    },
    sentences: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tokens: { type: 'array', items: { type: 'string' } },
          translationJa: { type: 'string' },
          speakerId: { type: ['string', 'null'] },
          // Translation-side emphasis (Requirement 4): the model quotes the JA expression
          // VERBATIM (anchorTextJa) and the server re-derives charStart/charEnd from it (the
          // model miscounts offsets), mirroring how target/notice spans are re-anchored.
          translationSpans: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                anchorTextJa: { type: 'string' },
                refType: { type: 'string', enum: ['word', 'collocation', 'idiom', 'grammar'] },
                wordId: { type: 'string' },
                isNew: { type: 'boolean' },
              },
              required: ['anchorTextJa', 'refType', 'wordId', 'isNew'],
            },
          },
          // 0-based paragraph index (F-8②): 0 for the first paragraph, +1 at each discourse break.
          paragraphIndex: { type: 'integer' },
        },
        required: ['tokens', 'translationJa', 'speakerId', 'translationSpans', 'paragraphIndex'],
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
          // The collocation AS REALIZED in the passage, copied verbatim (the whole phrase, e.g.
          // "accept the proposal"). The server re-derives the span from it, so the highlighted
          // range covers the full phrase instead of collapsing to the head word.
          surface: { type: 'string' },
        },
        required: ['sentenceIndex', 'tokenStart', 'tokenEnd', 'headWordId', 'collocationId', 'surface'],
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
    // Self-reported idioms / phrasal verbs / set phrases (B-1 / B-2), re-anchored server-side from
    // `surface` and validated against the requested quota.
    expressionSpans: {
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
          surface: { type: 'string' },
          category: { type: 'string', enum: ['idiom', 'phrasal_verb', 'set_phrase'] },
          meaningJa: { type: 'string' },
        },
        required: ['span', 'surface', 'category', 'meaningJa'],
      },
    },
    // Self-reported difficult syntactic constructions (B-3), keyed by sentenceIndex + a verbatim
    // anchorText snippet. noteJa seeds the C-4 syntax-explanation UI.
    syntaxSpans: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sentenceIndex: { type: 'integer' },
          pattern: { type: 'string', enum: [...SYNTAX_PATTERNS] },
          anchorText: { type: 'string' },
          noteJa: { type: 'string' },
        },
        required: ['sentenceIndex', 'pattern', 'anchorText', 'noteJa'],
      },
    },
  },
  required: ['meta', 'sentences', 'targetSpans', 'collocationSpans', 'noticeCues', 'expressionSpans', 'syntaxSpans'],
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
    // C-2: morphological decomposition (parts) + bridge chain + cognates, replacing the legacy
    // prefix/root/suffix/noteJa shape.
    etymology: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        parts: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              form: { type: 'string' },
              surfaceIn: { type: ['string', 'null'] },
              meaningJa: { type: 'string' },
            },
            required: ['form', 'surfaceIn', 'meaningJa'],
          },
        },
        bridgeJa: { type: 'string' },
        cognates: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { word: { type: 'string' }, noteJa: { type: 'string' } },
            required: ['word', 'noteJa'],
          },
        },
        sourceJa: { type: ['string', 'null'] },
      },
      required: ['parts', 'bridgeJa', 'cognates', 'sourceJa'],
    },
    // C-2: a flat annotated array (carries hypernyms/hyponyms/related), replacing the five arrays.
    semanticNetwork: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          word: { type: 'string' },
          relation: { type: 'string', enum: ['synonym', 'antonym', 'hypernym', 'hyponym', 'related'] },
          noteJa: { type: 'string' },
        },
        required: ['word', 'relation', 'noteJa'],
      },
    },
    wordFamily: { type: 'array', items: { type: 'string' } },
    // C-1: idioms carry meaning + origin (literal → metaphor → sense) + example, replacing bare strings.
    idioms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          expression: { type: 'string' },
          meaningJa: { type: 'string' },
          originJa: { type: 'string' },
          exampleEn: { type: ['string', 'null'] },
          exampleJa: { type: ['string', 'null'] },
        },
        required: ['expression', 'meaningJa', 'originJa', 'exampleEn', 'exampleJa'],
      },
    },
    grammarPatterns: { type: 'array', items: { type: 'string' } },
    metaphor: { type: ['string', 'null'] },
    commonErrors: { type: 'array', items: { type: 'string' } },
  },
  required: ['etymology', 'semanticNetwork', 'wordFamily', 'idioms', 'grammarPatterns', 'metaphor', 'commonErrors'],
} as const;

const MEMORY_TIP_JSON_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: ['image', 'etymology', 'collocation', 'contrast', 'sound', 'mistake'] },
      tipJa: { type: 'string' },
    },
    required: ['kind', 'tipJa'],
  },
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
    memoryTips: MEMORY_TIP_JSON_SCHEMA,
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
        // C-3: head + slot pattern with fillers, type, gloss, and an L1-contrast flag, replacing
        // bare strings. `id` is the stable kebab-case key CollocationSpan.collocationId references (D4).
        collocations: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              pattern: { type: 'string' },
              type: { type: 'string', enum: ['V+N', 'Adj+N', 'N+of+N', 'V+Prep', 'Adv+V', 'other'] },
              slotExamples: { type: 'array', items: { type: 'string' } },
              glossJa: { type: 'string' },
              exampleEn: { type: ['string', 'null'] },
              l1Contrast: { type: 'boolean' },
            },
            required: ['id', 'pattern', 'type', 'slotExamples', 'glossJa', 'exampleEn', 'l1Contrast'],
          },
        },
        synonymNuances: { type: 'array', items: { type: 'string' } },
      },
      required: ['meaningsJa', 'examples', 'collocations', 'synonymNuances'],
    },
    more: WORD_MORE_JSON_SCHEMA,
  },
  required: ['wordId', 'headword', 'ipa', 'pos', 'register', 'connotation', 'frequency', 'memoryTips', 'core', 'more'],
} as const;

/** Output-token budget for a word target (continuous; replaces the legacy 3-value length budget). */
export function maxTokensForWordTarget(wordTarget: number): number {
  return lengthSpec.tokenBudgetFor(wordTarget);
}

const PASSAGE_SYSTEM = [
  'You generate English reading passages and story chapters for a vocabulary-learning app whose',
  'users are Japanese speakers. You ALWAYS reply with a single JSON object matching the PassageOutput',
  'schema below — no prose, no markdown, no code fences.',
  '',
  'Tokenization (critical): each sentence is an ARRAY OF TOKENS, not a string. A token is one',
  'word, OR one punctuation mark (",", ".", "!", "?", ";", ":"), OR a clitic ("\'s", "n\'t",',
  "\"'re\"). Example: \"She stayed resilient.\" -> [\"She\",\"stayed\",\"resilient\",\".\"]. The app",
  'rejoins tokens with deterministic spacing, so punctuation MUST be its own token.',
  '',
  'For every sentence also give translationJa: a natural Japanese translation of that sentence.',
  'Also include speakerId on every sentence: use null for normal reading/story prose, and a stable',
  'speaker id string for listening_scene utterances.',
  '',
  'Translation-side emphasis (translationSpans): for EACH sentence, mark the parts of translationJa',
  'that correspond to NEW elements so the learner sees the new word on both sides. For every NEW',
  'target word (masteryDensity = "new") that appears in the sentence, add ONE entry to that',
  "sentence's translationSpans with:",
  '- anchorTextJa: the exact Japanese phrase IN translationJa that renders that word, copied VERBATIM',
  '  (it MUST be an exact substring of translationJa — the app re-derives character offsets from it).',
  '- refType: "word" (or "collocation"/"idiom"/"grammar" if the new element is a phrase).',
  '- wordId: the matching target word\'s wordId.',
  '- isNew: true.',
  'Only NEW elements get a span — do NOT add spans for review/known words. If a sentence contains no',
  'new elements, set its translationSpans to an EMPTY array [].',
  '',
  'Target words: weave each requested target word into the passage. For each occurrence add a',
  'targetSpan whose [tokenStart, tokenEnd) selects exactly the token(s) of that word, surface =',
  'those tokens joined, and surface MUST be an inflection of the requested word (same lemma).',
  'masteryDensity copies the requested value.',
  '',
  'Constraints (the request fields are hard requirements, not hints — satisfy ALL of them):',
  '- Intent: set the passage in / about the requested learning intent (business / daily / toeic /',
  '  eiken / academic / travel). The situation, roles, named entities, register and domain',
  '  vocabulary must clearly fit that intent. Put the intent in meta.intent and give a fitting title.',
  '  For exam intents (toeic / eiken), PRIORITIZE that exam\'s high-frequency vocabulary and typical',
  '  formats/registers.',
  '- Length: the total number of words across all sentences MUST be close to the requested',
  '  approxWords (aim within ±20%). Keep writing sentences until you reach that word count — do not',
  '  stop early. meta.approxWords MUST equal the actual number of words you wrote. Sentence length',
  '  follows the readability level below, NOT a fixed words-per-sentence rhythm.',
  '- Level: keep ALL non-target vocabulary at or below the requested CEFR level; only the listed',
  '  target words may exceed it. Prefer a simpler synonym over a more advanced word.',
  '- Readability (hard requirement, independent of vocabulary level):',
  '  easy: 8-12 words per sentence on average; one main clause per sentence as a rule; connect ideas',
  '    with and / but / because / so; NO passive voice, NO relative clauses, NO participial phrases.',
  '    After a difficult word, prefer an appositive paraphrase ("a drought — a long period without',
  '    rain —") so learners can infer meaning from context.',
  '  standard: 12-16 words per sentence on average; a natural mix of simple, compound and complex',
  '    sentences; you may use restrictive relative clauses, first/second conditionals, present',
  '    perfect and basic passives; average at most one subordinate clause per sentence.',
  '  advanced: 16-24 words per sentence on average, and across the whole passage you MUST use at',
  '    least four of these five constructions, each at least once: (a) a non-restrictive relative',
  '    clause, (b) a participial construction, (c) inversion or a cleft sentence ("Not only did ...",',
  '    "It was ... that ..."), (d) an unreal conditional or subjunctive ("Had the plan failed, ..."),',
  '    (e) an appositive noun phrase. Use nominalisation and dense connectors where natural, while',
  '    keeping the passage coherent.',
  '- Self-report syntax: for every construction above that you used on purpose, add an entry to',
  '  syntaxSpans: { sentenceIndex, pattern, anchorText (a verbatim snippet of that sentence',
  '  containing the construction), noteJa (one short Japanese reading hint, e.g. "倒置: Not only が',
  '  文頭に出て助動詞 did が主語の前に移動する") }. At advanced readability, syntaxSpans MUST cover',
  '  the required constructions; missing coverage causes rejection.',
  '- Target words & ratio: include EVERY requested target word at least once, copying its',
  '  masteryDensity, so the new/review balance matches newWordRatio.',
  '- For contentType = "listening_scene", write a realistic listening transcript rather than',
  '  expository prose. Treat each sentence object as one subtitle/utterance, set speakerId on every',
  '  utterance, keep turns short enough to follow by ear, and include natural spoken features',
  '  (brief acknowledgements, clarification, short pauses implied by punctuation) without heavy dialect spelling.',
  '  radio_news = anchor/report format; street_interview = interviewer plus multiple short answers;',
  '  podcast_dialogue = host/guest exchange; public_announcement = clear public-service announcement;',
  '  casual_conversation = informal everyday small talk between two friends (contractions, casual',
  '  register, natural back-and-forth turns); tv_broadcast = TV news programme in a formal broadcast',
  '  register where a studio anchor hands off to a field reporter and back.',
  '  Accents are handled by TTS voices, so keep the transcript standard and readable.',
  '',
  'Writing quality (as binding as the constraints above — a flat, mechanical passage is a FAILED',
  'passage):',
  '- Write natural, native-like prose: vary sentence openings, keep one coherent narrative voice and',
  '  a register that fits the intent, and connect sentences with appropriate discourse markers',
  '  (however, meanwhile, as a result, on the other hand) so the text reads as authored prose,',
  '  not a disguised word list.',
  '- Idiomatic language quota: weave in at least `idiomQuota` (given in the request) DIFFERENT',
  '  high-frequency idioms or phrasal verbs that fit the intent and are understandable at the',
  '  requested CEFR level (e.g. B1: "come up with", "in the long run"; B2+: "take ... into account",',
  '  "get to grips with"). Prefer items a learner will meet again in real texts; avoid rare,',
  '  regional, or dated idioms.',
  '- Formulaic language: every intent has conventional set phrases native speakers reach for. Include',
  '  at least `setPhraseQuota` (given in the request) of them, chosen to fit the text type, and',
  '  self-report each in expressionSpans with category "set_phrase". Set phrases must appear where',
  '  they naturally belong — a greeting opens a letter, an announcement formula opens an',
  '  announcement, a closing formula ends an e-mail. Do NOT sprinkle them at random.',
  '- Self-report every idiom / phrasal verb / set phrase you deliberately used: add one entry to',
  '  expressionSpans with { span, surface (the tokens joined, verbatim), category: "idiom" |',
  '  "phrasal_verb" | "set_phrase", meaningJa (a short natural Japanese gloss) }. These spans are',
  '  validated; missing or under-quota expressionSpans cause rejection and regeneration.',
  '- Collocations: actively REUSE each target word\'s supplied core.collocations in the passage —',
  '  a learner needs to see the word in its natural phrases. For every collocation you weave in, add',
  '  a collocationSpan covering exactly its tokens, with headWordId = that word\'s wordId and',
  '  collocationId = copy the collocation\'s id (or, for legacy word data whose collocations are',
  '  plain strings, the collocation string itself) verbatim from that word\'s supplied',
  '  core.collocations — never invent one. Every target word that has supplied collocations MUST',
  '  appear inside at least one of them.',
  '- collocationSpan.surface: the collocation AS YOU WROTE IT in the passage, copied VERBATIM — the',
  '  COMPLETE contiguous phrase including the slot filler and any words inside it (articles,',
  '  adjectives): pattern "accept ＜提案・招待＞" realized as "accept the new proposal" -> surface',
  '  "accept the new proposal", never just "accept". The app re-derives the highlight range from',
  '  this string, so a truncated surface mis-highlights the passage.',
  '',
  'Paragraph structure: split the passage into natural paragraphs of 2-5 sentences each, following',
  'the discourse flow (introduction, development, turn, conclusion). Set "paragraphIndex" on every',
  'sentence, starting at 0 and incrementing by 1 at each paragraph break. Never put every sentence in',
  'its own paragraph, and never return more than 6 sentences as a single paragraph.',
  '',
  'When target words ARE requested, collocationSpans should be NON-empty (use the supplied',
  'core.collocations). Leave noticeCues an EMPTY array — in-passage "notice" insights are added by a',
  'SEPARATE annotation step, not here. With no target words, write a coherent themed passage with',
  'empty targetSpans/collocationSpans/noticeCues, but STILL meet the idiom/set-phrase quotas and',
  'self-report them in expressionSpans.',
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
  const readabilityLevel = req.readabilityLevel ?? readabilityForCefr(req.level);
  const request = {
    level: req.level,
    intent: req.intent,
    contentType: req.contentType,
    readabilityLevel,
    approxWords: req.wordTarget,
    newWordRatio: req.newWordRatio,
    // Idiom / set-phrase quotas the Writing-quality block references (B-1 / B-2).
    idiomQuota: idiomQuotaFor(req.wordTarget),
    setPhraseQuota: setPhraseQuotaFor(req.wordTarget),
    listeningOptions: req.listeningOptions ?? null,
    targetWords: targets,
    // Sub-band position + concrete exam goal within the CEFR band (A-3-1); omitted when absent.
    ...(req.levelDetail ? { levelDetail: req.levelDetail } : {}),
  };
  const lines = [
    'Generate one PassageOutput JSON that satisfies ALL of these constraints:',
    JSON.stringify(request, null, 2),
  ];
  const examBias = EXAM_INTENTS[req.intent];
  if (examBias) {
    lines.push('', `This is an exam-prep passage: prioritize high-frequency vocabulary and formats for ${examBias}.`);
  }
  // Inject the intent's set-phrase suggestions right after the exam bias (B-2), mirroring examBias.
  const setPhraseHints = SET_PHRASE_HINTS[req.intent];
  if (setPhraseHints && setPhraseHints.length > 0) {
    lines.push(
      '',
      'Set-phrase suggestions for this intent (illustrative, not exhaustive — you may use others that ' +
        `fit better): ${setPhraseHints.map((h) => `"${h}"`).join(', ')}`,
    );
  }
  // Sub-band calibration (A-3-1): only meaningful when levelDetail is present.
  if (req.levelDetail) {
    lines.push(
      '',
      'Calibrate difficulty WITHIN the CEFR band using levelDetail.subBand:',
      '"low" = the bottom third of the band, "mid" = the middle, "high" = the top third,',
      'with vocabulary and syntax approaching the next band up. levelDetail.examLabel names',
      'the learner\'s concrete goal (e.g. "TOEIC 900"): a B2 request with subBand "high"',
      'must read clearly harder than a plain B2 text — use upper-B2 lexis, occasional C1',
      'words in transparent contexts, and denser clause structure, while staying below C1',
      'overall.',
    );
  }
  if (req.contentType === 'listening_scene' && req.listeningOptions) {
    lines.push(
      '',
      'Listening-scene requirements:',
      `- sceneKind: ${req.listeningOptions.sceneKind}`,
      `- target accent for TTS voices: ${req.listeningOptions.accent}`,
      `- ambient noise level: ${req.listeningOptions.noiseLevel}`,
      '- Use stable speakerId values such as "anchor", "reporter", "interviewer", "host", "guest_1",',
      '  "guest_2", "friend_1", "friend_2", "announcer".',
      '- Every sentence object MUST include a non-null speakerId.',
    );
  }
  if (req.storyContext) {
    lines.push(
      '',
      'This passage is STORY PROSE, not a plan. Write the requested chapter body only.',
      'Keep it consistent with this plot and prior context (reuse the same characters and setting;',
      'continue the plot beat for this chapter; do NOT copy any source text verbatim):',
      JSON.stringify(
        {
          storyTitleJa: req.storyContext.plan.titleJa,
          contentType: req.storyContext.plan.contentType,
          chapterIndex: req.storyContext.chapterIndex,
          synopsisJa: req.storyContext.plan.synopsisJa,
          characters: req.storyContext.plan.characters,
          chapter: req.storyContext.plan.chapters.find((c) => c.index === req.storyContext!.chapterIndex),
          priorSummaryJa: req.storyContext.priorSummaryJa ?? '',
        },
        null,
        2,
      ),
    );
  }
  // Chunked long-form continuation (B-5 第2弾): this passage is one SEGMENT of a longer piece split
  // across sequential requests. Tell the model where it sits and hand it a Japanese summary of what
  // came before so the segments read as one continuous piece instead of N restarts.
  if (req.continuationContext) {
    const cc = req.continuationContext;
    if (cc.segmentIndex === 0) {
      lines.push(
        '',
        `This is the OPENING section (1 of ${cc.segmentCount}) of one longer, continuous piece. Establish` +
          ' the topic, setting and voice and leave room to develop — do NOT wrap up or conclude the whole' +
          ' piece; a later section continues it. Write ONLY this section (about approxWords words).',
      );
    } else {
      const closing =
        cc.segmentIndex + 1 === cc.segmentCount
          ? ' As the FINAL section, bring the piece to a natural, satisfying close.'
          : '';
      lines.push(
        '',
        `This is SECTION ${cc.segmentIndex + 1} of ${cc.segmentCount} of one longer, continuous piece.` +
          ' Continue seamlessly from where the previous section ended: keep the same topic, setting,' +
          ' characters/entities, register and narrative voice, and do NOT restart, re-introduce, or repeat' +
          ` earlier content. Write ONLY this section (about approxWords words).${closing}`,
        'Japanese summary of the piece so far (for continuity — do not translate or quote it):',
        cc.priorSummaryJa,
      );
    }
  }
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
  'phrase',
  'connotation',
  'register',
  'grammar_pattern',
  'sentence_structure',
  'usage',
  'etymology',
  'semantic_network',
  'synonym_nuance',
  'word_family',
  'frequency',
  'common_error',
  'metaphor',
  'memory_tip',
] as const;

/**
 * JSON Schema for the annotation reply: a flat list of location-anchored notice cues plus sentence-
 * level syntax notes (C-4). Strict-mode shape: every property is `required`; optionals are nullable
 * (`detailJa`, `anchorTextParts`).
 */
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
          // 本文中での意味: what the expression means AT THIS SPOT in the passage (shown FIRST in
          // the study guide). Null only for categories where a meaning gloss is beside the point.
          meaningJa: { type: ['string', 'null'] },
          explanationJa: { type: 'string' },
          // C-1 annotation side: a deeper origin/parse explanation, null unless the cue category
          // warrants one (idiom / metaphor / grammar_pattern / sentence_structure).
          detailJa: { type: ['string', 'null'] },
          // C-4 discontinuous expression: the ordered contiguous parts (each copied verbatim) when the
          // expression is split (e.g. "no sooner ... than"); null for a contiguous expression.
          anchorTextParts: { type: ['array', 'null'], items: { type: 'string' } },
        },
        required: ['span', 'category', 'anchorText', 'meaningJa', 'explanationJa', 'detailJa', 'anchorTextParts'],
      },
    },
    // C-4 sentence-level syntax notes for hard-to-parse sentences.
    sentenceNotes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sentenceIndex: { type: 'integer' },
          patternNameJa: { type: 'string' },
          structureJa: { type: 'string' },
          readingJa: { type: 'string' },
          chunks: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                tokenStart: { type: 'integer' },
                tokenEnd: { type: 'integer' },
                roleJa: { type: 'string' },
              },
              required: ['tokenStart', 'tokenEnd', 'roleJa'],
            },
          },
        },
        required: ['sentenceIndex', 'patternNameJa', 'structureJa', 'readingJa', 'chunks'],
      },
    },
  },
  required: ['noticeCues', 'sentenceNotes'],
} as const;

const ANNOTATION_SYSTEM = [
  'You annotate an already-written English reading passage for Japanese learners. You receive the',
  'passage as sentences of TOKENS (one word / punctuation mark / clitic per token, joined with',
  'deterministic spacing) and reply with a SINGLE JSON object {"noticeCues":[...],"sentenceNotes":[...]}',
  'matching the schema — no prose, no markdown, no code fences.',
  '',
  'Find EVERY expression in the passage a learner should pause on, across these categories:',
  'collocation, idiom, phrasal_verb, phrase, connotation, register, grammar_pattern,',
  'sentence_structure, usage, etymology, semantic_network, synonym_nuance, word_family, frequency,',
  'common_error, metaphor, memory_tip. Be thorough but selective — explain the most useful cues.',
  'For each, add a cue:',
  '- anchorText: the EXACT word(s) in the passage the note is about, copied VERBATIM from that',
  "  sentence's tokens (the joined surface). It MUST appear verbatim in the passage.",
  '- ANCHOR RANGE (critical — a wrong range confuses the study guide): anchorText covers the COMPLETE',
  '  expression the note is about and NOTHING MORE. For a collocation, the full phrase as written',
  '  (verb + object with its article/adjectives: "accept the new proposal", not "accept"); for an',
  '  idiom or phrasal verb, its complete form as it appears; NEVER a lone fragment of a multi-word',
  '  expression, and NEVER a whole clause or sentence around it (whole-sentence anchors are for',
  '  sentence_structure cues only). Trailing punctuation stays out of the anchor.',
  '- span: { sentenceIndex, tokenStart, tokenEnd } (half-open) for those tokens. Do NOT agonize over',
  '  exact indices — the app re-derives the span from anchorText — but point at the right sentence.',
  '- category: the single best fit from the list above.',
  '- meaningJa: 本文中での意味 — what this expression means AT THIS SPOT in the passage, as one short',
  '  natural Japanese gloss/paraphrase (~10-25 characters), e.g. idiom "break the ice" in a meeting',
  '  scene -> 「場の緊張をほぐす」, phrasal_verb "carry out" with an experiment -> 「(実験を)実施する」.',
  '  Learners read meaningJa FIRST, before any usage insight, so it must let them re-read the sentence',
  '  and understand it. REQUIRED (non-null) for collocation / idiom / phrasal_verb / phrase / metaphor /',
  '  usage / connotation cues; for the other categories set null when a gloss adds nothing.',
  '- explanationJa: ONE plain-text Japanese sentence written in the EXPLANATION STYLE below (the actionable usage insight; the in-context meaning already lives in meaningJa — do not repeat it).',
  '',
  `EXPLANATION STYLE (explanationJa) — every cue's explanationJa must read like these six models (the 'category "expr" ->' prefix is CONTEXT, not part of the field; output only the Japanese after the arrow):`,
  'collocation "leverage + reputation" -> 目的語には活かせる資産（reputation / resources / network）が来る。',
  'connotation "restless" -> 単に動いて落ち着かないではなく、不安・苛立ちを含む否定的な響き。',
  'register "concede" -> 日常の give in よりフォーマル。会議・交渉で自然。',
  'idiom "break the ice" -> 直訳ではなく「場の緊張をほぐす」固定表現。初対面や会議の冒頭で使う。',
  'phrasal_verb "carry out" -> 実行するの意味で、目的語は計画系（plan / experiment / order）。',
  'phrase "in terms of" -> 観点を切るフレーズ。名詞句を続けて話題を整理する。',
  'grammar_pattern "no sooner ... than" -> 過去完了＋倒置で「〜するやいなや」。書き言葉寄りの硬い表現。',
  'sentence_structure "Although ..., ..." -> 譲歩を先に置くので、主張は後半に来ると意識すると読みやすい。',
  'etymology "portable" -> port は「運ぶ」。export / transport と同じ根で覚えやすい。',
  'semantic_network "purchase" -> buy より硬め。同じ上位概念は「買う」で、反対は sell。',
  'synonym_nuance "rapid" -> fast より硬めで、変化・成長など抽象名詞にも合う。',
  'word_family "analysis" -> 動詞 analyze、形容詞 analytical とセットで覚える。',
  'frequency "issue" -> 頻出語。問題・発行・論点の複数義を文脈で切り替える。',
  'common_error "discuss" -> about を直後に置かず、discuss the issue の形にする。',
  'metaphor "grasp an idea" -> 物をつかむ比喩から「理解する」へ広がる。',
  'memory_tip "resilient" -> re-（戻る）＋跳ね返るイメージで「回復して戻る力」と覚える。',
  'LENGTH: one short sentence (a second only if essential), ~20-45 Japanese characters, NOT counting parenthetical English example words. No preamble (drop これは…/ここでは…), no labels.',
  'PLAIN JAPANESE TEXT ONLY: it renders raw in a tiny 12.5px box with zero parsing — emit no markdown, no asterisks/bold, no HTML, no bullet markers, no code fences (「」 are fine as plain delimiters).',
  `DON'T restate the dictionary meaning; give the insight meaning alone can't: what fills the slot, which register/situation, why the sentence structure is easy/hard to read, a memory hook, or the contrast with a real alternative. For idiom/grammar_pattern, explanationJa gives only the minimal non-literal twist, never a full gloss (the full explanation goes in detailJa below).`,
  'BE CONCRETE BUT TRUE: name 2-3 real example words in parens (X / Y / Z) or a real alternative word; only cite collocates/register/situations you are confident are standard for THIS expression — never invent them to fill the slot, and when unsure prefer hedged framing (多くの場合) over absolutes like 必ず.',
  '',
  'detailJa (idiom / metaphor / grammar_pattern / sentence_structure cues only; null otherwise): 1-3',
  'plain Japanese sentences, up to ~120 characters, expanding the cue. For idiom and metaphor explain',
  'WHY it means what it means: literal image -> metaphorical bridge -> current meaning, plus the typical',
  'situation. For grammar_pattern and sentence_structure explain how to parse the sentence. detailJa is',
  'shown only when the learner expands the cue, so explanationJa stays one short sentence; keep the',
  '"minimal non-literal twist" rule for explanationJa only. Set detailJa to null for every other cue.',
  '',
  'DISCONTINUOUS expressions: if the expression is split (e.g. "no sooner ... than", "not only ... but',
  'also", a separated phrasal verb), set anchorText to the FIRST contiguous part and set anchorTextParts',
  'to EVERY contiguous part copied verbatim, in reading order (the first part included). The app',
  'highlights and links all parts with one badge. For a contiguous expression set anchorTextParts to null.',
  '',
  'REQUIRED COVERAGE: the user message may list expressions already highlighted in the reading UI',
  '(study words, collocations, and self-reported idioms / phrasal verbs / set phrases). You MUST',
  'output exactly one cue for EACH listed expression — these are mandatory and OVERRIDE the',
  'annotation budget caps below. Use category "collocation" for the (collocation) items; use the',
  'shown category for the (idiom) / (phrasal_verb) / (phrase) items; for (word) items pick the single',
  'most useful category for that word and give its key usage insight (skip none, even if the insight',
  'is modest).',
  '',
  'Quality bar: beyond the required items, add other high-confidence, pedagogically worthwhile finds',
  'at or above the requested CEFR level. Skip transparent, trivial sequences ("go to", "in the").',
  'Annotation budget: beyond the mandatory cues (one per study word and one per collocation of a',
  'study word), add a standalone noticeCue ONLY where it teaches something a learner at the target',
  'CEFR level would plausibly miss. Hard caps: at most ONE standalone cue per sentence, and at most',
  'ceil(wordCount / 40) standalone cues per passage. When candidates compete, prefer (1) idioms and',
  'set phrases, (2) collocations, (3) register or connotation notes, in that order. Never annotate',
  'expressions that are transparent at the target level.',
  '',
  'SENTENCE STRUCTURE NOTES: besides noticeCues, output "sentenceNotes" — one entry for EVERY sentence',
  'a CEFR reader at the passage level would find hard to parse: long subordination, inversion,',
  'participial clauses, cleft sentences, nested relatives, heavy noun phrases. The user message states',
  'the passage readability and may list HARD SENTENCES the writer deliberately made complex; when',
  'readability is "advanced" you MUST cover every listed hard sentence with a note. Each entry:',
  '- sentenceIndex (the index shown for that sentence).',
  '- patternNameJa: short Japanese label of the construction (e.g. 「倒置（否定副詞句＋助動詞前置）」).',
  '- structureJa: 1-3 Japanese sentences on how the sentence is built — where the main subject and verb',
  '  are, what each clause does, and why the sentence is easy to misread.',
  '- readingJa: the natural decoding order as an arrow chain over meaning chunks, pairing the English',
  '  chunk with its Japanese sense (e.g. 「No sooner had the meeting started → 会議が始まるやいなや /',
  '  than the alarm rang → 警報が鳴った」).',
  '- chunks: [{ tokenStart, tokenEnd, roleJa }] labelling 主語 / 述語動詞 / 従属節 / 挿入句 over that',
  "  sentence's tokens (half-open ranges; tokenStart/tokenEnd index that sentence's own token array).",
  'Do NOT add notes for plainly simple sentences. If no sentence is hard, output "sentenceNotes": [].',
].join('\n');

/** Canonical surface of a token range (clitics/punctuation joined like the body text). */
function surfaceOf(sentence: Sentence, start: number, end: number): string {
  const tokens = sentence.tokens.slice(start, end);
  return tokenizer.renderText({ tokens, translationJa: '' }).trim();
}

interface CoverItem {
  sentenceIndex: number;
  tokenStart: number;
  anchorText: string;
  kind: 'collocation' | 'word' | 'idiom' | 'phrasal_verb' | 'phrase';
}

/** Expression category → annotation-cue category. "set_phrase" maps to "phrase" (no such cue category). */
const EXPRESSION_COVER_KIND: Record<ExpressionCategory, CoverItem['kind']> = {
  idiom: 'idiom',
  phrasal_verb: 'phrasal_verb',
  set_phrase: 'phrase',
};

/**
 * The expressions the reading UI already marks (collocation tints + study-word underlines), distilled
 * into a required-coverage list. A study word wholly inside a listed collocation is dropped (the
 * collocation cue already covers that region), so we never require both "leverage" and the chip
 * "leverage our reputation".
 */
function buildCoverage(req: PassageAnnotationRequest): CoverItem[] {
  // When annotating a slice (F-6 chunk), spans keep their ABSOLUTE sentenceIndex but `req.sentences`
  // is the slice, so index into it with `sentenceIndex - base`. base is 0 for a whole-passage request.
  const base = req.sentenceIndexBase ?? 0;
  const colls = req.collocationSpans ?? [];
  const items: CoverItem[] = [];
  for (const c of colls) {
    const sent = req.sentences[c.sentenceIndex - base];
    if (!sent) continue;
    items.push({
      sentenceIndex: c.sentenceIndex,
      tokenStart: c.tokenStart,
      anchorText: surfaceOf(sent, c.tokenStart, c.tokenEnd),
      kind: 'collocation',
    });
  }
  for (const t of req.targetSpans ?? []) {
    const sent = req.sentences[t.sentenceIndex - base];
    if (!sent) continue;
    const insideColl = colls.some(
      (c) => c.sentenceIndex === t.sentenceIndex && c.tokenStart <= t.tokenStart && t.tokenEnd <= c.tokenEnd,
    );
    if (insideColl) continue;
    items.push({
      sentenceIndex: t.sentenceIndex,
      tokenStart: t.tokenStart,
      anchorText: t.surface || surfaceOf(sent, t.tokenStart, t.tokenEnd),
      kind: 'word',
    });
  }
  // Self-reported idioms / phrasal verbs / set phrases (B-1 / B-2) also become mandatory cues, so
  // every woven-in expression is explained. Drop ones already covered by a collocation region or an
  // identical earlier anchor to avoid requiring the same note twice.
  for (const e of req.expressionSpans ?? []) {
    const sent = req.sentences[e.span.sentenceIndex - base];
    if (!sent) continue;
    const anchorText = surfaceOf(sent, e.span.tokenStart, e.span.tokenEnd) || e.surface;
    const insideColl = colls.some(
      (c) =>
        c.sentenceIndex === e.span.sentenceIndex &&
        c.tokenStart <= e.span.tokenStart &&
        e.span.tokenEnd <= c.tokenEnd,
    );
    if (insideColl) continue;
    const dup = items.some(
      (it) => it.sentenceIndex === e.span.sentenceIndex && it.anchorText.toLowerCase() === anchorText.toLowerCase(),
    );
    if (dup) continue;
    items.push({
      sentenceIndex: e.span.sentenceIndex,
      tokenStart: e.span.tokenStart,
      anchorText,
      kind: EXPRESSION_COVER_KIND[e.category],
    });
  }
  return items.sort((a, b) => a.sentenceIndex - b.sentenceIndex || a.tokenStart - b.tokenStart);
}

/**
 * Extra system guidance for a chunked (sliced) annotation request (F-6 本命). Appended only when the
 * request carries a `sentenceIndexBase`, so the model preserves absolute indices across the parallel
 * slices and never bleeds annotations into sentences it wasn't given.
 */
const ANNOTATION_SLICE_GUIDANCE = [
  'You are receiving a CONTIGUOUS SLICE of a longer passage. The sentenceIndex values given are',
  'absolute indices within the full passage — copy them into your cues exactly as given, never',
  'renumber from zero. Annotate ONLY the sentences provided in this request; do not refer to or',
  'invent sentences outside the slice.',
].join('\n');

export function buildAnnotationMessages(req: PassageAnnotationRequest): { system: string; user: string } {
  // A chunked request numbers its sentences from the absolute base so the model quotes absolute
  // indices (see ANNOTATION_SLICE_GUIDANCE); a whole-passage request keeps base 0 (numbering from 0).
  const chunked = req.sentenceIndexBase !== undefined;
  const base = req.sentenceIndexBase ?? 0;
  const sentences = req.sentences.map((s, i) => ({ sentenceIndex: base + i, tokens: s.tokens }));
  const coverage = buildCoverage(req);
  const coverageBlock = coverage.length
    ? [
        '',
        'REQUIRED COVERAGE — output exactly one cue for EACH (anchorText copied verbatim), in addition to other finds:',
        ...coverage.map((c) => `- s${c.sentenceIndex}: "${c.anchorText}" (${c.kind})`),
      ].join('\n')
    : '';
  // C-4: tell the annotator the readability band and which sentences the writer deliberately made hard
  // (from the generator's self-reported syntaxSpans) so it produces the required sentenceNotes.
  const readability = req.readabilityLevel;
  const hard = (req.hardSentenceIndexes ?? []).filter((i) => i >= base && i < base + req.sentences.length);
  const syntaxBlock = readability
    ? [
        '',
        `Passage readability: ${readability}.`,
        hard.length
          ? `HARD SENTENCES (writer-flagged, cover each with a sentenceNote): ${hard.map((i) => `s${i}`).join(', ')}.`
          : 'No sentences were writer-flagged as hard; add sentenceNotes only where you judge parsing is genuinely difficult.',
      ].join('\n')
    : '';
  const user = [
    `Passage CEFR level: ${req.level}.`,
    'Annotate this passage exhaustively. Reply with {"noticeCues":[...],"sentenceNotes":[...]} only.',
    JSON.stringify({ sentences }, null, 2),
    coverageBlock,
    syntaxBlock,
  ]
    .filter(Boolean)
    .join('\n');
  const system = chunked ? `${ANNOTATION_SYSTEM}\n\n${ANNOTATION_SLICE_GUIDANCE}` : ANNOTATION_SYSTEM;
  return { system, user };
}

/**
 * Output-token budget for one annotation request, scaling with the sentence count of THAT request.
 * The old Math.min(4000, …) cap flat-lined around 24 sentences, so long passages truncated to an
 * empty cue array and shipped with silent「気づき」loss.
 *
 * F-6 本命 re-estimate: `annotatePassage` now splits passages over ANNOTATION_CHUNK_SENTENCES (20)
 * into parallel slices, so `sentenceCount` here is bounded to ≤20 per request and this budget yields
 * ~4800 tokens per chunk — comfortably above the ~120-tokens-per-cue × (≤one standalone/sentence +
 * required coverage) an exhaustive 20-sentence slice needs. The 16000 ceiling and per-sentence slope
 * are retained as headroom for the whole-passage (≤20-sentence) path and any single oversized chunk;
 * truncation is no longer catastrophic because max_tokens replies are salvaged (partial recovery).
 */
export function annotationMaxTokens(sentenceCount: number): number {
  return Math.min(16000, 800 + sentenceCount * 200);
}

const WORD_SYSTEM = [
  'You are a bilingual (English/Japanese) lexicographer for a vocabulary-learning app. Reply with',
  'a single JSON object matching the WordData schema — no prose, no markdown, no code fences.',
  'meaningsJa and example.ja are in Japanese; examples[].en are natural English sentences using',
  'the word. register is one of formal/neutral/casual/academic/business/slang. connotation is a',
  'short Japanese note. frequency is 1 (rare) to 5 (very common). Provide 1-3 meanings and 1-2',
  'examples. core.synonymNuances MUST be written in Japanese; include the',
  'compared word/expression and explain the practical difference in plain Japanese, not English.',
  '- collocations: 3-6 entries of { "id", "pattern", "type", "slotExamples", "glossJa", "exampleEn",',
  '  "l1Contrast" }. id is a stable kebab-case slug of the pattern (e.g. "accept-proposal"). pattern',
  '  shows the headword plus a slot in fullwidth angle brackets naming the semantic category of the',
  '  filler in Japanese, e.g. "accept ＜提案・招待＞" or "＜経済が＞ recover". type is one of',
  '  V+N / Adj+N / N+of+N / V+Prep / Adv+V / other. slotExamples: 2-4 real high-frequency English',
  '  fillers for that slot (offer / invitation / proposal). Only include combinations you are',
  '  confident are standard high-frequency English — never invent fillers. Set l1Contrast true when',
  '  the natural Japanese rendering differs from the literal word-for-word translation (e.g. strong',
  '  coffee = 濃いコーヒー), and put the contrast into glossJa.',
  'Provide 1-3 memoryTips: short Japanese memory hooks that make the word easier to remember.',
  'Prefer etymology, concrete image, natural collocation, synonym contrast, sound/spelling cue, or',
  'common mistake avoidance. Do NOT invent forced puns or unnatural mnemonics.',
  'If a memoryTip uses etymology, it MUST name the original spelling, language/source, original',
  'meaning, and the semantic bridge to the current meaning. Example shape: "coach は古い語形 X',
  '（〜語で「乗り物」）から、乗り物が人を目的地へ運ぶ → 人を目標へ導く人、という比喩で覚える。"',
  'Also fill "more" as richly as the word allows — these power the in-passage "notice" insights:',
  '- etymology: { "parts", "bridgeJa", "cognates", "sourceJa" }. parts decompose the headword',
  '  morphologically in order; "surfaceIn" is the exact substring of the headword that part',
  '  corresponds to (null if sound change obscured it); "meaningJa" is the Japanese meaning of that',
  '  part. bridgeJa MUST compose the parts into the modern sense as one arrow chain, e.g. for',
  '  "resilient": 「re-（再び）+ sili（跳ぶ ← ラテン語 salire）+ -ent（〜の性質）→ 跳ね返って元に戻る',
  '  → 回復力がある」. cognates: 2-5 words sharing the root, preferring common words the learner',
  '  likely knows (for spect: inspect / respect / spectator), each with a noteJa linking it to the',
  '  shared root. sourceJa names the source language/form. If the origin is uncertain set parts to []',
  '  and say so in bridgeJa — never invent.',
  '- semanticNetwork: a flat array of { "word", "relation", "noteJa" } with relation one of',
  '  synonym / antonym / hypernym / hyponym / related. noteJa (<=25 Japanese chars) states how the',
  '  word relates to or differs from the headword (nuance, register, or scope). [] if none. Do NOT',
  '  list a word without a noteJa.',
  '- wordFamily: derived forms / part-of-speech variants (e.g. ["decision","decisive"]).',
  '- grammarPatterns: typical constructions (e.g. ["depend on N","it depends whether ..."]).',
  '- commonErrors: mistakes Japanese learners typically make with this word.',
  '- idioms: 0-4 entries, only genuinely common fixed expressions containing the headword. Each entry:',
  '  { "expression", "meaningJa", "originJa", "exampleEn", "exampleJa" }. originJa MUST bridge the',
  '  literal image to the idiomatic meaning in 1-2 Japanese sentences: literal reading -> metaphorical',
  '  shift -> current meaning. Example for "break the ice": 「船が氷を割って航路を開くイメージ → 固まった',
  '  場の空気を最初に壊す → 「場の緊張をほぐす」の意味に。」 If the true origin is uncertain, give the',
  '  standard folk explanation hedged with 「〜と言われる」— NEVER invent a confident false etymology.',
  "- metaphor: a short Japanese note on the headword's metaphorical sense, or null if it has none.",
  'Use [] for arrays and null for scalars/objects that genuinely do not apply — never invent.',
  'The `memoryTips` (1-3 items) and `more.etymology` (with a non-empty bridgeJa) are REQUIRED — never',
  'return null or omit them. Write bridgeJa, every part meaningJa, every idiom originJa, every',
  "collocation glossJa, and every synonymNuances entry in Japanese, explicitly connecting each",
  "morpheme to the headword's form and meaning.",
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

// ── Story plan (Requirement 6.2 / 13.2) ──────────────────────────────────────

/** JSON Schema for a StoryPlan reply (characters, synopsis, chapters). */
export const STORY_PLAN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    titleJa: { type: 'string' },
    synopsisJa: { type: 'string' },
    characters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          role: { type: 'string' },
          descriptionJa: { type: 'string' },
        },
        required: ['name', 'role', 'descriptionJa'],
      },
    },
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'integer' },
          headingJa: { type: 'string' },
          beatJa: { type: 'string' },
        },
        required: ['index', 'headingJa', 'beatJa'],
      },
    },
  },
  required: ['titleJa', 'synopsisJa', 'characters', 'chapters'],
} as const;

const STORY_PLAN_SYSTEM = [
  'You are a story architect for a Japanese-audience English reading app. Given a story type, genre',
  'and optional homage, you design a story PLAN — NOT the prose. Reply with a single JSON object',
  'matching the StoryPlan schema — no prose, no markdown, no code fences. All human-readable fields',
  '(titleJa, synopsisJa, character descriptionJa, chapter headingJa/beatJa) are written in Japanese.',
  '',
  '- characters: a small cast (2-5) with a name, a role, and a short Japanese description each.',
  '  Make each character memorable and visually distinctive: include a clear personality hook plus',
  '  one signature motif/color/prop/silhouette detail that can carry through to illustrations.',
  '- synopsisJa: a 2-4 sentence Japanese plot summary consistent with the genre.',
  '- chapters: a short story has EXACTLY ONE chapter (index 0); a long story has several (index 0..n)',
  '  each with a Japanese heading and a one-line beat describing what happens.',
  '',
  'HOMAGE (copyright): when a homage work is named, you may echo only its STYLE and MOTIFS. You MUST',
  'invent original characters and plot — never reuse the source work\'s proper nouns, character names,',
  'or its actual events, and never reproduce its text.',
].join('\n');

export function buildStoryPlanMessages(req: {
  contentType: 'short_story' | 'long_story';
  genre: string;
  homageTitle?: string;
  intent: string;
  level: string;
}): { system: string; user: string } {
  const ask = {
    contentType: req.contentType,
    genre: req.genre,
    homage: req.homageTitle ?? null,
    intent: req.intent,
    level: req.level,
    chapters: req.contentType === 'short_story' ? 1 : 'several (3-6)',
  };
  return {
    system: STORY_PLAN_SYSTEM,
    user: `Design a StoryPlan for this request:\n${JSON.stringify(ask, null, 2)}`,
  };
}

/** Output-token budget for a story plan (scaffold only, not prose). */
export function storyPlanMaxTokens(): number {
  return 1600;
}

/** JSON Schema for extending a StoryPlan with additional future chapter beats. */
export const STORY_PLAN_EXTENSION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    synopsisJa: { type: 'string' },
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'integer' },
          headingJa: { type: 'string' },
          beatJa: { type: 'string' },
        },
        required: ['index', 'headingJa', 'beatJa'],
      },
    },
  },
  required: ['synopsisJa', 'chapters'],
} as const;

const STORY_PLAN_EXTENSION_SYSTEM = [
  'You extend an existing long-story PLAN for a Japanese-audience English reading app.',
  'Reply with a single JSON object matching the StoryPlanExtension schema — no prose, no markdown,',
  'no code fences. All human-readable fields are written in Japanese.',
  '',
  '- Keep the existing title, genre, characters, and established plot facts unchanged.',
  '- Do NOT rewrite existing chapters. Create only future chapter beats starting at nextChapterIndex.',
  '- If the original outline has run out, continue with a coherent new arc that follows from the',
  '  priorSummaryJa and keeps the same central conflict/motifs.',
  '- synopsisJa should be the updated whole-story overview including the new future arc.',
  '',
  'HOMAGE (copyright): when a homage is present, echo only style and motifs. Never reuse source',
  'proper nouns, character names, actual events, or text.',
].join('\n');

function storyPlanForPrompt(plan: StoryPlan): StoryPlan {
  return {
    ...plan,
    characters: plan.characters.map((character) => ({
      name: character.name,
      role: character.role,
      descriptionJa: character.descriptionJa,
    })),
  };
}

export function buildStoryPlanExtensionMessages(req: StoryPlanExtensionRequest): { system: string; user: string } {
  const additionalChapters = Math.max(1, Math.min(req.additionalChapters ?? 3, 6));
  const ask = {
    plan: storyPlanForPrompt(req.plan),
    nextChapterIndex: req.nextChapterIndex,
    priorSummaryJa: req.priorSummaryJa ?? '',
    additionalChapters,
  };
  return {
    system: STORY_PLAN_EXTENSION_SYSTEM,
    user: `Extend this long-story plan with exactly ${additionalChapters} new chapter beats:\n${JSON.stringify(ask, null, 2)}`,
  };
}

/** Output-token budget for plot extension (scaffold only, not prose). */
export function storyPlanExtensionMaxTokens(additionalChapters = 3): number {
  return Math.min(2200, 900 + Math.max(1, additionalChapters) * 260);
}

// ── Illustration prompts ─────────────────────────────────────────────────────

/**
 * Build the English image prompt for one character illustration. The character's Japanese
 * description is passed through verbatim (image models read Japanese; a machine translation would
 * drift), wrapped in a fixed style directive so the whole cast reads as one coherent illustrated
 * set. `styleHint` (the plan's homage note or genre) biases mood/palette without ever reproducing
 * a source work.
 */
export function buildCharacterIllustrationPrompt(req: CharacterIllustrationRequest): string {
  const variant = req.variant ?? 'full_body';
  const style = req.styleHint?.trim() ? ` Overall style/mood: ${req.styleHint.trim()}.` : '';
  const story = [
    req.storyTitleJa ? `Story title (Japanese): ${req.storyTitleJa}.` : '',
    req.storySynopsisJa ? `Story synopsis (Japanese): ${req.storySynopsisJa}.` : '',
    req.castStyleGuide?.trim() ? `Cast consistency guide (Japanese):\n${req.castStyleGuide.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const composition =
    variant === 'portrait'
      ? [
          'Portrait bust composition for a character overview page;',
          'generate a dedicated portrait illustration, not a crop, resize, or reuse of a full-body image;',
          'head and upper torso visible, face clearly readable, signature hair/hat/color/prop cue included;',
          'frame the portrait composition cleanly while never cutting through the face or key identity motif;',
          'simple neutral background; square-friendly centered composition;',
        ]
      : [
          'Full-body character detail illustration;',
          'head-to-toe full body with the entire figure visible; no cropping at head, hands, feet, or props;',
          'show posture, outfit, footwear, silhouette, and signature prop clearly;',
          'single character centered with generous padding; vertical 3:4 composition;',
        ];
  return [
    `${variant === 'portrait' ? 'Portrait' : 'Full-body'} character illustration of "${req.name}", the ${req.role} of a ${req.genre} story.`,
    `Character description (Japanese): ${req.descriptionJa}`,
    story,
    'Maintain the exact same identity across this character\'s portrait and full-body variants: same face shape, hairstyle, eye impression, outfit palette, signature motif, and prop. Keep all cast members visually distinct from each other.',
    'Elegant contemporary anime-inspired character art for adult learners; polished, restrained, and not photorealistic;',
    'memorable silhouette; expressive face; signature outfit, color accent, or prop from the description;',
    ...composition,
    'clean graphic shapes; rich but controlled colors;',
    'avoid storybook style, chibi proportions, childish cuteness, exaggerated moe styling, and noisy fantasy clutter;',
    `soft even lighting; simple neutral background; no text, letters, watermark, or logo.${style}`,
  ]
    .filter(Boolean)
    .join(' ');
}

function renderSentence(sentence: Sentence): string {
  return tokenizer.renderText({ tokens: sentence.tokens, translationJa: '' }).trim();
}

/** Build the English image prompt for one passage-level scene illustration. */
export function buildPassageIllustrationPrompt(req: PassageIllustrationRequest): string {
  const excerpt = req.sentences
    .slice(0, 12)
    .map((sentence, index) => `${index + 1}. ${renderSentence(sentence)}`)
    .join('\n');
  const story = req.story
    ? [
        `Story genre: ${req.story.genre}.`,
        `Story title (Japanese): ${req.story.titleJa}.`,
        `Story synopsis (Japanese): ${req.story.synopsisJa}.`,
        req.story.chapterHeadingJa ? `Chapter heading (Japanese): ${req.story.chapterHeadingJa}.` : '',
        req.story.chapterBeatJa ? `Chapter beat (Japanese): ${req.story.chapterBeatJa}.` : '',
        req.story.characters.length
          ? `Characters (Japanese descriptions): ${JSON.stringify(req.story.characters)}.`
          : '',
        req.story.styleHint?.trim() ? `Overall story style/mood: ${req.story.styleHint.trim()}.` : '',
      ]
        .filter(Boolean)
        .join(' ')
    : 'Standalone article passage; use the concrete setting, people, objects, or action implied by the text.';
  return [
    `Create one polished scene illustration for a CEFR ${req.level} English reading passage.`,
    `Passage title: ${req.title}. Learning intent: ${req.intent}.`,
    story,
    `Passage excerpt:\n${excerpt}`,
    'Show the single most representative moment, setting, or action implied by the passage; no montage, no comic panels, no before/after layout.',
    'If characters are listed, keep their appearance consistent with the descriptions and do not add unlisted main characters.',
    'Elegant contemporary anime-inspired editorial illustration for adult learners; clear foreground focus, readable environment, rich but controlled colors.',
    'Compose with generous safe margins so the important subject, faces, hands, and key objects are fully visible; avoid extreme close-ups, cropped bodies, cropped props, or cut-off edges.',
    'Landscape composition for a reading screen header; no text, letters, captions, UI, watermark, or logo; avoid storybook style, chibi proportions, and childish cuteness.',
  ].join('\n');
}

const SUGGEST_SYSTEM = [
  'You curate vocabulary for a CEFR-graded English reading app whose users are Japanese speakers.',
  'Given a CEFR level and a learning intent (business / daily / toeic / eiken / academic / travel),',
  'propose distinct English words a learner at that level should study next. Choose words that clearly',
  'fit the intent and sit inside the requested CEFR vocabulary band, preferably the upper half of that',
  'band — useful and worth learning,',
  'not trivial function words (the, go, very) and not absurdly rare. For exam intents (toeic / eiken)',
  'prefer that exam\'s high-frequency vocabulary. Each must be a single base-form lemma (no spaces),',
  'lowercase. Never include any word from the exclude list. Reply with JSON {"words":[...]} only —',
  'no prose, no code fences.',
].join('\n');

export function buildSuggestionMessages(req: {
  level: string;
  intent: LearningIntent;
  count: number;
  exclude?: string[];
}): { system: string; user: string } {
  const ask = {
    level: req.level,
    intent: req.intent,
    count: req.count,
    exclude: req.exclude ?? [],
  };
  return {
    system: SUGGEST_SYSTEM,
    user: `Propose exactly ${req.count} lemmas for this request:\n${JSON.stringify(ask, null, 2)}`,
  };
}

// ── Review sentence (C-5c) ───────────────────────────────────────────────────

/** JSON Schema for a single review-context sentence reply. */
export const REVIEW_SENTENCE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { sentence: { type: 'string' } },
  required: ['sentence'],
} as const;

/** A single review sentence is tiny; a small budget avoids padding. */
export const REVIEW_SENTENCE_MAX_TOKENS = 200;

const REVIEW_SENTENCE_SYSTEM = [
  'You write ONE fresh example sentence for a spaced-repetition review card in a CEFR-graded English',
  'reading app for Japanese learners. Given a headword, its CEFR band and (optionally) its intended',
  'Japanese meaning + typical collocations, write a single natural English sentence that uses the',
  'headword (or a correctly inflected form of it) exactly once, in a NEW everyday context that lets the',
  'intended meaning be recovered from context. Keep other vocabulary within the requested CEFR band,',
  'keep it to one sentence of ~8–18 words, and do not gloss or translate. Reply with JSON',
  '{"sentence":"..."} only — no prose, no code fences.',
].join('\n');

export function buildReviewSentenceMessages(req: {
  headword: string;
  level: string;
  meaningJa?: string;
  collocations?: string[];
}): { system: string; user: string } {
  const ask = {
    headword: req.headword,
    level: req.level,
    meaningJa: req.meaningJa ?? '',
    collocations: req.collocations ?? [],
  };
  return {
    system: REVIEW_SENTENCE_SYSTEM,
    user: `Write one review sentence for:\n${JSON.stringify(ask, null, 2)}`,
  };
}
