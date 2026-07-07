// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import {
  backfillPassageIllustration,
  runGenerationPipeline,
  type BackfillIllustrationDeps,
  type GenerationControllerDeps,
} from './generationController';
import { isImageRef, imageIdFromRef } from '../../infra/persistence/imageStore';
import { LexiaDb } from '../../infra/persistence/lexiaDb';
import { createRepositories } from '../../infra/persistence/repositories';
import { createSessionStore } from '../stores/sessionStore';
import { createPlayerStore } from '../stores/playerStore';
import { tokenizer } from '../../domain/tokenizer/joinService';
import { DAY_MS } from '../../domain/srs/parameters';
import { ok } from '../../types/result';
import type { GenerationOrchestrator } from '../../domain/generation/generationOrchestrator';
import type {
  AudioAsset,
  GenerationRequest,
  IndexedPassage,
  PassageOutput,
  SetupConfig,
  StoryPlan,
  PassageIllustrationRequest,
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
    meta: { title: '取引成立', intent: 'business', level: 'B1', newCount: 1, reviewCount: 0, approxWords: 4 },
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
  examTarget: { kind: 'eiken', value: '2' },
  intent: 'business',
  newWordRatio: 0.3,
  wordTarget: 200,
  contentType: 'article',
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
    expect(seeded?.level).toBe('B1');
    // A-1-2: a merely-read word is seeded due NEXT day (now+1d), not immediately, and stays New.
    expect(seeded?.dueAt).toBe(1000 + DAY_MS);
    expect(seeded?.stability).toBeUndefined();
    const inProgress = await repos.progress.byStatus(userId, 'in_progress');
    expect(inProgress.map((p) => p.passageId)).toContain(PASSAGE_ID);
  });

  it('enriches the persisted and active passage with a scene illustration after text is readable', async () => {
    const tts: Tts = { synthesize: async () => ({ asset: asset(), timing: timing() }), wordClipUrl: async () => '' };
    const gate = deferred<string>();
    const { deps, repos, session, userId } = await env(tts);
    let captured: PassageIllustrationRequest | null = null;
    deps.illustratePassage = (req) => {
      captured = req;
      return gate.promise;
    };

    const outcome = await runGenerationPipeline(deps, SETUP, userId);

    expect(outcome.ok).toBe(true);
    expect(session.getState().passage?.source.meta.sceneIllustrationUrl).toBeUndefined();
    expect(captured).toMatchObject({ title: '取引成立', intent: 'business', level: 'B1' });

    gate.resolve('data:image/png;base64,SCENE');
    expect(await outcome.illustration).toBe(true);

    expect(session.getState().passage?.source.meta.sceneIllustrationUrl).toBe('data:image/png;base64,SCENE');
    expect((await repos.passages.get(PASSAGE_ID))?.passage.meta.sceneIllustrationUrl).toBe('data:image/png;base64,SCENE');
  });

  it('staged mode: opens the reader on body-ready, then merges background annotation into store + session', async () => {
    const tts: Tts = { synthesize: async () => ({ asset: asset(), timing: timing() }), wordClipUrl: async () => '' };
    // A deferAnnotation-respecting orchestrator: returns the body with annotationStatus 'pending'.
    const orchestrator: GenerationOrchestrator = {
      generate: async (_req, options) => {
        expect(options?.deferAnnotation).toBe(true);
        const src = passageOutput();
        return ok(tokenizer.index(PASSAGE_ID, { ...src, meta: { ...src.meta, annotationStatus: 'pending' } }));
      },
    };
    const { deps, repos, session, userId } = await env(tts, orchestrator);
    const gate = deferred<void>();
    const cue = {
      index: 1,
      span: { sentenceIndex: 0, tokenStart: 1, tokenEnd: 2 },
      category: 'usage' as const,
      anchorText: 'deal',
      meaningJa: '取引',
      explanationJa: 'ビジネスの合意を指す。',
    };

    const outcome = await runGenerationPipeline(
      {
        ...deps,
        stagedGeneration: true,
        annotatePassage: async () => {
          await gate.promise;
          return { noticeCues: [cue], status: 'complete' as const };
        },
      },
      SETUP,
      userId,
    );

    // The reader is open while the annotation is still in flight (準備できたものから表示).
    expect(outcome.ok).toBe(true);
    expect(session.getState().passage?.source.meta.annotationStatus).toBe('pending');
    expect(session.getState().passage?.source.noticeCues).toEqual([]);

    gate.resolve();
    expect(await outcome.annotation).toBe(true);

    // Cues + status merged into both the persisted record and the live session passage.
    expect(session.getState().passage?.source.meta.annotationStatus).toBe('complete');
    expect(session.getState().passage?.source.noticeCues).toHaveLength(1);
    const record = await repos.passages.get(PASSAGE_ID);
    expect(record?.passage.meta.annotationStatus).toBe('complete');
    expect(record?.passage.noticeCues[0]).toMatchObject({ anchorText: 'deal', meaningJa: '取引' });
  });

  it('staged mode: a failed background annotation stamps failed (banner + 再生成) and keeps the text', async () => {
    const tts: Tts = { synthesize: async () => ({ asset: asset(), timing: timing() }), wordClipUrl: async () => '' };
    const orchestrator: GenerationOrchestrator = {
      generate: async () => {
        const src = passageOutput();
        return ok(tokenizer.index(PASSAGE_ID, { ...src, meta: { ...src.meta, annotationStatus: 'pending' } }));
      },
    };
    const { deps, repos, session, userId } = await env(tts, orchestrator);

    const outcome = await runGenerationPipeline(
      {
        ...deps,
        stagedGeneration: true,
        annotatePassage: async () => {
          throw new Error('annotation down');
        },
      },
      SETUP,
      userId,
    );

    expect(outcome.ok).toBe(true);
    expect(await outcome.annotation).toBe(false);
    expect(session.getState().passage?.source.meta.annotationStatus).toBe('failed');
    expect((await repos.passages.get(PASSAGE_ID))?.passage.meta.annotationStatus).toBe('failed');
    // The body itself is untouched — reading continues.
    expect(session.getState().passage?.renderText).toContain('deal');
  });

  it('batch mode (stagedGeneration off): no deferAnnotation and no background annotation promise', async () => {
    const tts: Tts = { synthesize: async () => ({ asset: asset(), timing: timing() }), wordClipUrl: async () => '' };
    const orchestrator: GenerationOrchestrator = {
      generate: async (_req, options) => {
        expect(options?.deferAnnotation ?? false).toBe(false);
        return ok(indexedPassage());
      },
    };
    const { deps, userId } = await env(tts, orchestrator);
    const outcome = await runGenerationPipeline(
      { ...deps, stagedGeneration: false, annotatePassage: async () => ({ noticeCues: [], status: 'complete' as const }) },
      SETUP,
      userId,
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.annotation).toBeUndefined();
  });

  it('degrades when passage illustration generation fails', async () => {
    const tts: Tts = { synthesize: async () => ({ asset: asset(), timing: timing() }), wordClipUrl: async () => '' };
    const { deps, repos, session, userId } = await env(tts);
    deps.illustratePassage = async () => {
      throw new Error('image down');
    };

    const outcome = await runGenerationPipeline(deps, SETUP, userId);

    expect(outcome.ok).toBe(true);
    expect(await outcome.illustration).toBe(false);
    expect(session.getState().passage?.source.meta.sceneIllustrationUrl).toBeUndefined();
    expect((await repos.passages.get(PASSAGE_ID))?.passage.meta.sceneIllustrationUrl).toBeUndefined();
  });

  it('threads story context and persists the generated chapter with storyRef', async () => {
    const tts: Tts = { synthesize: async () => ({ asset: asset(), timing: timing() }), wordClipUrl: async () => '' };
    const { deps, repos, userId } = await env(tts);
    const plan: StoryPlan = {
      storyId: 'story_1',
      contentType: 'long_story',
      genre: 'fantasy',
      titleJa: '星の物語',
      synopsisJa: '星を探す旅。',
      characters: [{ name: 'Mia', role: '主人公', descriptionJa: '好奇心旺盛な少女' }],
      chapters: [{ index: 0, headingJa: '第一章', beatJa: '旅立ち' }],
    };
    let capturedReq: GenerationRequest | null = null;
    const capturedIllustrationReqs: PassageIllustrationRequest[] = [];
    deps.createOrchestrator = (passageId) => ({
      generate: async (req) => {
        capturedReq = req;
        return ok(tokenizer.index(passageId, passageOutput()));
      },
    });
    deps.illustratePassage = async (req) => {
      capturedIllustrationReqs.push(req);
      return 'data:image/png;base64,STORYSCENE';
    };

    const outcome = await runGenerationPipeline(deps, { ...SETUP, contentType: 'long_story' }, userId, {
      passageId: 'story_1:0',
      storyContext: { storyId: 'story_1', chapterIndex: 0, plan },
    });
    await outcome.audio;

    expect(outcome.passageId).toBe('story_1:0');
    expect(capturedReq).not.toBeNull();
    const reqSeen = capturedReq as unknown as GenerationRequest;
    expect(reqSeen.storyContext?.plan.titleJa).toBe('星の物語');
    const persisted = await repos.passages.get('story_1:0');
    expect(persisted?.passage.meta.storyRef).toEqual({ storyId: 'story_1', chapterIndex: 0 });
    await outcome.illustration;
    expect(capturedIllustrationReqs[0]?.story).toMatchObject({
      genre: 'fantasy',
      titleJa: '星の物語',
      chapterHeadingJa: '第一章',
    });
    expect(capturedIllustrationReqs[0]?.story?.characters[0]?.name).toBe('Mia');
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

describe('backfillPassageIllustration (E-3(e) scene backfill)', () => {
  const tts: Tts = { synthesize: async () => ({ asset: asset(), timing: timing() }), wordClipUrl: async () => '' };

  function backfillDeps(base: Awaited<ReturnType<typeof env>>, illustrate?: () => Promise<string>): BackfillIllustrationDeps {
    return {
      passages: base.repos.passages,
      images: base.repos.images,
      session: base.session,
      illustratePassage: illustrate,
      userId: base.userId,
      now: () => 2000,
    };
  }

  it('backfills a missing scene, stores the image in the images table, and refreshes the reader', async () => {
    const base = await env(tts);
    const { repos, session, userId } = base;
    await repos.passages.put({ passageId: PASSAGE_ID, userId, createdAt: 1000, passage: passageOutput() });
    session.getState().startPassage(indexedPassage(), 1000);

    let calls = 0;
    const stored = await backfillPassageIllustration(
      backfillDeps(base, async () => {
        calls += 1;
        return 'data:image/png;base64,U0NFTkU='; // valid base64 ("SCENE")
      }),
      PASSAGE_ID,
    );

    expect(stored).toBe(true);
    expect(calls).toBe(1);
    // The passage now references the image by a lexia-image: key rather than an inline data URL (D7).
    const persistedUrl = (await repos.passages.get(PASSAGE_ID))?.passage.meta.sceneIllustrationUrl;
    expect(isImageRef(persistedUrl)).toBe(true);
    // …and the referenced blob lives in the images table.
    const images = await repos.images.all(userId);
    expect(images).toHaveLength(1);
    expect(images[0]!.imageId).toBe(imageIdFromRef(persistedUrl));
    // The active reader is refreshed in place so the scene appears while reading.
    expect(session.getState().passage?.source.meta.sceneIllustrationUrl).toBe(persistedUrl);
  });

  it('is a no-op when the passage already has a scene illustration', async () => {
    const base = await env(tts);
    const { repos, userId } = base;
    const passage = passageOutput();
    passage.meta.sceneIllustrationUrl = 'data:image/png;base64,OLD';
    await repos.passages.put({ passageId: PASSAGE_ID, userId, createdAt: 1000, passage });

    let calls = 0;
    const stored = await backfillPassageIllustration(
      backfillDeps(base, async () => {
        calls += 1;
        return 'data:image/png;base64,NEW';
      }),
      PASSAGE_ID,
    );

    expect(stored).toBe(false);
    expect(calls).toBe(0);
    expect((await repos.passages.get(PASSAGE_ID))?.passage.meta.sceneIllustrationUrl).toBe('data:image/png;base64,OLD');
    expect(await repos.images.all(userId)).toHaveLength(0);
  });

  it('degrades (no write, no image row) when illustration generation fails', async () => {
    const base = await env(tts);
    const { repos, userId } = base;
    await repos.passages.put({ passageId: PASSAGE_ID, userId, createdAt: 1000, passage: passageOutput() });

    const stored = await backfillPassageIllustration(
      backfillDeps(base, async () => {
        throw new Error('image down');
      }),
      PASSAGE_ID,
    );

    expect(stored).toBe(false);
    expect((await repos.passages.get(PASSAGE_ID))?.passage.meta.sceneIllustrationUrl).toBeUndefined();
    expect(await repos.images.all(userId)).toHaveLength(0);
  });

  it('is a no-op when no illustrator is configured', async () => {
    const base = await env(tts);
    const { repos, userId } = base;
    await repos.passages.put({ passageId: PASSAGE_ID, userId, createdAt: 1000, passage: passageOutput() });

    const stored = await backfillPassageIllustration(backfillDeps(base, undefined), PASSAGE_ID);

    expect(stored).toBe(false);
    expect((await repos.passages.get(PASSAGE_ID))?.passage.meta.sceneIllustrationUrl).toBeUndefined();
  });
});
