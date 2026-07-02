import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  AuthProvider,
  ContentGateway,
  TtsSynthesisPort,
  SyncAdapter,
  SchedulingRepository,
  ReviewLogRepository,
  ReviewLogReader,
  PassageRepository,
  TimingMapRepository,
  ProgressRepository,
  SettingsRepository,
  WordCacheRepository,
} from './ports';
import type { UserId, WordSchedulingState } from './domain';

const U = 'u1' as UserId;

describe('ports', () => {
  it('SchedulingRepository exposes due / low-stability queries', () => {
    const repo: SchedulingRepository = {
      get: async () => undefined,
      upsert: async () => {},
      dueBefore: async () => [],
      lowStability: async () => [],
    };
    expectTypeOf(repo.dueBefore).returns.resolves.toEqualTypeOf<WordSchedulingState[]>();
    expect(repo).toBeDefined();
  });

  it('ReviewLogRepository is append-only and extends the read subset', () => {
    const repo: ReviewLogRepository = {
      append: async () => {},
      since: async () => [],
      lastPassageUpdate: async () => undefined,
    };
    // The read subset must be assignable from the full repository.
    const reader: ReviewLogReader = repo;
    expect(reader.lastPassageUpdate).toBe(repo.lastPassageUpdate);
    // No mutation method other than append is exposed.
    expect(Object.keys(repo).sort()).toEqual(['append', 'lastPassageUpdate', 'since']);
  });

  it('ContentGateway generates passages and fetches word data', () => {
    const gw: ContentGateway = {
      generatePassage: async () => ({
        passage: {
          meta: { title: '', intent: 'daily', level: 'B1', newCount: 0, reviewCount: 0, approxWords: 0 },
          sentences: [],
          targetSpans: [],
          collocationSpans: [],
          noticeCues: [],
        },
        stopReason: 'end_turn',
      }),
      getWordData: async () => ({
        wordId: 'w1',
        headword: 'x',
        ipa: '',
        pos: [],
        register: '',
        connotation: '',
        frequency: 1,
        core: { meaningsJa: [], examples: [], collocations: [], synonymNuances: [] },
      }),
    };
    expect(gw).toBeDefined();
  });

  it('TtsSynthesisPort synthesizes audio + timing and returns word clip urls', () => {
    const tts: TtsSynthesisPort = {
      synthesize: async (passage, voiceId) => ({
        asset: {
          passageId: passage.passageId,
          voiceId,
          audioUrl: 'https://cdn/x.mp3',
          format: 'audio/mpeg',
          durationMs: 0,
          engine: 'polly',
        },
        timing: { passageId: passage.passageId, voiceId, marks: [] },
      }),
      wordClipUrl: async () => 'https://cdn/word.mp3',
    };
    expect(tts).toBeDefined();
  });

  it('AuthProvider supplies a userId and subscription', async () => {
    const auth: AuthProvider = {
      getUserId: async () => U,
      isAnonymous: () => true,
      onUserChange: () => () => {},
    };
    expect(await auth.getUserId()).toBe(U);
  });

  it('SyncAdapter round-trips export/import', () => {
    const sync: SyncAdapter = {
      export: async () => new Blob(['{}']),
      import: async () => {},
    };
    expect(sync).toBeDefined();
  });

  it('the remaining repositories are constructible', () => {
    const passages: PassageRepository = {
      get: async () => undefined,
      put: async () => {},
      recent: async () => [],
      all: async () => [],
      byStory: async () => [],
    };
    const timing: TimingMapRepository = { get: async () => undefined, put: async () => {} };
    const progress: ProgressRepository = {
      get: async () => undefined,
      upsert: async () => {},
      byStatus: async () => [],
    };
    const settings: SettingsRepository = { get: async () => undefined, put: async () => {} };
    const words: WordCacheRepository = {
      get: async () => undefined,
      put: async () => {},
      all: async () => [],
    };
    expect([passages, timing, progress, settings, words].every(Boolean)).toBe(true);
  });
});
