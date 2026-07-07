/**
 * L3 — PlayerStore: controls the single, app-resident `<audio>` element that survives
 * route changes (design.md "PlayerStore + HighlightController", 7.1–7.6, 12.2/12.3).
 * The element is attached once by the AppShell and thereafter only its `.src` is
 * swapped (never recreated — iOS keeps it unlocked). A rAF `tick()` reads currentTime,
 * binary-searches the active TimingMap by token and toggles the follow-along highlight;
 * seek / voice changes recompute it. Staged readiness + TTS-failure degrade are modeled
 * by `status` (`loading` → `ready`, or `unavailable`).
 */

import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { findActiveTokenId } from './highlightController';
import type { AudioAsset, TimingMap, TokenId } from '../../types/domain';

/** Minimal element surface the store drives (HTMLAudioElement satisfies it). */
export interface ControllableAudio {
  src: string;
  currentTime: number;
  duration: number;
  playbackRate: number;
  preservesPitch?: boolean;
  play(): Promise<void> | void;
  pause(): void;
}

export type PlayerStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface PlayerState {
  audio: ControllableAudio | null;
  status: PlayerStatus;
  playing: boolean;
  rate: number;
  voiceId: string;
  currentTokenId: TokenId | null;
  durationMs: number;
  positionMs: number;
  progress: number;
  asset: AudioAsset | null;
  timing: TimingMap | null;
  /** passageId of the loaded AudioAsset (null when nothing playable is loaded). */
  loadedPassageId: string | null;
  /** Why status is 'unavailable' (user-facing, e.g. この話者の音声はこの環境では生成できません); null otherwise. */
  unavailableReason: string | null;

  /** Bind the resident element once (AppShell). Applies the current rate/pitch. */
  attach(audio: ControllableAudio): void;
  /** `reason` is shown in the listen bar when `status` is 'unavailable'; ignored otherwise. */
  setStatus(status: PlayerStatus, reason?: string): void;
  load(asset: AudioAsset, timing: TimingMap): void;
  /** Back to the empty 'idle' bar: drop the loaded asset/timing (keeps rate/voice prefs). */
  unload(): void;
  toggle(): void;
  play(): void;
  pause(): void;
  /** Seek to a 0..1 fraction of the duration and recompute the active token. */
  seekTo(ratio: number): void;
  setRate(rate: number): void;
  setVoice(voiceId: string): void;
  /** Fire a one-off word-pronunciation clip (must originate inside a tap handler). */
  playWord(url: string): void;
  /** rAF callback: refresh position / progress / highlighted token. */
  tick(): void;
}

export interface PlayerStoreDeps {
  /** One-off clip player (defaults to a transient Audio element when available). */
  playClip?: (url: string) => void;
}

function defaultPlayClip(url: string): void {
  if (typeof Audio !== 'undefined') {
    void new Audio(url).play();
  }
}

export type PlayerStore = ReturnType<typeof createPlayerStore>;

export function createPlayerStore(deps: PlayerStoreDeps = {}) {
  const playClip = deps.playClip ?? defaultPlayClip;

  return createStore<PlayerState>()((set, get) => {
    /** Recompute position/progress/token from the element's current time. */
    const refresh = (): void => {
      const { audio, timing, durationMs } = get();
      if (!audio) return;
      const positionMs = audio.currentTime * 1000;
      const total = audio.duration > 0 ? audio.duration * 1000 : durationMs;
      const progress = total > 0 ? Math.min(1, positionMs / total) : 0;
      const currentTokenId = timing ? findActiveTokenId(timing.marks, positionMs) : null;
      set({ positionMs, durationMs: total, progress, currentTokenId });
    };

    return {
      audio: null,
      status: 'idle',
      playing: false,
      rate: 1,
      voiceId: '',
      currentTokenId: null,
      durationMs: 0,
      positionMs: 0,
      progress: 0,
      asset: null,
      timing: null,
      loadedPassageId: null,
      unavailableReason: null,

      attach(audio) {
        audio.playbackRate = get().rate;
        if ('preservesPitch' in audio) audio.preservesPitch = true;
        set({ audio });
      },

      setStatus(status, reason) {
        set({ status, unavailableReason: status === 'unavailable' ? (reason ?? null) : null });
      },

      load(asset, timing) {
        const { audio } = get();
        if (audio) {
          audio.src = asset.audioUrl; // swap source only; element is never recreated
          audio.currentTime = 0;
        }
        set({
          asset,
          timing,
          loadedPassageId: asset.passageId,
          unavailableReason: null,
          voiceId: asset.voiceId,
          durationMs: asset.durationMs,
          status: 'ready',
          playing: false,
          positionMs: 0,
          progress: 0,
          currentTokenId: null,
        });
      },

      unload() {
        // Stale-passage cleanup: pause and clear the source so the previous passage's audio
        // can never keep playing (or be resumed) over another passage's text.
        const { audio } = get();
        if (audio) {
          audio.pause();
          audio.src = '';
        }
        set({
          asset: null,
          timing: null,
          loadedPassageId: null,
          unavailableReason: null,
          status: 'idle',
          playing: false,
          durationMs: 0,
          positionMs: 0,
          progress: 0,
          currentTokenId: null,
        });
      },

      toggle() {
        if (get().playing) get().pause();
        else get().play();
      },

      play() {
        const { audio } = get();
        if (audio) void audio.play();
        set({ playing: true });
      },

      pause() {
        const { audio } = get();
        if (audio) audio.pause();
        set({ playing: false });
      },

      seekTo(ratio) {
        const { audio, durationMs } = get();
        const clamped = Math.min(1, Math.max(0, ratio));
        if (audio && durationMs > 0) {
          audio.currentTime = (clamped * durationMs) / 1000;
        }
        refresh();
      },

      setRate(rate) {
        const { audio } = get();
        if (audio) {
          audio.playbackRate = rate;
          if ('preservesPitch' in audio) audio.preservesPitch = true;
        }
        set({ rate });
      },

      setVoice(voiceId) {
        // The caller reloads the asset for the new voice via load().
        set({ voiceId });
      },

      playWord(url) {
        playClip(url);
      },

      tick() {
        refresh();
      },
    };
  });
}

/** App-wide singleton player (one resident element for the whole session). */
export const playerStore = createPlayerStore();

/** React selector hook over the singleton. */
export function usePlayerStore<T>(selector: (state: PlayerState) => T): T {
  return useStore(playerStore, selector);
}
