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

export function AppShell() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playing = usePlayerStore((s) => s.playing);

  // Bind the resident element once; thereafter only its src is swapped.
  useEffect(() => {
    if (audioRef.current) playerStore.getState().attach(audioRef.current);
  }, []);

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

      <BottomPlayer />

      {/* The one resident audio element — never unmounted, never recreated. */}
      <audio ref={audioRef} data-testid="app-audio" preload="none" />
    </div>
  );
}
