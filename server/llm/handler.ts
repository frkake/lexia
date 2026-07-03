/**
 * Connect middleware implementing the ContentGateway HTTP contract (design.md API table):
 *   POST /api/passages:generate  -> { passage, stop_reason }   (400, 429, 503)
 *   POST /api/passages:illustrate -> { illustrationUrl }        (400, 429, 503)
 *   GET  /api/words/{wordId}      -> WordData                   (404, 429, 503)
 *
 * It is mounted by the Vite plugin on the dev and preview servers, so `pnpm dev` actually
 * reaches the configured LLM. Errors are returned as the typed status the client expects;
 * there is intentionally no mock fallback — a missing/broken API surfaces as an error.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  CharacterIllustrationRequest,
  GenerationRequest,
  PassageAnnotationRequest,
  PassageIllustrationRequest,
  StoryPlanExtensionRequest,
  StoryPlanRequest,
  WordSuggestionRequest,
} from '../../src/types/domain';
import {
  type Env,
  ProviderError,
  annotatePassage,
  generatePassage,
  getWordData,
  illustrateCharacter,
  illustratePassage,
  extendStoryPlan,
  planStory,
  suggestWords,
} from './providers';

type Next = (err?: unknown) => void;

const GENERATE_PATH = '/api/passages:generate';
const ANNOTATE_PATH = '/api/passages:annotate';
const ILLUSTRATE_PASSAGE_PATH = '/api/passages:illustrate';
const SUGGEST_PATH = '/api/words:suggest';
const STORY_PLAN_PATH = '/api/story:plan';
const STORY_EXTEND_PATH = '/api/story:extend';
const STORY_ILLUSTRATE_PATH = '/api/story:illustrate';
const WORDS_PREFIX = '/api/words/';

export function createApiHandler(getEnv: () => Env) {
  return function apiHandler(req: IncomingMessage, res: ServerResponse, next: Next): void {
    const url = req.url ?? '';
    const path = url.split('?')[0] ?? '';
    if (!path.startsWith('/api/')) return next();

    void route(req, res, path, getEnv()).catch((error) => sendError(res, error));
  };
}

async function route(req: IncomingMessage, res: ServerResponse, path: string, env: Env): Promise<void> {
  if (path === GENERATE_PATH) {
    if (req.method !== 'POST') return sendStatus(res, 405, 'method not allowed');
    const body = await readJson<GenerationRequest>(req);
    if (!body || !body.level || !body.intent || typeof body.wordTarget !== 'number') {
      throw new ProviderError(400, 'Invalid GenerationRequest body.');
    }
    const result = await generatePassage(env, body);
    return sendJson(res, 200, { passage: result.passage, stop_reason: result.stopReason });
  }

  if (path === ANNOTATE_PATH) {
    if (req.method !== 'POST') return sendStatus(res, 405, 'method not allowed');
    const body = await readJson<PassageAnnotationRequest>(req);
    if (!body || !Array.isArray(body.sentences) || !body.level) {
      throw new ProviderError(400, 'Invalid PassageAnnotationRequest body.');
    }
    const noticeCues = await annotatePassage(env, body);
    return sendJson(res, 200, { noticeCues });
  }

  if (path === ILLUSTRATE_PASSAGE_PATH) {
    if (req.method !== 'POST') return sendStatus(res, 405, 'method not allowed');
    const body = await readJson<PassageIllustrationRequest>(req);
    if (!body || !body.title || !body.intent || !body.level || !Array.isArray(body.sentences)) {
      throw new ProviderError(400, 'Invalid PassageIllustrationRequest body.');
    }
    const illustrationUrl = await illustratePassage(env, body);
    return sendJson(res, 200, { illustrationUrl });
  }

  if (path === SUGGEST_PATH) {
    if (req.method !== 'POST') return sendStatus(res, 405, 'method not allowed');
    const body = await readJson<WordSuggestionRequest>(req);
    if (!body || !body.level || !body.intent) {
      throw new ProviderError(400, 'Invalid WordSuggestionRequest body.');
    }
    const words = await suggestWords(env, { ...body, count: body.count || 6 });
    return sendJson(res, 200, { words });
  }

  if (path === STORY_PLAN_PATH) {
    if (req.method !== 'POST') return sendStatus(res, 405, 'method not allowed');
    const body = await readJson<StoryPlanRequest>(req);
    if (!body || !body.contentType || !body.genre || !body.level) {
      throw new ProviderError(400, 'Invalid StoryPlanRequest body.');
    }
    const storyPlan = await planStory(env, body);
    return sendJson(res, 200, { storyPlan });
  }

  if (path === STORY_EXTEND_PATH) {
    if (req.method !== 'POST') return sendStatus(res, 405, 'method not allowed');
    const body = await readJson<StoryPlanExtensionRequest>(req);
    if (!body || !body.plan || !body.plan.storyId || typeof body.nextChapterIndex !== 'number') {
      throw new ProviderError(400, 'Invalid StoryPlanExtensionRequest body.');
    }
    const storyPlan = await extendStoryPlan(env, body);
    return sendJson(res, 200, { storyPlan });
  }

  if (path === STORY_ILLUSTRATE_PATH) {
    if (req.method !== 'POST') return sendStatus(res, 405, 'method not allowed');
    const body = await readJson<CharacterIllustrationRequest>(req);
    if (!body || !body.name || !body.role || !body.descriptionJa || !body.genre) {
      throw new ProviderError(400, 'Invalid CharacterIllustrationRequest body.');
    }
    const illustrationUrl = await illustrateCharacter(env, body);
    return sendJson(res, 200, { illustrationUrl });
  }

  if (path.startsWith(WORDS_PREFIX)) {
    if (req.method !== 'GET') return sendStatus(res, 405, 'method not allowed');
    let wordId: string;
    try {
      wordId = decodeURIComponent(path.slice(WORDS_PREFIX.length));
    } catch {
      throw new ProviderError(400, 'Malformed word id.');
    }
    if (!wordId) throw new ProviderError(404, 'No word id.');
    const word = await getWordData(env, wordId);
    return sendJson(res, 200, word);
  }

  return sendStatus(res, 404, 'not found');
}

function readJson<T>(req: IncomingMessage): Promise<T | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw) as T);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(payload);
}

function sendStatus(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

function sendError(res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (error instanceof ProviderError) {
    sendJson(res, error.status, { error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : 'internal error';
  // Surface unexpected failures as "unavailable" so the client shows a connect error.
  sendJson(res, 503, { error: message });
}
