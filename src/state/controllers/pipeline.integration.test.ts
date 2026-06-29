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
import { LexiaDb, SCHEMA_VERSIONS, type SchemaVersion } from '../../infra/persistence/lexiaDb';
import { createRepositories } from '../../infra/persistence/repositories';
import { migrateAnonymousNamespace, ANONYMOUS_USER_ID } from '../../infra/auth/authAdapter';
import { createGenerationOrchestrator } from '../../domain/generation/generationOrchestrator';
import { TtsSynthesisAdapter, type TtsBackend, type TtsWordMark } from '../../infra/tts/ttsSynthesisAdapter';
import { createSessionStore } from '../stores/sessionStore';
import { createPlayerStore } from '../stores/playerStore';
import { tokenizer } from '../../domain/tokenizer/joinService';
import { DAY_MS } from '../../domain/srs/parameters';
import type { ContentGateway } from '../../types/ports';
import type {
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
  core: { meaningsJa: ['取引'], examples: [{ en: 'close a deal', ja: '取引をまとめる' }], collocations: ['close a deal'], synonymNuances: [] },
};

// A simple 8-word filler sentence, repeated so the passage clears the length gate for `length: 'short'`.
const FILLER = ['They', 'met', 'again', 'and', 'talked', 'for', 'a', 'while', '.'];

function validPassage(): PassageOutput {
  return {
    meta: { title: '取引の成立', theme: '交渉', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 117 },
    sentences: [
      { tokens: ['We', 'closed', 'the', 'deal', 'today', '.'], translationJa: '今日、取引を成立させた。' },
      ...Array.from({ length: 14 }, () => ({ tokens: [...FILLER], translationJa: '彼らは再び会って話した。' })),
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
  level: 'B1',
  themes: ['交渉'],
  newWordRatio: 0.3,
  length: 'short',
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

    // Append a v2 that adds an index; reopening triggers the upgrade.
    const v2: SchemaVersion = { version: 2, stores: { scheduling: '[userId+wordId], userId, dueAt, stability, mastery, reps' } };
    const v2db = new LexiaDb(userId, [...SCHEMA_VERSIONS, v2]);
    await v2db.open();
    expect(v2db.verno).toBe(2);
    const kept = await createRepositories(v2db).scheduling.get(userId, 'keep');
    expect(kept?.stability).toBe(6); // invariant preserved through the migration
    v2db.close();
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
