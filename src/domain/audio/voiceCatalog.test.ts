import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VOICE_PROFILE_ID,
  VOICE_PROFILES,
  compatibleVoiceForProvider,
  defaultVoiceForAccent,
  defaultVoiceForProvider,
  nextVoiceProfileId,
  resolveVoiceProfile,
  voiceProfilesForAccent,
} from './voiceCatalog';
import type { EnglishAccent } from '../../types/domain';

describe('voiceCatalog', () => {
  it('covers the required US, UK, Australian and Indian English accents', () => {
    const accents: EnglishAccent[] = ['us', 'gb', 'au', 'in'];
    for (const accent of accents) {
      expect(voiceProfilesForAccent(accent).length, accent).toBeGreaterThanOrEqual(1);
      expect(defaultVoiceForAccent(accent).accent).toBe(accent);
    }
  });

  it('offers Azure voices for every required accent so WordBoundary timing can be used', () => {
    for (const accent of ['us', 'gb', 'au', 'in'] as const) {
      expect(VOICE_PROFILES.some((v) => v.accent === accent && v.provider === 'azure')).toBe(true);
    }
  });

  it('resolves compatible provider fallbacks without leaking engine-specific voice ids', () => {
    expect(defaultVoiceForProvider('polly', 'in').providerVoiceId).toBe('Kajal');
    expect(compatibleVoiceForProvider('azure-in-prabhat', 'polly').id).toBe('polly-in-kajal');
    expect(compatibleVoiceForProvider('polly-gb-amy', 'azure').id).toBe('azure-gb-sonia');
  });

  it('maps legacy Polly UI voice ids onto stable profile ids', () => {
    expect(resolveVoiceProfile('Joanna').id).toBe('polly-us-joanna');
    expect(resolveVoiceProfile('Amy').accent).toBe('gb');
  });

  it('cycles through stable profile ids and defaults safely', () => {
    expect(resolveVoiceProfile(undefined).id).toBe(DEFAULT_VOICE_PROFILE_ID);
    expect(nextVoiceProfileId(undefined)).toBe(VOICE_PROFILES[1]!.id);
  });
});
