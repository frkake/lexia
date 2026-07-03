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
  GenerationRequest,
  LearningIntent,
  PassageAnnotationRequest,
  PassageIllustrationRequest,
  Sentence,
  StoryPlan,
  StoryPlanExtensionRequest,
} from '../../src/types/domain';
import { lengthSpec } from '../../src/domain/generation/lengthSpec';
import { tokenizer } from '../../src/domain/tokenizer/joinService';
import { readabilityForCefr } from '../../src/domain/difficulty/levelPreset';

const CEFR = ['A2', 'B1', 'B2', 'C1', 'C2'] as const;
const LEARNING_INTENTS = ['business', 'daily', 'toeic', 'eiken', 'academic', 'travel'] as const;

/** Exam-style intents whose passages should bias toward that exam's high-frequency vocab/format (8.4). */
const EXAM_INTENTS: Partial<Record<LearningIntent, string>> = {
  toeic: 'TOEIC (business correspondence, workplace scenarios, and TOEIC-frequent vocabulary and question-style phrasing)',
  eiken: '英検 (Eiken exam topics, essay/opinion registers, and Eiken-frequent vocabulary)',
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
        },
        required: ['tokens', 'translationJa', 'translationSpans'],
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
        noteJa: { type: ['string', 'null'] },
      },
      required: ['prefix', 'root', 'suffix', 'noteJa'],
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
        collocations: { type: 'array', items: { type: 'string' } },
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
  '  approxWords (aim within ±20%). Roughly one sentence per 12-15 words. Keep writing sentences',
  '  until you reach that word count — do not stop early. meta.approxWords MUST equal the actual',
  '  number of words you wrote.',
  '- Level: keep ALL non-target vocabulary at or below the requested CEFR level; only the listed',
  '  target words may exceed it. Prefer a simpler synonym over a more advanced word.',
  '- Readability: follow the requested readabilityLevel separately from vocabulary level.',
  '  easy = short direct sentences, mostly one main clause, explicit connectors;',
  '  standard = a natural mix of simple/compound/complex sentences;',
  '  advanced = longer sentences may use relative clauses, participial phrases, abstract noun',
  '  phrases, and denser connectors, while remaining coherent for the requested level.',
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
  const readabilityLevel = req.readabilityLevel ?? readabilityForCefr(req.level);
  const request = {
    level: req.level,
    intent: req.intent,
    contentType: req.contentType,
    readabilityLevel,
    approxWords: req.wordTarget,
    newWordRatio: req.newWordRatio,
    targetWords: targets,
  };
  const lines = [
    'Generate one PassageOutput JSON that satisfies ALL of these constraints:',
    JSON.stringify(request, null, 2),
  ];
  const examBias = EXAM_INTENTS[req.intent];
  if (examBias) {
    lines.push('', `This is an exam-prep passage: prioritize high-frequency vocabulary and formats for ${examBias}.`);
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
  'collocation, idiom, phrasal_verb, phrase, connotation, register, grammar_pattern,',
  'sentence_structure, usage, etymology, semantic_network, synonym_nuance, word_family, frequency,',
  'common_error, metaphor, memory_tip. Be thorough but selective — explain the most useful cues.',
  'For each, add a cue:',
  '- anchorText: the EXACT word(s) in the passage the note is about, copied VERBATIM from that',
  "  sentence's tokens (the joined surface). It MUST appear verbatim in the passage.",
  '- span: { sentenceIndex, tokenStart, tokenEnd } (half-open) for those tokens. Do NOT agonize over',
  '  exact indices — the app re-derives the span from anchorText — but point at the right sentence.',
  '- category: the single best fit from the list above.',
  '- explanationJa: ONE plain-text Japanese sentence written in the EXPLANATION STYLE below (the actionable usage insight, not the dictionary meaning).',
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
  `DON'T restate the dictionary meaning; give the insight meaning alone can't: what fills the slot, which register/situation, why the sentence structure is easy/hard to read, a memory hook, or the contrast with a real alternative. For idiom/grammar_pattern give only the minimal non-literal twist, never a full gloss.`,
  'BE CONCRETE BUT TRUE: name 2-3 real example words in parens (X / Y / Z) or a real alternative word; only cite collocates/register/situations you are confident are standard for THIS expression — never invent them to fill the slot, and when unsure prefer hedged framing (多くの場合) over absolutes like 必ず.',
  '',
  'REQUIRED COVERAGE: the user message may list expressions already highlighted in the reading UI',
  '(study words and collocations). You MUST output exactly one cue for EACH listed expression —',
  'these are mandatory and OVERRIDE the readability cap below. Use category "collocation" for the',
  '(collocation) items; for (word) items pick the single most useful category for that word and give',
  'its key usage insight (skip none, even if the insight is modest).',
  '',
  'Quality bar: beyond the required items, add other high-confidence, pedagogically worthwhile finds',
  'at or above the requested CEFR level. Skip transparent, trivial sequences ("go to", "in the"). For',
  'these EXTRA (non-required) cues, aim for at most ~1-2 per sentence so the page stays readable.',
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
  kind: 'collocation' | 'word';
}

/**
 * The expressions the reading UI already marks (collocation tints + study-word underlines), distilled
 * into a required-coverage list. A study word wholly inside a listed collocation is dropped (the
 * collocation cue already covers that region), so we never require both "leverage" and the chip
 * "leverage our reputation".
 */
function buildCoverage(req: PassageAnnotationRequest): CoverItem[] {
  const colls = req.collocationSpans ?? [];
  const items: CoverItem[] = [];
  for (const c of colls) {
    const sent = req.sentences[c.sentenceIndex];
    if (!sent) continue;
    items.push({
      sentenceIndex: c.sentenceIndex,
      tokenStart: c.tokenStart,
      anchorText: surfaceOf(sent, c.tokenStart, c.tokenEnd),
      kind: 'collocation',
    });
  }
  for (const t of req.targetSpans ?? []) {
    const sent = req.sentences[t.sentenceIndex];
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
  return items.sort((a, b) => a.sentenceIndex - b.sentenceIndex || a.tokenStart - b.tokenStart);
}

export function buildAnnotationMessages(req: PassageAnnotationRequest): { system: string; user: string } {
  const sentences = req.sentences.map((s, i) => ({ sentenceIndex: i, tokens: s.tokens }));
  const coverage = buildCoverage(req);
  const coverageBlock = coverage.length
    ? [
        '',
        'REQUIRED COVERAGE — output exactly one cue for EACH (anchorText copied verbatim), in addition to other finds:',
        ...coverage.map((c) => `- s${c.sentenceIndex}: "${c.anchorText}" (${c.kind})`),
      ].join('\n')
    : '';
  const user = [
    `Passage CEFR level: ${req.level}.`,
    'Annotate this passage exhaustively. Reply with {"noticeCues":[...]} only.',
    JSON.stringify({ sentences }, null, 2),
    coverageBlock,
  ]
    .filter(Boolean)
    .join('\n');
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
  'examples, and a few collocations. core.synonymNuances MUST be written in Japanese; include the',
  'compared word/expression and explain the practical difference in plain Japanese, not English.',
  'Provide 1-3 memoryTips: short Japanese memory hooks that make the word easier to remember.',
  'Prefer etymology, concrete image, natural collocation, synonym contrast, sound/spelling cue, or',
  'common mistake avoidance. Do NOT invent forced puns or unnatural mnemonics.',
  'If a memoryTip uses etymology, it MUST name the original spelling, language/source, original',
  'meaning, and the semantic bridge to the current meaning. Example shape: "coach は古い語形 X',
  '（〜語で「乗り物」）から、乗り物が人を目的地へ運ぶ → 人を目標へ導く人、という比喩で覚える。"',
  'Also fill "more" as richly as the word allows — these power the in-passage "notice" insights:',
  '- etymology: prefix/root/suffix when the word has them (else null for that part), plus noteJa.',
  '  noteJa MUST be Japanese and explain what the source form means and how the meaning shifted;',
  '  for borrowed words include the original spelling and language/source when known. If uncertain,',
  '  say the origin is uncertain instead of overclaiming.',
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
 * Build the English image prompt for one full-body character illustration. The character's Japanese description is
 * passed through verbatim (image models read Japanese; a machine translation would drift), wrapped in
 * a fixed style directive so the whole cast reads as one coherent illustrated set. `styleHint` (the
 * plan's homage note or genre) biases mood/palette without ever reproducing a source work.
 */
export function buildCharacterIllustrationPrompt(req: {
  name: string;
  role: string;
  descriptionJa: string;
  genre: string;
  styleHint?: string;
}): string {
  const style = req.styleHint?.trim() ? ` Overall style/mood: ${req.styleHint.trim()}.` : '';
  return [
    `Full-body character illustration of "${req.name}", the ${req.role} of a ${req.genre} story.`,
    `Character description (Japanese): ${req.descriptionJa}`,
    'Elegant contemporary anime-inspired character art for adult learners; polished, restrained, and not photorealistic;',
    'memorable silhouette; expressive face; signature outfit, color accent, or prop from the description;',
    'head-to-toe full body with the entire figure visible; no cropping at head, hands, feet, or props;',
    'clean graphic shapes; rich but controlled colors; single character centered with generous padding;',
    'avoid storybook style, chibi proportions, childish cuteness, exaggerated moe styling, and noisy fantasy clutter;',
    `soft even lighting; simple neutral background; no text, letters, watermark, or logo.${style}`,
  ].join(' ');
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
