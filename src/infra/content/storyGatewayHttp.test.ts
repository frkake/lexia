import { describe, it, expect, vi } from 'vitest';
import { HttpStoryGateway } from './storyGatewayHttp';
import type { CharacterIllustrationRequest, StoryPlan, StoryPlanRequest } from '../../types/domain';

const req: StoryPlanRequest = { contentType: 'short_story', genre: 'fantasy', intent: 'daily', level: 'B1' };

const plan: StoryPlan = {
  storyId: 's1',
  contentType: 'short_story',
  genre: 'fantasy',
  titleJa: '物語',
  synopsisJa: 'あらすじ',
  characters: [{ name: 'Aria', role: 'hero', descriptionJa: '少女' }],
  chapters: [{ index: 0, headingJa: '第一章', beatJa: 'ビート' }],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('HttpStoryGateway.planStory', () => {
  it('POSTs to /api/story:plan and returns the story plan', async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init };
      return jsonResponse(200, { storyPlan: plan });
    });
    const gw = new HttpStoryGateway({ fetch: fetchImpl as unknown as typeof fetch });
    const result = await gw.planStory(req);
    expect(captured!.url).toContain('/api/story:plan');
    expect(captured!.init?.method).toBe('POST');
    expect(result.titleJa).toBe('物語');
    expect(result.chapters).toHaveLength(1);
  });

  it('rejects (no mock fallback) on a non-2xx status', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, { error: 'down' }));
    const gw = new HttpStoryGateway({ fetch: fetchImpl as unknown as typeof fetch });
    await expect(gw.planStory(req)).rejects.toBeTruthy();
  });
});

describe('HttpStoryGateway.extendStoryPlan', () => {
  it('POSTs to /api/story:extend and returns the extended story plan', async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    const extended = { ...plan, chapters: [...plan.chapters, { index: 1, headingJa: '第二章', beatJa: '続き' }] };
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init };
      return jsonResponse(200, { storyPlan: extended });
    });
    const gw = new HttpStoryGateway({ fetch: fetchImpl as unknown as typeof fetch });
    const result = await gw.extendStoryPlan({ plan, nextChapterIndex: 1, priorSummaryJa: '前章の要約' });
    expect(captured!.url).toContain('/api/story:extend');
    expect(captured!.init?.method).toBe('POST');
    expect(JSON.parse(String(captured!.init?.body))).toMatchObject({ nextChapterIndex: 1 });
    expect(result.chapters).toHaveLength(2);
  });

  it('rejects (no mock fallback) on a non-2xx status', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, { error: 'down' }));
    const gw = new HttpStoryGateway({ fetch: fetchImpl as unknown as typeof fetch });
    await expect(gw.extendStoryPlan({ plan, nextChapterIndex: 1 })).rejects.toBeTruthy();
  });
});

describe('HttpStoryGateway.illustrateCharacter (Requirement 6.8)', () => {
  const charReq: CharacterIllustrationRequest = {
    name: 'Aria',
    role: 'hero',
    descriptionJa: '勇敢な少女',
    genre: 'fantasy',
  };

  it('POSTs to /api/story:illustrate and returns the illustration data URL', async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init };
      return jsonResponse(200, { illustrationUrl: 'data:image/png;base64,QUJD' });
    });
    const gw = new HttpStoryGateway({ fetch: fetchImpl as unknown as typeof fetch });
    const result = await gw.illustrateCharacter(charReq);
    expect(captured!.url).toContain('/api/story:illustrate');
    expect(captured!.init?.method).toBe('POST');
    expect(result).toBe('data:image/png;base64,QUJD');
  });

  it('rejects (no mock fallback) on a non-2xx status', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, { error: 'down' }));
    const gw = new HttpStoryGateway({ fetch: fetchImpl as unknown as typeof fetch });
    await expect(gw.illustrateCharacter(charReq)).rejects.toBeTruthy();
  });
});
