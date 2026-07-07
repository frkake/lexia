/**
 * L4 — AppShell: the resident layout (design.md "AppShell", 12.1–12.3). It owns the one
 * `<audio>` element for the whole session — mounted here (outside the router Outlet) so it
 * survives navigation and stays iOS-unlocked; the PlayerStore only swaps its `.src`. A rAF
 * loop ticks the store while playing so the seek position and follow-along highlight track.
 * Header (TopNav) + `<Outlet/>` + docked BottomPlayer; width — not route — picks the layout.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, ScrollRestoration } from 'react-router-dom';
import { TopNav } from './shared/TopNav';
import { BottomPlayer } from './BottomPlayer';
import { ToastViewport } from './shared/Toast';
import { GenerationIndicator, GenerationCompletionBridge } from './app/generationNotifications';
import { playerStore, usePlayerStore } from '../state/stores/playerStore';
import { useSessionStore } from '../state/stores/sessionStore';
import { colors } from './theme/tokens';
import { useOptionalContainer } from './app/AppContext';
import { ttsUnavailableReasonJa } from '../infra/tts/ttsBackendHttp';
import type { Container } from './app/container';
import type { IndexedPassage } from '../types/domain';

// Monotonic ticket for overlapping synthesize requests (▶ and the 声 chip can race):
// the newest request owns the player, older results are dropped when they settle.
let synthesisSeq = 0;

/**
 * Shared synthesize→persist-timing→load sequence (voice change and on-demand ▶ playback).
 * Audio is a data: URL and never persisted, so both paths must re-call the TTS port.
 * Failure degrades to 'unavailable' — text-only reading continues (task 10.4). A result
 * that settles stale (superseded, or the passage left the screen) never touches the player,
 * so callers may only play() on `true` — the loaded asset is then current.
 */
async function synthesizeAndLoad(target: Container, passage: IndexedPassage, voiceId: string): Promise<boolean> {
  const seq = ++synthesisSeq;
  target.player.getState().setStatus('loading');
  try {
    const { asset, timing } = await target.tts.synthesize(passage, voiceId);
    if (staleRequest(target, seq, passage)) return false;
    await target.repos.timingMaps.put(timing);
    if (staleRequest(target, seq, passage)) return false;
    target.player.getState().load(asset, timing);
    return true;
  } catch (error) {
    if (staleRequest(target, seq, passage)) return false;
    // Degrade WITH the cause: no cross-provider fallback exists any more, so an unconfigured
    // provider must read as "この話者では生成できない", not as silent audio from another voice.
    target.player.getState().setStatus('unavailable', ttsUnavailableReasonJa(error));
    return false;
  }
}

/**
 * A settling synthesize no longer owns the player when a newer request started after it
 * (latest-wins — e.g. the user switched voice mid-flight) or the user navigated to another
 * passage; the latter unloads back to 'idle' so stale audio never loads (or auto-plays)
 * over the new passage's text and its ▶ works immediately instead of sticking at 'loading'.
 */
function staleRequest(target: Container, seq: number, passage: IndexedPassage): boolean {
  if (seq !== synthesisSeq) return true;
  if (target.session.getState().passage?.passageId !== passage.passageId) {
    target.player.getState().unload();
    return true;
  }
  return false;
}

export function AppShell() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playing = usePlayerStore((s) => s.playing);
  const hasPassage = useSessionStore((s) => s.passage != null);
  const container = useOptionalContainer();
  // Voice ids the server .env can actually synthesize (null until reported / when unknown).
  // Drives the 声 chip cycling and the per-voice 生成不可 marking in the listen bar.
  const [availableVoiceIds, setAvailableVoiceIds] = useState<string[] | null>(null);

  // D-8: the docked listen bar appears whenever a passage is open. An unavailable TTS backend no
  // longer hides it — the bar stays and says WHY audio cannot be generated (and the 声 chip still
  // works, so switching to an available voice recovers narration on the spot).
  const playerVisible = hasPassage;

  // Ask the server which voices its .env can drive; absence of the endpoint keeps null (= unknown).
  useEffect(() => {
    if (!container?.tts.voices) return;
    let cancelled = false;
    container.tts
      .voices()
      .then((voices) => {
        if (cancelled || !voices) return;
        const ids = voices.filter((v) => v.available).map((v) => v.id);
        setAvailableVoiceIds(ids);
        // First-run default only: when the user has NEVER picked a voice and the catalog default's
        // provider is unconfigured, start on an available voice instead of a doomed one. A voice the
        // user chose is never overridden — unavailability is surfaced, not silently swapped.
        const chosen = container.settings.getState().voiceId;
        if (!chosen && ids.length > 0 && !ids.includes(container.voiceId)) {
          container.settings.getState().setVoice(ids[0]!);
          container.player.getState().setVoice(ids[0]!);
        }
      })
      .catch(() => {
        // Availability unknown (server unreachable): keep null — the chip cycles the full catalog.
      });
    return () => {
      cancelled = true;
    };
  }, [container]);

  // Reserve the docked-player gutter (global.css) only while the bar is actually shown.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('player-visible', playerVisible);
    return () => document.body.classList.remove('player-visible');
  }, [playerVisible]);

  // Bind the resident element once; thereafter only its src is swapped.
  useEffect(() => {
    if (audioRef.current) playerStore.getState().attach(audioRef.current);
  }, []);

  // Hydrated settings live in the app container; mirror the currently selected audio
  // preferences into the resident player without making AppShell untestable in isolation.
  useEffect(() => {
    if (!container) return;
    const { rate, voiceId } = container.settings.getState();
    container.player.getState().setRate(rate);
    if (voiceId) container.player.getState().setVoice(voiceId);
  }, [container]);

  // Drive the follow-along highlight while audio is playing.
  useEffect(() => {
    if (!playing || typeof requestAnimationFrame === 'undefined') return;
    let raf = 0;
    const loop = (): void => {
      playerStore.getState().tick();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const changeRate = (rate: number): void => {
    container?.settings.getState().setRate(rate);
  };

  const changeVoice = async (voiceId: string): Promise<void> => {
    const target = container;
    if (!target) {
      playerStore.getState().setVoice(voiceId);
      return;
    }

    target.settings.getState().setVoice(voiceId);
    const passage = target.session.getState().passage;
    if (!passage) {
      target.player.getState().setVoice(voiceId);
      return;
    }

    await synthesizeAndLoad(target, passage, voiceId);
  };

  // On-demand 朗読 for a revisited/restored passage: the bar sits in 'idle' until ▶ asks for
  // audio, then the passage×voice is synthesized lazily and playback starts.
  const requestAudio = async (): Promise<void> => {
    const target = container;
    if (!target) return;
    const passage = target.session.getState().passage;
    if (!passage) return;
    const player = target.player.getState();
    if (player.status === 'loading') return; // a synthesize is already in flight
    if (player.status === 'ready' && player.loadedPassageId === passage.passageId) {
      player.toggle();
      return;
    }
    const voiceId = target.settings.getState().voiceId || target.voiceId;
    if (await synthesizeAndLoad(target, passage, voiceId)) {
      target.player.getState().play();
    }
  };

  return (
    <div className="app-shell">
      {/* Reset scroll to the top on every navigation (D-7): data-router restoration so a
          generation-completed jump to /p/:id starts at the passage head, not the form's scroll. */}
      <ScrollRestoration />
      {/* D-7: settle-time navigate-vs-toast for an in-flight generation (renders nothing). */}
      <GenerationCompletionBridge />
      <header className="app-header">
        <TopNav />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* D-7: spinner + 「生成中…」 while a generation runs (visible on every screen). */}
          <GenerationIndicator />
          {/* F-9: the avatar is the entry point to /settings (previously an inert aria-hidden dummy). */}
          <Link
            to="/settings"
            aria-label="設定"
            data-testid="settings-entry"
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: colors.avatarBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              fontWeight: 600,
              color: colors.primary,
              textDecoration: 'none',
            }}
          >
            <span aria-hidden>K</span>
          </Link>
        </div>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      {playerVisible ? (
        <BottomPlayer
          onRateChange={changeRate}
          onVoiceChange={(voiceId) => void changeVoice(voiceId)}
          // Without a container there is no TTS port to synthesize with — the prop stays absent
          // and ▶ falls back to the plain singleton toggle (keeps AppShell renderable alone).
          onRequestAudio={container ? () => void requestAudio() : undefined}
          availableVoiceIds={availableVoiceIds ?? undefined}
        />
      ) : null}

      {/* Resident toast surface (D-8 / D6): every feature's success / error / Undo notice
          renders here, above the docked player, and survives navigation. */}
      <ToastViewport />

      {/* The one resident audio element — never unmounted, never recreated. */}
      <audio ref={audioRef} data-testid="app-audio" preload="none" />
    </div>
  );
}
