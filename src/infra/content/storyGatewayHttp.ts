/**
 * L2 — HttpStoryGateway: the StoryGateway port over the thin server proxy (Requirement 6.2).
 * POSTs a StoryPlanRequest to `/api/story:plan` and reads back `{ storyPlan }`. Mirrors
 * HttpContentGateway's error normalization; there is no mock fallback (a missing/broken proxy
 * rejects, per the project's generation policy).
 */

import type { StoryGateway } from '../../types/ports';
import type { StoryPlan, StoryPlanRequest } from '../../types/domain';

export interface HttpStoryGatewayOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class HttpStoryGateway implements StoryGateway {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpStoryGatewayOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async planStory(req: StoryPlanRequest): Promise<StoryPlan> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/story:plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      });
    } catch (cause) {
      throw new Error(`story plan request failed: ${cause instanceof Error ? cause.message : 'network error'}`);
    }
    if (!response.ok) {
      throw new Error(`story plan request failed (${response.status})`);
    }
    const body = (await response.json()) as { storyPlan?: StoryPlan };
    if (!body.storyPlan) throw new Error('story plan response missing storyPlan');
    return body.storyPlan;
  }
}
