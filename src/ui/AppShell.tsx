/**
 * L4 — AppShell: the resident layout (design.md "AppShell", 12.1–12.3). It owns the one
 * `<audio>` element for the whole session — mounted here (outside the router Outlet) so it
 * survives navigation and stays iOS-unlocked; the PlayerStore only swaps its `.src`. A rAF
 * loop ticks the store while playing so the seek position and follow-along highlight track.
 * Header (TopNav) + `<Outlet/>` + docked BottomPlayer; width — not route — picks the layout.
 */

import { useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { TopNav } from './shared/TopNav';
import { BottomPlayer } from './BottomPlayer';
import { playerStore, usePlayerStore } from '../state/stores/playerStore';
import { colors } from './theme/tokens';
import { useOptionalContainer } from './app/AppContext';

export function AppShell() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playing = usePlayerStore((s) => s.playing);
  const container = useOptionalContainer();

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
      <header className="app-header">
        <TopNav />
        <div
          aria-hidden
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
          }}
        >
          K
        </div>
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <BottomPlayer onRateChange={changeRate} onVoiceChange={(voiceId) => void changeVoice(voiceId)} />

      {/* The one resident audio element — never unmounted, never recreated. */}
      <audio ref={audioRef} data-testid="app-audio" preload="none" />
    </div>
  );
}
