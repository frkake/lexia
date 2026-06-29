// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { runGenerationPipeline, type GenerationControllerDeps } from './generationController';
import { LexiaDb } from '../../infra/persistence/lexiaDb';
import { createRepositories } from '../../infra/persistence/repositories';
import { createSessionStore } from '../stores/sessionStore';
import { createPlayerStore } from '../stores/playerStore';
import { tokenizer } from '../../domain/tokenizer/joinService';
import { ok } from '../../types/result';
import type { GenerationOrchestrator } from '../../domain/generation/generationOrchestrator';
import type {
  AudioAsset,
  IndexedPassage,
  PassageOutput,
  SetupConfig,
  TimingMap,
  UserId,
} from '../../types/domain';
import type { TtsSynthesisPort as Tts } from '../../types/ports';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const PASSAGE_ID = 'p1';

function passageOutput(): PassageOutput {
  return {
    meta: { title: '取引成立', theme: '交渉', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 4 },
    sentences: [{ tokens: ['The', 'deal', 'closed', '.'], translationJa: '取引が成立した。' }],
    targetSpans: [{ sentenceIndex: 0, tokenStart: 1, tokenEnd: 2, wordId: 'deal', surface: 'deal', masteryDensity: 'new' }],
    collocationSpans: [],
    noticeCues: [],
  };
}

function indexedPassage(): IndexedPassage {
  return tokenizer.index(PASSAGE_ID, passageOutput());
}

const SETUP: SetupConfig = {
  level: 'B1',
  themes: ['交渉'],
  newWordRatio: 0.3,
  length: 'short',
  targetWordIds: ['deal'],
  excludedWordIds: [],
};

const asset = (): AudioAsset => ({
  passageId: PASSAGE_ID,
  voiceId: 'Joanna',
  audioUrl: 'https://cdn.example/p1.mp3',
  format: 'audio/mpeg',
  durationMs: 3000,
  engine: 'polly',
});
const timing = (): TimingMap => ({ passageId: PASSAGE_ID, voiceId: 'Joanna', marks: [{ tokenId: 'p1:0:0', startMs: 0, endMs: 300 }] });

const okOrchestrator: GenerationOrchestrator = { generate: async () => ok(indexedPassage()) };

let seq = 0;
async function env(tts: Tts, orchestrator: GenerationOrchestrator = okOrchestrator) {
  const userId = `gen_${seq++}` as UserId;
  const db = new LexiaDb(userId);
  await db.open();
  const repos = createRepositories(db);
  const session = createSessionStore();
  const player = createPlayerStore();
  const deps: GenerationControllerDeps = {
    createOrchestrator: () => orchestrator,
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
  };
  return { deps, repos, session, player, userId };
}

describe('runGenerationPipeline (Flow 1 staged readiness)', () => {
  it('renders text immediately and flips the player to ready only once audio arrives', async () => {
    const gate = deferred<{ asset: AudioAsset; timing: TimingMap }>();
    const tts: Tts = { synthesize: () => gate.promise, wordClipUrl: async () => '' };
    const { deps, repos, session, player, userId } = await env(tts);

    const outcome = await runGenerationPipeline(deps, SETUP, userId);

    // Text is viewable the moment generation+validation succeed.
    expect(outcome.ok).toBe(true);
    expect(session.getState().passage?.passageId).toBe(PASSAGE_ID);
    expect(await repos.passages.get(PASSAGE_ID)).toBeDefined();
    // Player is still loading — audio has not arrived.
    expect(player.getState().status).toBe('loading');

    gate.resolve({ asset: asset(), timing: timing() });
    const ready = await outcome.audio;

    expect(ready).toBe(true);
    expect(player.getState().status).toBe('ready');
    expect(await repos.timingMaps.get(PASSAGE_ID, 'Joanna')).toEqual(timing());
  });

  it('seeds New scheduling states for target words and opens reading progress', async () => {
    const tts: Tts = { synthesize: async () => ({ asset: asset(), timing: timing() }), wordClipUrl: async () => '' };
    const { deps, repos, userId } = await env(tts);

    const outcome = await runGenerationPipeline(deps, SETUP, userId);
    await outcome.audio;

    const seeded = await repos.scheduling.get(userId, 'deal');
    expect(seeded).toBeDefined();
    expect(seeded?.mastery).toBe('New');
    const inProgress = await repos.progress.byStatus(userId, 'in_progress');
    expect(inProgress.map((p) => p.passageId)).toContain(PASSAGE_ID);
  });

  it('degrades on TTS failure — text continues, player marked unavailable', async () => {
    const tts: Tts = { synthesize: async () => { throw new Error('polly down'); }, wordClipUrl: async () => '' };
    const { deps, session, player, userId } = await env(tts);

    const outcome = await runGenerationPipeline(deps, SETUP, userId);
    const ready = await outcome.audio;

    expect(outcome.ok).toBe(true);
    expect(session.getState().passage?.passageId).toBe(PASSAGE_ID); // text still readable
    expect(ready).toBe(false);
    expect(player.getState().status).toBe('unavailable');
  });

  it('returns the error and does not start a session when generation fails', async () => {
    const tts: Tts = { synthesize: async () => ({ asset: asset(), timing: timing() }), wordClipUrl: async () => '' };
    const failing: GenerationOrchestrator = {
      generate: async () => ({ ok: false, error: { kind: 'refusal' } }),
    };
    const { deps, session, player, userId } = await env(tts, failing);

    const outcome = await runGenerationPipeline(deps, SETUP, userId);

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toEqual({ kind: 'refusal' });
    expect(session.getState().passage).toBeNull();
    expect(player.getState().status).toBe('idle');
  });
});
