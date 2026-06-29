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

import type { ContentGateway } from '../../types/ports';
import type { GenerationRequest, GenerationResponse, StopReason, WordData } from '../../types/domain';

export type ContentGatewayErrorKind =
  | 'bad_request'
  | 'not_found'
  | 'validation'
  | 'rate_limited'
  | 'unavailable'
  | 'network';

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

export class HttpContentGateway implements ContentGateway {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpContentGatewayOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
    // Bind to the global: a bare `window.fetch` called as a method throws "Illegal
    // invocation" in browsers (Node's fetch is lax, so this only bites at runtime).
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async generatePassage(req: GenerationRequest): Promise<GenerationResponse> {
    const body = await this.request<GenerateResponseBody>('/api/passages:generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    return { passage: body.passage, stopReason: body.stop_reason as StopReason };
  }

  getWordData(wordId: string): Promise<WordData> {
    return this.request<WordData>(`/api/words/${encodeURIComponent(wordId)}`, { method: 'GET' });
  }

  /** Issue a request and normalize transport / status failures into ContentGatewayError. */
  private async request<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    } catch (cause) {
      throw this.fail('network', undefined, cause);
    }
    if (!response.ok) {
      throw this.fail(kindForStatus(response.status), response.status);
    }
    try {
      return (await response.json()) as T;
    } catch (cause) {
      throw this.fail('network', response.status, cause);
    }
  }

  private fail(kind: ContentGatewayErrorKind, status?: number, cause?: unknown): ContentGatewayError {
    const message = cause instanceof Error ? cause.message : `request failed${status ? ` (${status})` : ''}`;
    return { kind, status, message };
  }
}
