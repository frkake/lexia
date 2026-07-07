/**
 * L4 — BottomPlayer: the docked listen bar (design.md Reading frame "docked listen bar",
 * 7.1/7.3/7.4/7.5/12.2). Pure transport controls bound to the singleton PlayerStore;
 * the resident `<audio>` itself lives in the AppShell so it survives navigation. Shows
 * play/pause, elapsed/total clock, a seek slider, the rate cycle, the voice and the
 * follow-highlight toggle, and degrades its label when audio is loading/unavailable.
 */

import { colors, fonts, radius, shadow } from './theme/tokens';
import { usePlayerStore, playerStore } from '../state/stores/playerStore';
import { useSessionStore } from '../state/stores/sessionStore';
import { nextVoiceProfileId, resolveVoiceProfile } from '../domain/audio/voiceCatalog';

const RATES = [1, 1.25, 1.5, 0.75] as const;

/** Format an elapsed/total millisecond count as `m:ss`. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export interface BottomPlayerProps {
  /** Surface of the word currently under the playhead (resolved by the reading wiring). */
  nowReading?: string;
  onRateChange?: (rate: number) => void;
  onVoiceChange?: (voiceId: string) => void;
  /**
   * Invoked instead of toggle() when ▶ is pressed with nothing playable loaded for the
   * current passage (revisit / restored session — audio is synthesized on demand upstream).
   */
  onRequestAudio?: () => void;
  /**
   * Voice ids the server .env can synthesize (from /api/tts:voices). The 声 chip cycles only
   * these, and a current voice outside the set is marked 生成不可. Undefined = unknown →
   * the chip cycles the whole catalog.
   */
  availableVoiceIds?: readonly string[];
}

const chip = (active = false): React.CSSProperties => ({
  fontFamily: fonts.ui,
  fontSize: 12,
  fontWeight: 600,
  color: active ? colors.primary : colors.inkSoft,
  background: active ? colors.surfaceBlue : '#F1F4F8',
  border: `1px solid ${active ? colors.primaryBorder : colors.borderControl}`,
  borderRadius: radius.control,
  padding: '6px 11px',
  cursor: 'pointer',
});

export function BottomPlayer({
  nowReading,
  onRateChange,
  onVoiceChange,
  onRequestAudio,
  availableVoiceIds,
}: BottomPlayerProps) {
  const status = usePlayerStore((s) => s.status);
  const playing = usePlayerStore((s) => s.playing);
  const rate = usePlayerStore((s) => s.rate);
  const voiceId = usePlayerStore((s) => s.voiceId);
  const unavailableReason = usePlayerStore((s) => s.unavailableReason);
  const positionMs = usePlayerStore((s) => s.positionMs);
  const durationMs = usePlayerStore((s) => s.durationMs);
  const progress = usePlayerStore((s) => s.progress);
  const loadedPassageId = usePlayerStore((s) => s.loadedPassageId);
  const passageId = useSessionStore((s) => s.passage?.passageId ?? null);

  // Nothing playable is loaded for the passage on screen (never after a load(); audio is a
  // data: URL and not persisted, so a revisit needs an upstream on-demand synthesize).
  const needsAudio = status === 'idle' || (passageId != null && loadedPassageId !== passageId);

  const pressPlay = (): void => {
    if (onRequestAudio && !playing && needsAudio) onRequestAudio();
    else playerStore.getState().toggle(); // pause keeps toggling — never re-synthesizes mid-listen
  };

  const label =
    status === 'loading'
      ? '音声準備中'
      : status === 'unavailable'
        ? '音声を利用できません'
        : '全文を朗読';

  const cycleRate = (): void => {
    const i = RATES.indexOf(rate as (typeof RATES)[number]);
    const next = RATES[(i + 1) % RATES.length] ?? 1;
    playerStore.getState().setRate(next);
    onRateChange?.(next);
  };

  const cycleVoice = (): void => {
    const next = nextVoiceProfileId(voiceId, availableVoiceIds);
    playerStore.getState().setVoice(next);
    onVoiceChange?.(next);
  };
  const voice = resolveVoiceProfile(voiceId);
  // Explicit unavailability marker: the server no longer swaps in another provider's voice, so a
  // voice outside the available set is called out here instead of playing something else.
  const voiceUnavailable = availableVoiceIds != null && !availableVoiceIds.includes(voice.id);

  return (
    <div
      className="bottom-player"
      style={{
        borderTop: `1px solid ${colors.borderControl}`,
        background: colors.surfaceCard,
        padding: '13px 28px',
        display: 'flex',
        alignItems: 'center',
        gap: 22,
        boxShadow: shadow.dock,
      }}
    >
      <button
        type="button"
        aria-label={playing ? '一時停止' : '再生'}
        disabled={status === 'unavailable'}
        onClick={pressPlay}
        style={{
          flex: 'none',
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: colors.primary,
          border: 'none',
          color: '#fff',
          cursor: status === 'unavailable' ? 'not-allowed' : 'pointer',
          boxShadow: shadow.play,
        }}
      >
        {playing ? '❚❚' : '▶'}
      </button>

      <div className="bottom-player-label" style={{ flex: 'none', width: 186 }}>
        <div style={{ fontFamily: fonts.ui, fontSize: 13, fontWeight: 600, color: colors.ink }}>
          {label} <span style={{ color: colors.faint, fontWeight: 400 }}>· Listen</span>
        </div>
        {status === 'unavailable' && unavailableReason ? (
          <div
            data-testid="tts-unavailable-reason"
            style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 2 }}
          >
            {unavailableReason}
          </div>
        ) : nowReading ? (
          <div style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 2 }}>
            いま読んでいる:{' '}
            <span style={{ color: colors.primary, fontStyle: 'italic', fontFamily: fonts.serif }}>
              {nowReading}
            </span>
          </div>
        ) : null}
      </div>

      <div className="bottom-player-seek" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <span style={{ fontFamily: fonts.num, fontSize: 12, color: colors.muted, flex: 'none' }}>
          {formatClock(positionMs)}
        </span>
        <input
          type="range"
          aria-label="再生位置"
          min={0}
          max={1000}
          value={Math.round(progress * 1000)}
          onChange={(e) => playerStore.getState().seekTo(Number(e.target.value) / 1000)}
          style={{ flex: 1, accentColor: colors.primary }}
        />
        <span style={{ fontFamily: fonts.num, fontSize: 12, color: colors.muted, flex: 'none' }}>
          {formatClock(durationMs)}
        </span>
      </div>

      <div className="bottom-player-controls" style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" aria-label={`再生速度 ${rate}倍`} onClick={cycleRate} style={chip()}>
          {rate.toFixed(rate % 1 === 0 ? 1 : 2)}×
        </button>
        <button type="button" aria-label={`声を切り替え 現在 ${voice.labelJa}`} onClick={cycleVoice} style={chip()}>
          声: {voice.labelJa}
          {voiceUnavailable ? <span style={{ color: colors.faint, fontWeight: 400 }}>（生成不可）</span> : null}
        </button>
      </div>
    </div>
  );
}
