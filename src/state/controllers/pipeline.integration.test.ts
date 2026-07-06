// @vitest-environment node
/**
 * Integration tests (task 11.1): the three end-to-end pipelines wired by tasks 10.x, run
 * over REAL collaborators — the generate→validate→repair orchestrator, the token-resolving
 * TTS adapter, the Dexie repositories (fake-indexeddb) and the domain SRS — with only the
 * adjacent network seams (ContentGateway / TtsBackend) stubbed.
 *   A. generation → validation → repair → persist → TTS → reading-ready (staged readiness);
 *   B. review rating → reschedule → log → re-projection → dashboard;
 *   C. Dexie numbered migration + anonymous → userId namespace migration.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { runGenerationPipeline } from './generationController';
import { applyReviewRating } from './reviewController';
import { loadDashboardSnapshot } from './dashboardController';
import { createContainer } from '../../ui/app/container';
import { LexiaDb, SCHEMA_VERSIONS, APP_SCHEMA_VERSION, type SchemaVersion } from '../../infra/persistence/lexiaDb';
import { createRepositories } from '../../infra/persistence/repositories';
import { migrateAnonymousNamespace, ANONYMOUS_USER_ID } from '../../infra/auth/authAdapter';
import { createGenerationOrchestrator } from '../../domain/generation/generationOrchestrator';
import { createWordSuggestionService } from '../../domain/suggestion/wordSuggestionService';
import { TtsSynthesisAdapter, type TtsBackend, type TtsWordMark } from '../../infra/tts/ttsSynthesisAdapter';
import { createSessionStore } from '../stores/sessionStore';
import { createPlayerStore } from '../stores/playerStore';
import { tokenizer } from '../../domain/tokenizer/joinService';
import { DAY_MS } from '../../domain/srs/parameters';
import type { ContentGateway } from '../../types/ports';
import type {
  GenerationRequest,
  IndexedPassage,
  PassageOutput,
  SetupConfig,
  UserId,
  WordData,
  WordSchedulingState,
} from '../../types/domain';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const PASSAGE_ID = 'p1';

const wordData: WordData = {
  wordId: 'deal',
  headword: 'deal',
  ipa: '/diːl/',
  pos: ['noun'],
  register: 'neutral',
  connotation: '肯定的',
  frequency: 4,
  core: { meaningsJa: ['取引'], examples: [{ en: 'close a deal', ja: '取引をまとめる' }], collocations: [{ id: 'close-a-deal', pattern: 'close a deal', type: 'V+N', slotExamples: [], glossJa: '', l1Contrast: false }], synonymNuances: [] },
};

// A simple 8-word filler sentence, repeated so the passage clears the length gate for `length: 'short'`.
const FILLER = ['They', 'met', 'again', 'and', 'talked', 'for', 'a', 'while', '.'];

function validPassage(): PassageOutput {
  return {
    meta: { title: '取引の成立', intent: 'business', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 197 },
    sentences: [
      { tokens: ['We', 'closed', 'the', 'deal', 'today', '.'], translationJa: '今日、取引を成立させた。' },
      // 24 filler sentences (192 words) + the 5-word opener = 197 words, inside the ±25% band
      // [150, 250] for the 200-word SETUP target (LENGTH_WORD_TOLERANCE restored to 0.25 in B-5).
      ...Array.from({ length: 24 }, () => ({ tokens: [...FILLER], translationJa: '彼らは再び会って話した。' })),
    ],
    targetSpans: [{ sentenceIndex: 0, tokenStart: 3, tokenEnd: 4, wordId: 'deal', surface: 'deal', masteryDensity: 'new' }],
    collocationSpans: [{ sentenceIndex: 0, tokenStart: 1, tokenEnd: 4, headWordId: 'deal', collocationId: 'close-deal' }],
    noticeCues: [
      { index: 1, span: { sentenceIndex: 0, tokenStart: 3, tokenEnd: 4 }, category: 'connotation', wordId: 'deal', sourceAttribute: 'connotation', anchorText: 'deal', explanationJa: '前向きな含意。' },
    ],
  };
}

/** Same passage but with a target span out of range → forces one repair round. */
function invalidPassage(): PassageOutput {
  const p = validPassage();
  p.targetSpans = [{ sentenceIndex: 0, tokenStart: 3, tokenEnd: 99, wordId: 'deal', surface: 'deal', masteryDensity: 'new' }];
  return p;
}

const SETUP: SetupConfig = {
  examTarget: { kind: 'eiken', value: '2' },
  intent: 'business',
  newWordRatio: 0.3,
  wordTarget: 200,
  contentType: 'article',
  targetWordIds: ['deal'],
  excludedWordIds: [],
};

/** Word-type speech marks (byte ranges + onset times) for the alphanumeric tokens. */
function marksFor(idx: IndexedPassage): TtsWordMark[] {
  return idx.tokens
    .filter((t) => /[a-zA-Z0-9]/.test(t.text))
    .map((t, i) => ({ start: t.byteStart, end: t.byteEnd, timeMs: i * 300 }));
}

function ttsBackend(marks: TtsWordMark[], synth?: () => Promise<unknown>): TtsBackend {
  return {
    synthesize: synth
      ? (synth as TtsBackend['synthesize'])
      : async () => ({ audioUrl: 'https://cdn.example/p1.mp3', format: 'audio/mpeg', durationMs: 1500, engine: 'polly', marks }),
    wordClipUrl: async () => 'https://cdn.example/word.mp3',
  };
}

let seq = 0;
async function freshDb(prefix = 'itg'): Promise<{ db: LexiaDb; userId: UserId }> {
  const userId = `${prefix}_${seq++}` as UserId;
  const db = new LexiaDb(userId);
  await db.open();
  return { db, userId };
}

// ── A. Generation pipeline (Flow 1) ──────────────────────────────────────────

describe('A. generation → validate → repair → persist → TTS → reading-ready', () => {
  it('repairs an invalid candidate, renders text first, then readies audio (staged)', async () => {
    const { db, userId } = await freshDb('gen');
    const repos = createRepositories(db);
    const session = createSessionStore();
    const player = createPlayerStore();

    let calls = 0;
    const gateway: ContentGateway = {
      async generatePassage() {
        calls += 1;
        return { passage: calls === 1 ? invalidPassage() : validPassage(), stopReason: 'end_turn' };
      },
      async getWordData() {
        return wordData;
      },
    };

    // Pre-index with the same fixed id the pipeline will use → marks resolve byte-exactly.
    const marks = marksFor(tokenizer.index(PASSAGE_ID, validPassage()));
    let releaseAudio!: () => void;
    const gate = new Promise<void>((res) => {
      releaseAudio = res;
    });
    const backend = ttsBackend(marks, async () => {
      await gate; // hold audio until released → lets us observe the staged "text-first" state
      return { audioUrl: 'https://cdn.example/p1.mp3', format: 'audio/mpeg', durationMs: 1500, engine: 'polly', marks };
    });
    const tts = new TtsSynthesisAdapter(backend);

    const outcome = await runGenerationPipeline(
      {
        createOrchestrator: (passageId) => createGenerationOrchestrator({ gateway, passageId }),
        scheduling: repos.scheduling,
        passages: repos.passages,
        progress: repos.progress,
        timingMaps: repos.timingMaps,
        tts,
        session,
        player,
        now: () => 1000,
        genId: () => PASSAGE_ID,
        voiceId: 'Joanna',
        wordData: { deal: wordData },
      },
      SETUP,
      userId,
    );

    // Generation succeeded only after one repair round (invalid → valid).
    expect(calls).toBe(2);
    expect(outcome.ok).toBe(true);

    // Staged readiness: text is persisted + on screen, audio not yet ready.
    expect(await repos.passages.get(PASSAGE_ID)).toBeDefined();
    expect(session.getState().passage?.passageId).toBe(PASSAGE_ID);
    expect(player.getState().status).toBe('loading');

    releaseAudio();
    const ready = await outcome.audio;

    expect(ready).toBe(true);
    expect(player.getState().status).toBe('ready');
    const timing = await repos.timingMaps.get(PASSAGE_ID, 'Joanna');
    expect(timing?.marks.map((m) => m.tokenId)).toContain('p1:0:3'); // "deal" resolved
    db.close();
  });
});

// ── B. Review cycle → dashboard (Flow 2) ─────────────────────────────────────

describe('B. review rating → reschedule → log → re-projection → dashboard', () => {
  it("reflects a Good rating in today's due count, breakdown and weekly activity", async () => {
    const { db, userId } = await freshDb('rev');
    const repos = createRepositories(db);
    const now = 200 * DAY_MS;
    const dashDeps = {
      loadStates: (uid: UserId) => db.scheduling.where('userId').equals(uid).toArray(),
      progress: repos.progress,
      reviewLog: repos.reviewLog,
      passages: repos.passages,
    };

    const due: WordSchedulingState = {
      userId,
      wordId: 'deal',
      stability: 4,
      difficulty: 5,
      reps: 2,
      lapses: 0,
      learningStep: 0,
      lastReviewAt: now - 5 * DAY_MS,
      dueAt: now - DAY_MS,
      lastSource: 'review',
      mastery: 'Learning',
      reappearCount: 0,
    };
    await repos.scheduling.upsert(due);

    expect((await loadDashboardSnapshot(dashDeps, userId, now)).dueTodayCount).toBe(1);

    const next = await applyReviewRating(repos, userId, 'deal', 3, now);
    expect(next.dueAt).toBeGreaterThan(now);

    const after = await loadDashboardSnapshot(dashDeps, userId, now);
    expect(after.dueTodayCount).toBe(0);
    expect(after.mastery.total).toBe(1);
    expect(after.weekly[after.weekly.length - 1]?.reviewCount).toBe(1);
    db.close();
  });
});

// ── D. Seeded-word due timing (A-1-2 / A-1-3 / design decision D1) ────────────

describe('D. a merely-read word is not due now, but re-weaves next day (A-1-2 / D1)', () => {
  /** design decision D1's stability-gated /review predicate (C-5b's future `isDueForReview`). */
  const isDueForReview = (s: WordSchedulingState, t: number): boolean => s.stability !== undefined && s.dueAt <= t;

  it('seeds dueAt = now+1day; excluded from suggest immediately, present next day but never in the /review queue', async () => {
    const { db, userId } = await freshDb('seedtiming');
    const repos = createRepositories(db);
    const session = createSessionStore();
    const player = createPlayerStore();
    const now = 1000;

    const gateway: ContentGateway = {
      async generatePassage() {
        return { passage: validPassage(), stopReason: 'end_turn' };
      },
      async getWordData() {
        return wordData;
      },
    };
    const marks = marksFor(tokenizer.index(PASSAGE_ID, validPassage()));
    const tts = new TtsSynthesisAdapter(ttsBackend(marks));

    const outcome = await runGenerationPipeline(
      {
        createOrchestrator: (passageId) => createGenerationOrchestrator({ gateway, passageId }),
        scheduling: repos.scheduling,
        passages: repos.passages,
        progress: repos.progress,
        timingMaps: repos.timingMaps,
        tts,
        session,
        player,
        now: () => now,
        genId: () => PASSAGE_ID,
        voiceId: 'Joanna',
        wordData: { deal: wordData },
      },
      SETUP,
      userId,
    );
    await outcome.audio;
    expect(outcome.ok).toBe(true);

    // The seeded word carries a next-day due date and remains New (stability undefined).
    const seeded = await repos.scheduling.get(userId, 'deal');
    expect(seeded?.dueAt).toBe(now + DAY_MS);
    expect(seeded?.stability).toBeUndefined();
    expect(isDueForReview(seeded!, now)).toBe(false);

    const suggestGateway: ContentGateway = {
      async generatePassage() {
        throw new Error('unused');
      },
      async getWordData() {
        throw new Error('unused');
      },
      suggestWords: async () => ['fresh1', 'fresh2', 'fresh3'],
    };
    const svc = createWordSuggestionService(suggestGateway);
    const reviewPlan = { reviewSlots: 5, newSlots: 0 };

    // Immediately after generation: the read word does NOT occupy a re-weaving slot.
    const immediate = await svc.suggest(
      { userId, level: seeded!.level!, intent: 'business', now, excludedWordIds: [], count: 12, plan: reviewPlan },
      repos.scheduling,
    );
    expect(immediate.candidates.map((c) => c.wordId)).not.toContain('deal');

    // 24h later: dueAt has elapsed → it re-surfaces as a 'due' re-weaving candidate …
    const later = now + DAY_MS + 1;
    const reweave = await svc.suggest(
      { userId, level: seeded!.level!, intent: 'business', now: later, excludedWordIds: [], count: 12, plan: reviewPlan },
      repos.scheduling,
    );
    const deal = reweave.candidates.find((c) => c.wordId === 'deal');
    expect(deal).toBeDefined();
    expect(deal?.reason).toBe('due');

    // … yet it is still NOT in the stability-gated /review queue (D1's two-faced "due").
    expect(seeded!.dueAt).toBeLessThanOrEqual(later);
    expect(isDueForReview(seeded!, later)).toBe(false);
    db.close();
  });

  it('after generate → reset, suggest fills the new slots with unseen words and keeps due review words (A-2-2)', async () => {
    const { db, userId } = await freshDb('resetsuggest');
    const repos = createRepositories(db);
    const session = createSessionStore();
    const player = createPlayerStore();
    const now = 1_000;

    const gateway: ContentGateway = {
      async generatePassage() {
        return { passage: validPassage(), stopReason: 'end_turn' };
      },
      async getWordData() {
        return wordData;
      },
    };
    const marks = marksFor(tokenizer.index(PASSAGE_ID, validPassage()));
    const tts = new TtsSynthesisAdapter(ttsBackend(marks));
    const outcome = await runGenerationPipeline(
      {
        createOrchestrator: (passageId) => createGenerationOrchestrator({ gateway, passageId }),
        scheduling: repos.scheduling,
        passages: repos.passages,
        progress: repos.progress,
        timingMaps: repos.timingMaps,
        tts,
        session,
        player,
        now: () => now,
        genId: () => PASSAGE_ID,
        voiceId: 'Joanna',
        wordData: { deal: wordData },
      },
      SETUP,
      userId,
    );
    await outcome.audio;
    expect(outcome.ok).toBe(true);

    // A previously-reviewed word whose review time has arrived — its history is NOT reset and it must
    // keep re-appearing (learning history survives a reset; A-2-2 spec).
    await repos.scheduling.upsert({
      userId,
      wordId: 'ledger',
      level: 'B1',
      stability: 20,
      difficulty: 5,
      reps: 4,
      lapses: 0,
      learningStep: 0,
      lastReviewAt: now - 100,
      dueAt: now - 1,
      lastSource: 'review',
      mastery: 'Consolidating',
      reappearCount: 0,
    });

    // Reset clears only the manual add/exclude fields, so the follow-up suggest runs with NO
    // exclusions and a real new-word budget.
    const suggestGateway: ContentGateway = {
      async generatePassage() {
        throw new Error('unused');
      },
      async getWordData() {
        throw new Error('unused');
      },
      suggestWords: async () => ['fresh1', 'fresh2', 'fresh3'],
    };
    const svc = createWordSuggestionService(suggestGateway);
    const result = await svc.suggest(
      { userId, level: 'B1', intent: 'business', now, excludedWordIds: [], count: 12, plan: { reviewSlots: 2, newSlots: 3 } },
      repos.scheduling,
    );
    const ids = result.candidates.map((c) => c.wordId);
    // (1) the new slots are filled with genuinely unseen words …
    expect(ids).toEqual(expect.arrayContaining(['fresh1', 'fresh2', 'fresh3']));
    // (2) the due review word is preserved (history kept) …
    expect(ids).toContain('ledger');
    // … while the just-seeded (not-yet-due) word does NOT flood the proposal, so the list actually
    // changes after a reset rather than returning the same seeds.
    expect(ids).not.toContain('deal');
    db.close();
  });
});

// ── C. Migration ─────────────────────────────────────────────────────────────

describe('C. migration', () => {
  it('preserves data across a numbered Dexie upgrade', async () => {
    const userId = `mig_${seq++}` as UserId;
    const v1 = new LexiaDb(userId);
    await v1.open();
    await createRepositories(v1).scheduling.upsert({
      userId,
      wordId: 'keep',
      stability: 6,
      difficulty: 5,
      reps: 3,
      lapses: 0,
      learningStep: 0,
      lastReviewAt: 0,
      dueAt: DAY_MS,
      lastSource: 'review',
      mastery: 'Learning',
      reappearCount: 0,
    });
    v1.close();

    // Append a further version that adds an index; reopening triggers the upgrade.
    const nextVersion = APP_SCHEMA_VERSION + 1;
    const vNext: SchemaVersion = {
      version: nextVersion,
      stores: { scheduling: '[userId+wordId], userId, dueAt, stability, mastery, reps' },
    };
    const nextDb = new LexiaDb(userId, [...SCHEMA_VERSIONS, vNext]);
    await nextDb.open();
    expect(nextDb.verno).toBe(nextVersion);
    const kept = await createRepositories(nextDb).scheduling.get(userId, 'keep');
    expect(kept?.stability).toBe(6); // invariant preserved through the migration
    nextDb.close();
  });

  it('migrates the anonymous namespace into the signed-in userId namespace', async () => {
    const anon = await new LexiaDb(ANONYMOUS_USER_ID);
    await anon.open();
    const anonRepos = createRepositories(anon);
    await anonRepos.scheduling.upsert({
      userId: ANONYMOUS_USER_ID,
      wordId: 'deal',
      stability: 9,
      difficulty: 5,
      reps: 4,
      lapses: 1,
      learningStep: 0,
      lastReviewAt: 0,
      dueAt: 2 * DAY_MS,
      lastSource: 'review',
      mastery: 'Consolidating',
      reappearCount: 2,
    });
    await anonRepos.reviewLog.append({ userId: ANONYMOUS_USER_ID, wordId: 'deal', rating: 3, source: 'review', at: DAY_MS });
    anon.close();

    const target = `user_${seq++}` as UserId;
    await migrateAnonymousNamespace(target);

    const userDb = new LexiaDb(String(target));
    await userDb.open();
    const userRepos = createRepositories(userDb);
    const migrated = await userRepos.scheduling.get(target, 'deal');
    expect(migrated).toMatchObject({ userId: target, wordId: 'deal', stability: 9, reappearCount: 2 });
    const log = await userRepos.reviewLog.since(target, 0);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ userId: target, wordId: 'deal', source: 'review' });
    userDb.close();
  });
});

// ── D. Production wiring: the CEFR vocabulary gate is live via createContainer (B-4) ──────────
describe('D. createContainer wires the production CEFR dictionary (gate is live)', () => {
  it('measures real bands (known > 0) so an off-band passage is flagged without an explicit cefrOf seam', async () => {
    const { db, userId } = await freshDb('cefr');
    // A B1 request whose passage is saturated with C1 vocabulary. The container is built WITHOUT a
    // `cefrOf` seam — exactly how main.tsx builds it — so this proves the default dictionary is
    // injected. Pre-B-4 the seam was undefined ⇒ known=0, ratio=0, and no cefr violation ever fired.
    const offBand = (): PassageOutput => ({
      meta: { title: 't', intent: 'business', level: 'B1', newCount: 0, reviewCount: 0, approxWords: 8 },
      sentences: [
        {
          tokens: ['The', 'esoteric', 'and', 'ubiquitous', 'idea', 'was', 'superfluous', 'yet', 'meticulous', '.'],
          translationJa: '',
        },
      ],
      targetSpans: [],
      collocationSpans: [],
      noticeCues: [],
    });
    const gateway: ContentGateway = {
      async generatePassage() {
        return { passage: offBand(), stopReason: 'end_turn' };
      },
      async getWordData() {
        throw new Error('unused');
      },
    };
    const container = await createContainer(userId, { db, content: gateway });
    const req: GenerationRequest = {
      level: 'B1',
      intent: 'business',
      newWordRatio: 0.3,
      wordTarget: 8,
      contentType: 'article',
      targetWords: [],
    };
    const result = await container.createOrchestrator('p_cefr').generate(req);
    // The only violation is the vocabulary band, so repairs exhaust and the report surfaces it.
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'validation_exhausted') {
      expect(result.error.lastReport.cefrSampleSize).toBeGreaterThan(0);
      expect(result.error.lastReport.cefrOffBandRatio).toBeGreaterThan(0.15);
      expect(result.error.lastReport.violations.some((v) => v.kind === 'cefr_out_of_band')).toBe(true);
    }
    db.close();
  });
});
