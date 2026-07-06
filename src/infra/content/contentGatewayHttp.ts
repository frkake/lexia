/**
 * L2 — HttpContentGateway: the ContentGateway port over the thin server proxy
 * (design.md "ContentGateway"). Credentials stay server-side; the client only sends
 * the GenerationRequest and reads `{ passage, stop_reason }` / WordData back.
 *
 * Non-2xx statuses are normalized into a typed `ContentGatewayError` (400→bad_request,
 * 404→not_found, 422→validation, 429→rate_limited, 503→unavailable, other/throw→network).
 * Per design "Error Strategy", adjacent I/O rejects with this typed error and the state
 * layer (contentQueries) wraps it into `Result`; the port itself stays Promise-shaped so
 * the GenerationOrchestrator can read `stopReason` directly.
 */

import type { ContentGateway, GenerationHealth } from '../../types/ports';
import type {
  GenerationRequest,
  GenerationResponse,
  StopReason,
  WordData,
  WordSuggestionRequest,
  NoticeCue,
  AnnotationResult,
  AnnotationStatus,
  PassageAnnotationRequest,
  PassageIllustrationRequest,
  ReviewSentenceRequest,
  SentenceSyntaxNote,
} from '../../types/domain';

export type ContentGatewayErrorKind =
  | 'bad_request'
  | 'not_found'
  | 'validation'
  | 'rate_limited'
  | 'unavailable'
  /** The generation API key is unset (server code `not_configured`); the UI shows setup steps. */
  | 'not_configured'
  /** The per-request timeout elapsed (D-7): the server hung past REQUEST_TIMEOUT_MS. */
  | 'timeout'
  /** The caller aborted the request (D-7): the learner pressed cancel. Usually swallowed by the UI. */
  | 'aborted'
  | 'network';

/**
 * Per-request timeout (D-7). A serial generation pipeline can legitimately take tens of seconds, so
 * this is generous; past it the request is aborted and surfaces a `timeout` error instead of the UI
 * hanging on「生成しています…」forever. Composed with the caller's cancel signal via `AbortSignal.any`.
 */
export const REQUEST_TIMEOUT_MS = 120_000;

export interface ContentGatewayError {
  kind: ContentGatewayErrorKind;
  status?: number;
  message: string;
}

export interface HttpContentGatewayOptions {
  baseUrl?: string;
  /** Injectable fetch (defaults to the global) for testability. */
  fetch?: typeof fetch;
}

interface GenerateResponseBody {
  passage: GenerationResponse['passage'];
  stop_reason: string;
}

/**
 * Classify a thrown fetch rejection. An aborted request rejects with a DOMException whose `name`
 * distinguishes the built-in timeout (`TimeoutError`) from a caller cancel (`AbortError`); anything
 * else is an ordinary transport `network` failure.
 */
function abortKind(cause: unknown): ContentGatewayErrorKind {
  if (cause instanceof DOMException) {
    if (cause.name === 'TimeoutError') return 'timeout';
    if (cause.name === 'AbortError') return 'aborted';
  }
  return 'network';
}

function kindForStatus(status: number): ContentGatewayErrorKind {
  switch (status) {
    case 400:
      return 'bad_request';
    case 404:
      return 'not_found';
    case 422:
      return 'validation';
    case 429:
      return 'rate_limited';
    case 503:
      return 'unavailable';
    default:
      return 'network';
  }
}

/**
 * Map the server's machine-readable error `code` (providers.ts ProviderErrorCode) to a gateway kind.
 * Only `not_configured` gets its own kind (it needs a distinct setup message); auth/upstream
 * failures collapse to `unavailable` and rate limits to `rate_limited`. Unknown codes return
 * undefined so `request` falls back to the HTTP status.
 */
function kindForCode(code: string): ContentGatewayErrorKind | undefined {
  switch (code) {
    case 'not_configured':
      return 'not_configured';
    case 'rate_limited':
      return 'rate_limited';
    case 'upstream_auth':
    case 'upstream_error':
      return 'unavailable';
    default:
      return undefined;
  }
}

export class HttpContentGateway implements ContentGateway {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpContentGatewayOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
    // Bind to the global: a bare `window.fetch` called as a method throws "Illegal
    // invocation" in browsers (Node's fetch is lax, so this only bites at runtime).
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async generatePassage(req: GenerationRequest, signal?: AbortSignal): Promise<GenerationResponse> {
    const body = await this.request<GenerateResponseBody>(
      '/api/passages:generate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      },
      signal,
    );
    return { passage: body.passage, stopReason: body.stop_reason as StopReason };
  }

  getWordData(wordId: string): Promise<WordData> {
    return this.request<WordData>(`/api/words/${encodeURIComponent(wordId)}`, { method: 'GET' });
  }

  async suggestWords(req: WordSuggestionRequest): Promise<string[]> {
    const body = await this.request<{ words: string[] }>('/api/words:suggest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    return Array.isArray(body.words) ? body.words : [];
  }

  async annotatePassage(req: PassageAnnotationRequest, signal?: AbortSignal): Promise<AnnotationResult> {
    const body = await this.request<{
      noticeCues?: NoticeCue[];
      annotationStatus?: AnnotationStatus;
      sentenceNotes?: SentenceSyntaxNote[];
    }>(
      '/api/passages:annotate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      },
      signal,
    );
    return {
      noticeCues: Array.isArray(body.noticeCues) ? body.noticeCues : [],
      // A gateway/mock that omits the status is treated as a clean pass (no banner).
      status: body.annotationStatus ?? 'complete',
      sentenceNotes: Array.isArray(body.sentenceNotes) ? body.sentenceNotes : [],
    };
  }

  async reviewSentence(req: ReviewSentenceRequest): Promise<string> {
    const body = await this.request<{ sentence?: string }>('/api/review:sentence', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    return typeof body.sentence === 'string' ? body.sentence : '';
  }

  async illustratePassage(req: PassageIllustrationRequest): Promise<string> {
    const body = await this.request<{ illustrationUrl?: string }>('/api/passages:illustrate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!body.illustrationUrl) throw this.fail('network', 200, new Error('illustration response missing illustrationUrl'));
    return body.illustrationUrl;
  }

  /** Probe GET /api/health so the UI can warn up-front when the generation key is unset. */
  async checkHealth(): Promise<GenerationHealth> {
    const body = await this.request<Partial<GenerationHealth>>('/api/health', { method: 'GET' });
    return {
      configured: body.configured === true,
      provider: body.provider === 'anthropic' ? 'anthropic' : 'openai',
    };
  }

  /**
   * Issue a request and normalize transport / status failures into ContentGatewayError. Every
   * request carries a built-in `REQUEST_TIMEOUT_MS` timeout; when a caller `signal` is supplied
   * (the generation-progress store's controller) the two are merged with `AbortSignal.any` so
   * either a timeout or a user cancel aborts the fetch. The two are told apart by the abort
   * reason (`TimeoutError` vs `AbortError`) so the UI can show a timeout message but silently
   * swallow a deliberate cancel.
   */
  private async request<T>(path: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, signal: composed });
    } catch (cause) {
      throw this.fail(abortKind(cause), undefined, cause);
    }
    if (!response.ok) {
      // Prefer the server's machine-readable `code` (e.g. not_configured) + `error` detail over a
      // status-only guess, so the UI can show a cause-specific message instead of "try again later".
      const parsed = await this.readErrorBody(response);
      const kind = (parsed.code && kindForCode(parsed.code)) || kindForStatus(response.status);
      const message = parsed.message ?? `request failed (${response.status})`;
      throw { kind, status: response.status, message } satisfies ContentGatewayError;
    }
    try {
      return (await response.json()) as T;
    } catch (cause) {
      throw this.fail('network', response.status, cause);
    }
  }

  /** Read a non-2xx body as `{ error, code }`; tolerates empty/non-JSON bodies (returns blanks). */
  private async readErrorBody(response: Response): Promise<{ code?: string; message?: string }> {
    try {
      const body = (await response.json()) as { code?: unknown; error?: unknown };
      return {
        code: typeof body.code === 'string' ? body.code : undefined,
        message: typeof body.error === 'string' && body.error.trim() ? body.error : undefined,
      };
    } catch {
      return {};
    }
  }

  private fail(kind: ContentGatewayErrorKind, status?: number, cause?: unknown): ContentGatewayError {
    const message = cause instanceof Error ? cause.message : `request failed${status ? ` (${status})` : ''}`;
    return { kind, status, message };
  }
}
