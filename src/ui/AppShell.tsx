/**
 * L4 — AppShell: the resident layout (design.md "AppShell", 12.1–12.3). It owns the one
 * `<audio>` element for the whole session — mounted here (outside the router Outlet) so it
 * survives navigation and stays iOS-unlocked; the PlayerStore only swaps its `.src`. A rAF
 * loop ticks the store while playing so the seek position and follow-along highlight track.
 * Header (TopNav) + `<Outlet/>` + docked BottomPlayer; width — not route — picks the layout.
 */

import { useEffect, useRef } from 'react';
import { Link, Outlet, ScrollRestoration } from 'react-router-dom';
import { TopNav } from './shared/TopNav';
import { BottomPlayer } from './BottomPlayer';
import { ToastViewport } from './shared/Toast';
import { GenerationIndicator, GenerationCompletionBridge } from './app/generationNotifications';
import { playerStore, usePlayerStore } from '../state/stores/playerStore';
import { useSessionStore } from '../state/stores/sessionStore';
import { colors } from './theme/tokens';
import { useOptionalContainer } from './app/AppContext';

export function AppShell() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playing = usePlayerStore((s) => s.playing);
  const playerStatus = usePlayerStore((s) => s.status);
  const hasPassage = useSessionStore((s) => s.passage != null);
  const container = useOptionalContainer();

  // D-8: the docked listen bar only appears when there is something to listen to. With no open passage
  // (nothing to read) or an unavailable TTS backend (nothing it can play), it renders neither the
  // transport controls nor the bottom padding they reserve — no dead, silent player on every route.
  const playerVisible = hasPassage && playerStatus !== 'unavailable';

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

    target.player.getState().setStatus('loading');
    try {
      const { asset, timing } = await target.tts.synthesize(passage, voiceId);
      await target.repos.timingMaps.put(timing);
      target.player.getState().load(asset, timing);
    } catch {
      target.player.getState().setStatus('unavailable');
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
        <BottomPlayer onRateChange={changeRate} onVoiceChange={(voiceId) => void changeVoice(voiceId)} />
      ) : null}

      {/* Resident toast surface (D-8 / D6): every feature's success / error / Undo notice
          renders here, above the docked player, and survives navigation. */}
      <ToastViewport />

      {/* The one resident audio element — never unmounted, never recreated. */}
      <audio ref={audioRef} data-testid="app-audio" preload="none" />
    </div>
  );
}
