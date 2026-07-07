// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AppShell } from './AppShell';
import { AppProvider } from './app/AppContext';
import { createContainer, degradingTts } from './app/container';
import type { Container } from './app/container';
import { LexiaDb } from '../infra/persistence/lexiaDb';
import { playerStore } from '../state/stores/playerStore';
import type { ControllableAudio } from '../state/stores/playerStore';
import { sessionStore } from '../state/stores/sessionStore';
import { createSettingsStore } from '../state/stores/settingsStore';
import type { ContentGateway, TtsSynthesisPort } from '../types/ports';
import type { AudioAsset, TimingMap, UserId } from '../types/domain';

function routerAt(path: string) {
  return createMemoryRouter(
    [
      {
        path: '/',
        element: <AppShell />,
        children: [
          { index: true, element: <div data-testid="dash">dashboard</div> },
          { path: 'library', element: <div data-testid="library">library</div> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
}

function mockAudio(): ControllableAudio {
  return {
    src: '',
    currentTime: 0,
    duration: 0,
    playbackRate: 1,
    preservesPitch: true,
    play: () => Promise.resolve(),
    pause: () => {},
  };
}

const unusedGateway: ContentGateway = {
  async generatePassage() {
    throw new Error('unused');
  },
  async getWordData() {
    throw new Error('unused');
  },
};

/** TTS port whose synthesize calls stay pending until the test settles them, in any order. */
function deferredTts(): { tts: TtsSynthesisPort; pending: Array<{ voiceId: string; settle: () => void }> } {
  const pending: Array<{ voiceId: string; settle: () => void }> = [];
  const tts: TtsSynthesisPort = {
    synthesize: (passage, voiceId) =>
      new Promise<{ asset: AudioAsset; timing: TimingMap }>((resolve) => {
        pending.push({
          voiceId,
          settle: () =>
            resolve({
              asset: {
                passageId: passage.passageId,
                voiceId,
                audioUrl: `data:audio/wav;base64,${voiceId}`,
                format: 'audio/wav',
                durationMs: 1_200,
                engine: 'azure',
              },
              timing: { passageId: passage.passageId, voiceId, marks: [] },
            }),
        });
      }),
    async wordClipUrl() {
      throw new Error('unused');
    },
  };
  return { tts, pending };
}

/** Container over fake-indexeddb bound to the SINGLETON stores (what the bar renders from). */
async function shellContainer(userId: UserId, tts: TtsSynthesisPort): Promise<Container> {
  const db = new LexiaDb(String(userId));
  await db.open();
  return createContainer(userId, {
    db,
    content: unusedGateway,
    tts,
    now: () => 1_000,
    session: sessionStore,
    player: playerStore,
    settings: createSettingsStore(),
  });
}

describe('<AppShell/>', () => {
  beforeEach(() => {
    // Reset the shared singletons so the conditional player (D-8) starts hidden each test.
    act(() => {
      sessionStore.setState({ passage: null });
      playerStore.setState({
        status: 'idle',
        playing: false,
        asset: null,
        timing: null,
        loadedPassageId: null,
        audio: null,
      });
    });
  });

  it('renders the outlet content and attaches the resident audio to the player store', () => {
    const router = routerAt('/');
    const { getByTestId } = render(<RouterProvider router={router} />);
    expect(getByTestId('dash')).toBeTruthy();
    const audio = getByTestId('app-audio');
    expect(playerStore.getState().audio).toBe(audio);
  });

  it('keeps the same <audio> element mounted across navigation (7.1)', async () => {
    const router = routerAt('/');
    const { getByTestId } = render(<RouterProvider router={router} />);
    const before = getByTestId('app-audio');
    await act(async () => {
      await router.navigate('/library');
    });
    expect(getByTestId('library')).toBeTruthy();
    expect(getByTestId('app-audio')).toBe(before); // never recreated
  });

  it('hides the docked player and reserves no gutter when there is no open passage (D-8)', () => {
    const router = routerAt('/');
    const { container } = render(<RouterProvider router={router} />);
    // Nothing to listen to → no dead, silent player and no reserved bottom padding.
    expect(container.querySelector('.bottom-player')).toBeNull();
    expect(document.body.classList.contains('player-visible')).toBe(false);
    expect(container.querySelector('.app-shell')).not.toBeNull();
  });

  it('docks the player and marks the body player-visible once a passage is open and audio is available (D-8)', () => {
    act(() => {
      sessionStore.setState({ passage: { passageId: 'p1' } as never });
      playerStore.setState({ status: 'ready' });
    });
    const router = routerAt('/');
    const { container } = render(<RouterProvider router={router} />);
    expect(container.querySelector('.bottom-player')).not.toBeNull();
    expect(document.body.classList.contains('player-visible')).toBe(true);
  });

  it('keeps the bar visible and states WHY when TTS is unavailable (no silent disappearance)', () => {
    // There is no cross-provider fallback: an unconfigured provider must read as「生成できない」,
    // so the bar stays (▶ disabled, reason shown, 声 chip still usable to switch to a working voice).
    act(() => {
      sessionStore.setState({ passage: { passageId: 'p1' } as never });
      playerStore.setState({ status: 'unavailable', unavailableReason: 'この話者の音声はこの環境では生成できません。' });
    });
    const router = routerAt('/');
    const { container, getByTestId, getByRole } = render(<RouterProvider router={router} />);
    expect(container.querySelector('.bottom-player')).not.toBeNull();
    expect(getByTestId('tts-unavailable-reason').textContent).toContain('生成できません');
    expect((getByRole('button', { name: '再生' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('synthesizes on demand and starts playback when ▶ is pressed on a revisited passage', async () => {
    const synthesizedWith: string[] = [];
    const tts: TtsSynthesisPort = {
      async synthesize(passage, voiceId) {
        synthesizedWith.push(voiceId);
        return {
          asset: {
            passageId: passage.passageId,
            voiceId,
            audioUrl: 'data:audio/wav;base64,AA==',
            format: 'audio/wav',
            durationMs: 1_200,
            engine: 'azure',
          },
          timing: { passageId: passage.passageId, voiceId, marks: [] },
        };
      },
      async wordClipUrl() {
        throw new Error('unused');
      },
    };
    const container = await shellContainer('shell_ondemand_user' as UserId, tts);
    act(() => sessionStore.setState({ passage: { passageId: 'p1' } as never }));
    const router = routerAt('/');
    const { getByRole } = render(
      <AppProvider container={container}>
        <RouterProvider router={router} />
      </AppProvider>,
    );
    const audio = mockAudio();
    act(() => playerStore.getState().attach(audio)); // mock element: jsdom media has no playback

    // Idle bar (nothing loaded — a revisit) → ▶ lazily synthesizes, loads, and plays.
    fireEvent.click(getByRole('button', { name: '再生' }));
    await waitFor(() => expect(playerStore.getState().status).toBe('ready'));
    expect(playerStore.getState().loadedPassageId).toBe('p1');
    expect(playerStore.getState().playing).toBe(true);
    expect(audio.src).toBe('data:audio/wav;base64,AA==');
    expect(synthesizedWith).toEqual([container.voiceId]); // settings empty → container default voice

    // Pause / resume reuse the loaded asset — no re-synthesis mid-listen.
    fireEvent.click(getByRole('button', { name: '一時停止' }));
    expect(playerStore.getState().playing).toBe(false);
    fireEvent.click(getByRole('button', { name: '再生' }));
    expect(playerStore.getState().playing).toBe(true);
    expect(synthesizedWith).toHaveLength(1);
  });

  it('degrades the on-demand path to unavailable when synthesis fails (text-only reading)', async () => {
    const container = await shellContainer('shell_ondemand_degrade_user' as UserId, degradingTts);
    act(() => sessionStore.setState({ passage: { passageId: 'p1' } as never }));
    const router = routerAt('/');
    const { getByRole, container: dom } = render(
      <AppProvider container={container}>
        <RouterProvider router={router} />
      </AppProvider>,
    );

    fireEvent.click(getByRole('button', { name: '再生' }));
    await waitFor(() => expect(playerStore.getState().status).toBe('unavailable'));
    // Same degrade as generation-time: reading continues text-only, and the bar STAYS with the
    // failure reason instead of vanishing (生成できないことがわかる).
    expect(playerStore.getState().playing).toBe(false);
    expect(dom.querySelector('.bottom-player')).not.toBeNull();
    expect(playerStore.getState().unavailableReason).toBeTruthy();
  });

  it('drops an in-flight ▶ synthesis when the learner moves to another passage (no stale autoplay)', async () => {
    const { tts, pending } = deferredTts();
    const container = await shellContainer('shell_stale_flight_user' as UserId, tts);
    act(() => sessionStore.setState({ passage: { passageId: 'p1' } as never }));
    const router = routerAt('/');
    const { getByRole } = render(
      <AppProvider container={container}>
        <RouterProvider router={router} />
      </AppProvider>,
    );
    const audio = mockAudio();
    act(() => playerStore.getState().attach(audio));

    fireEvent.click(getByRole('button', { name: '再生' }));
    expect(playerStore.getState().status).toBe('loading');

    // Another passage opens while p1's multi-second synthesize is still in flight.
    act(() => sessionStore.setState({ passage: { passageId: 'p2' } as never }));
    await act(async () => pending[0]!.settle());

    // p1's late result is dropped: nothing loads or auto-plays over p2's text, and the bar
    // settles at 'idle' so p2's ▶ synthesizes immediately instead of sticking at 'loading'.
    await waitFor(() => expect(playerStore.getState().status).toBe('idle'));
    expect(playerStore.getState().loadedPassageId).toBeNull();
    expect(playerStore.getState().playing).toBe(false);
    expect(audio.src).toBe('');
  });

  it('lets the newest request win when the voice is switched during an in-flight ▶ synthesis', async () => {
    const { tts, pending } = deferredTts();
    const container = await shellContainer('shell_voice_race_user' as UserId, tts);
    act(() => {
      sessionStore.setState({ passage: { passageId: 'p1' } as never });
      playerStore.setState({ voiceId: '' }); // deterministic 声-chip cycle start
    });
    const router = routerAt('/');
    const { getByRole } = render(
      <AppProvider container={container}>
        <RouterProvider router={router} />
      </AppProvider>,
    );
    const audio = mockAudio();
    act(() => playerStore.getState().attach(audio));

    fireEvent.click(getByRole('button', { name: '再生' })); // default-voice synthesize in flight
    fireEvent.click(getByRole('button', { name: /声を切り替え/ })); // switch voice mid-flight
    expect(pending).toHaveLength(2);
    const switchedTo = pending[1]!.voiceId;
    expect(switchedTo).not.toBe(pending[0]!.voiceId);

    // The newer (voice-change) request resolves first; the abandoned ▶ result lands last.
    await act(async () => pending[1]!.settle());
    await waitFor(() => expect(playerStore.getState().status).toBe('ready'));
    await act(async () => pending[0]!.settle());

    // Last-writer must NOT win: the selected voice's asset stays loaded, and the stale ▶
    // result neither overwrites it nor starts playback of the voice the user switched away from.
    expect(playerStore.getState().status).toBe('ready');
    expect(playerStore.getState().asset?.voiceId).toBe(switchedTo);
    expect(playerStore.getState().voiceId).toBe(switchedTo);
    expect(playerStore.getState().playing).toBe(false);
  });
});
