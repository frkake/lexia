/**
 * L4 — container (composition root). The one place that spans every layer: it opens the
 * learner's Dexie DB, binds the repositories, instantiates the adjacent-capability
 * adapters (Content / TTS / Sync) and the per-call generation orchestrator, and exposes
 * the app-wide stores. Screens never new-up infrastructure; they read this graph from
 * AppContext. Seams are injectable so the integration tests build the same graph over
 * fakes (fake-indexeddb + stub gateways).
 *
 * When no TTS backend is configured the default TTS port degrades (synthesize rejects):
 * reading still works and the player is marked unavailable (design.md degrade, task 10.4).
 */

import { openLexiaDb } from '../../infra/persistence/lexiaDb';
import type { LexiaDb } from '../../infra/persistence/lexiaDb';
import { createRepositories, type Repositories } from '../../infra/persistence/repositories';
import { HttpContentGateway } from '../../infra/content/contentGatewayHttp';
import { HttpStoryGateway } from '../../infra/content/storyGatewayHttp';
import { TtsSynthesisAdapter, type TtsBackend } from '../../infra/tts/ttsSynthesisAdapter';
import { HttpTtsBackend } from '../../infra/tts/ttsBackendHttp';
import { JsonSyncAdapter } from '../../infra/sync/exportImport';
import {
  createGenerationOrchestrator,
  type GenerationOrchestrator,
} from '../../domain/generation/generationOrchestrator';
import { createStoryPlanner, type StoryPlanner } from '../../domain/story/storyPlanner';
import { createWordSuggestionService, type WordSuggestionService } from '../../domain/suggestion/wordSuggestionService';
import { sessionStore, type SessionStore } from '../../state/stores/sessionStore';
import { playerStore, type PlayerStore } from '../../state/stores/playerStore';
import { settingsStore, type SettingsStore } from '../../state/stores/settingsStore';
import type { ContentGateway, StoryGateway, SyncAdapter, TtsSynthesisPort } from '../../types/ports';
import type { Cefr, UserId, WordSchedulingState } from '../../types/domain';

/** Polly Neural default voice used until the learner picks one in settings. */
export const DEFAULT_VOICE_ID = 'Joanna';

/** TTS port that always degrades — used when no backend is configured. */
export const degradingTts: TtsSynthesisPort = {
  async synthesize() {
    throw new Error('TTS backend not configured');
  },
  async wordClipUrl() {
    throw new Error('TTS backend not configured');
  },
};

export interface ContainerSeams {
  /** Pre-opened DB (tests inject a fake-indexeddb instance). */
  db?: LexiaDb;
  content?: ContentGateway;
  /** Story-plan generation port (Requirement 6). Defaults to the HTTP proxy gateway. */
  story?: StoryGateway;
  /** A ready TTS port, or … */
  tts?: TtsSynthesisPort;
  /** … a backend to wrap with TtsSynthesisAdapter. */
  ttsBackend?: TtsBackend;
  baseUrl?: string;
  cefrOf?: (token: string) => Cefr | undefined;
  session?: SessionStore;
  player?: PlayerStore;
  settings?: SettingsStore;
  /** Injectable clock (defaults to Date.now). */
  now?: () => number;
  voiceId?: string;
}

export interface Container {
  userId: UserId;
  db: LexiaDb;
  repos: Repositories;
  content: ContentGateway;
  tts: TtsSynthesisPort;
  sync: SyncAdapter;
  session: SessionStore;
  player: PlayerStore;
  settings: SettingsStore;
  /** Next-word suggestion service (Requirement 5). */
  suggestions: WordSuggestionService;
  /** Story planner (Requirement 6); resolved with the injected/default StoryGateway. */
  storyPlanner: StoryPlanner;
  /** Reads every scheduling state (incl. New words) for dashboard / wordbook. */
  loadStates: (userId: UserId) => Promise<WordSchedulingState[]>;
  /** Builds a generation orchestrator bound to a fresh passageId. */
  createOrchestrator: (passageId: string) => GenerationOrchestrator;
  genId: () => string;
  now: () => number;
  voiceId: string;
}

export async function createContainer(userId: UserId, seams: ContainerSeams = {}): Promise<Container> {
  const db = seams.db ?? (await openLexiaDb(String(userId)));
  const repos = createRepositories(db);
  // No mock fallback: when the generation proxy is missing/down the HTTP gateway rejects
  // with a typed error, which the orchestrator/controller surface to the user (a missing
  // backend must show an error, not silently serve placeholder content).
  const content = seams.content ?? new HttpContentGateway({ baseUrl: seams.baseUrl });
  const story = seams.story ?? new HttpStoryGateway({ baseUrl: seams.baseUrl });
  // Both adjacent capabilities default to their HTTP seam; when the TTS endpoint is
  // absent the synthesize call rejects and the pipeline degrades (player unavailable).
  const tts =
    seams.tts ?? new TtsSynthesisAdapter(seams.ttsBackend ?? new HttpTtsBackend({ baseUrl: seams.baseUrl }));
  const sync = new JsonSyncAdapter(db);
  const now = seams.now ?? (() => Date.now());

  let counter = 0;
  const genId = (): string => `p_${now()}_${counter++}`;

  return {
    userId,
    db,
    repos,
    content,
    tts,
    sync,
    session: seams.session ?? sessionStore,
    player: seams.player ?? playerStore,
    settings: seams.settings ?? settingsStore,
    suggestions: createWordSuggestionService(content),
    storyPlanner: createStoryPlanner({
      gateway: story,
      storyRepo: repos.stories,
      createOrchestrator: (passageId) =>
        createGenerationOrchestrator({ gateway: content, cefrOf: seams.cefrOf, passageId }),
      now,
    }),
    loadStates: (uid) => db.scheduling.where('userId').equals(uid).toArray(),
    createOrchestrator: (passageId) =>
      createGenerationOrchestrator({ gateway: content, cefrOf: seams.cefrOf, passageId }),
    genId,
    now,
    voiceId: seams.voiceId ?? DEFAULT_VOICE_ID,
  };
}
