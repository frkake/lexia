// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { BottomPlayer, formatClock } from './BottomPlayer';
import { playerStore } from '../state/stores/playerStore';
import type { AudioAsset, TimingMap } from '../types/domain';

const asset: AudioAsset = {
  passageId: 'p1',
  voiceId: 'Emma',
  audioUrl: 'https://cdn/p1.mp3',
  format: 'audio/mpeg',
  durationMs: 134_000,
  engine: 'polly',
};
const timing: TimingMap = { passageId: 'p1', voiceId: 'Emma', marks: [] };

beforeEach(() => {
  act(() => {
    playerStore.setState({
      status: 'idle',
      playing: false,
      rate: 1,
      voiceId: '',
      durationMs: 0,
      positionMs: 0,
      progress: 0,
      asset: null,
      timing: null,
      audio: null,
    });
  });
});

describe('formatClock', () => {
  it('formats milliseconds as m:ss', () => {
    expect(formatClock(28_000)).toBe('0:28');
    expect(formatClock(134_000)).toBe('2:14');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(605_000)).toBe('10:05');
  });
});

describe('<BottomPlayer/>', () => {
  it('shows the total duration once an asset is loaded', () => {
    act(() => playerStore.getState().load(asset, timing));
    const { getByText } = render(<BottomPlayer />);
    expect(getByText('2:14')).toBeTruthy();
  });

  it('toggles playback when the play button is pressed', () => {
    act(() => playerStore.getState().load(asset, timing));
    const { getByRole } = render(<BottomPlayer />);
    expect(playerStore.getState().playing).toBe(false);
    fireEvent.click(getByRole('button', { name: '再生' }));
    expect(playerStore.getState().playing).toBe(true);
  });

  it('cycles the playback rate', () => {
    const onRateChange = vi.fn();
    act(() => playerStore.getState().load(asset, timing));
    const { getByRole } = render(<BottomPlayer onRateChange={onRateChange} />);
    fireEvent.click(getByRole('button', { name: /再生速度/ }));
    expect(playerStore.getState().rate).not.toBe(1);
    expect(onRateChange).toHaveBeenCalledWith(playerStore.getState().rate);
  });

  it('cycles the reading voice through the voice-switch control', () => {
    const onVoiceChange = vi.fn();
    act(() => playerStore.getState().load(asset, timing));
    const { getByRole } = render(<BottomPlayer onVoiceChange={onVoiceChange} />);
    fireEvent.click(getByRole('button', { name: /声を切り替え/ }));
    expect(playerStore.getState().voiceId).toBe('azure-us-guy');
    expect(onVoiceChange).toHaveBeenCalledWith('azure-us-guy');
  });

  it('degrades to an audio-preparing label while loading', () => {
    act(() => playerStore.getState().setStatus('loading'));
    const { getByText } = render(<BottomPlayer />);
    expect(getByText(/音声準備中/)).toBeTruthy();
  });
});
