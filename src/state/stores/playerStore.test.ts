import { describe, it, expect, vi } from 'vitest';
import { createPlayerStore } from './playerStore';
import type { ControllableAudio } from './playerStore';
import type { AudioAsset, TimingMap } from '../../types/domain';

function mockAudio(): ControllableAudio {
  return {
    src: '',
    currentTime: 0,
    duration: 1.2,
    playbackRate: 1,
    preservesPitch: true,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
  };
}

const asset: AudioAsset = {
  passageId: 'p1',
  voiceId: 'joanna',
  audioUrl: 'https://cdn/p1.mp3',
  format: 'audio/mpeg',
  durationMs: 1200,
  engine: 'polly',
};

const timing: TimingMap = {
  passageId: 'p1',
  voiceId: 'joanna',
  marks: [
    { tokenId: 'p1:0:0', startMs: 0, endMs: 300 },
    { tokenId: 'p1:0:1', startMs: 300, endMs: 600 },
    { tokenId: 'p1:0:2', startMs: 600, endMs: 1200 },
  ],
};

describe('PlayerStore', () => {
  it('loads an asset by swapping the source without recreating the element', () => {
    const audio = mockAudio();
    const store = createPlayerStore();
    store.getState().attach(audio);
    store.getState().load(asset, timing);

    expect(audio.src).toBe('https://cdn/p1.mp3');
    expect(store.getState().status).toBe('ready');
    expect(store.getState().durationMs).toBe(1200);
    expect(store.getState().currentTokenId).toBeNull();
  });

  it('toggles play/pause on the attached element', () => {
    const audio = mockAudio();
    const store = createPlayerStore();
    store.getState().attach(audio);
    store.getState().load(asset, timing);

    store.getState().toggle();
    expect(audio.play).toHaveBeenCalled();
    expect(store.getState().playing).toBe(true);

    store.getState().toggle();
    expect(audio.pause).toHaveBeenCalled();
    expect(store.getState().playing).toBe(false);
  });

  it('updates position, progress and the highlighted token on tick', () => {
    const audio = mockAudio();
    const store = createPlayerStore();
    store.getState().attach(audio);
    store.getState().load(asset, timing);

    audio.currentTime = 0.45; // 450ms → second token
    store.getState().tick();
    expect(store.getState().positionMs).toBe(450);
    expect(store.getState().progress).toBeCloseTo(0.375, 3);
    expect(store.getState().currentTokenId).toBe('p1:0:1');
  });

  it('seeks to a ratio of the duration and recomputes the active token', () => {
    const audio = mockAudio();
    const store = createPlayerStore();
    store.getState().attach(audio);
    store.getState().load(asset, timing);

    store.getState().seekTo(0.6); // 720ms → third token
    expect(audio.currentTime).toBeCloseTo(0.72, 3);
    expect(store.getState().currentTokenId).toBe('p1:0:2');
  });

  it('sets playback rate and preserves pitch', () => {
    const audio = mockAudio();
    const store = createPlayerStore();
    store.getState().attach(audio);
    store.getState().setRate(1.5);
    expect(audio.playbackRate).toBe(1.5);
    expect(audio.preservesPitch).toBe(true);
    expect(store.getState().rate).toBe(1.5);
  });

  it('records the selected voice for the caller to reload', () => {
    const store = createPlayerStore();
    store.getState().setVoice('matthew');
    expect(store.getState().voiceId).toBe('matthew');
  });

  it('plays a one-off word clip through the injected clip player', () => {
    const playClip = vi.fn();
    const store = createPlayerStore({ playClip });
    store.getState().playWord('https://cdn/word.mp3');
    expect(playClip).toHaveBeenCalledWith('https://cdn/word.mp3');
  });

  it('degrades to an unavailable status when audio synthesis fails', () => {
    const store = createPlayerStore();
    store.getState().setStatus('unavailable');
    expect(store.getState().status).toBe('unavailable');
  });
});
