import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VOICE_PROFILE_ID,
  VOICE_PROFILES,
  compatibleVoiceForProvider,
  defaultVoiceForAccent,
  defaultVoiceForProvider,
  defaultVoiceFromProviders,
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

  it('resolves an OpenAI profile for every accent so an OPENAI_API_KEY-only setup can narrate', () => {
    for (const accent of ['us', 'gb', 'au', 'in'] as const) {
      const fromAzure = compatibleVoiceForProvider(defaultVoiceForAccent(accent).id, 'openai');
      expect(fromAzure.provider, accent).toBe('openai');
      expect(fromAzure.accent, accent).toBe(accent);
      expect(defaultVoiceForProvider('openai', accent).accent, accent).toBe(accent);
    }
  });

  it('maps legacy Polly UI voice ids onto stable profile ids', () => {
    expect(resolveVoiceProfile('Joanna').id).toBe('polly-us-joanna');
    expect(resolveVoiceProfile('Amy').accent).toBe('gb');
  });

  it('cycles through stable profile ids and defaults safely', () => {
    expect(resolveVoiceProfile(undefined).id).toBe(DEFAULT_VOICE_PROFILE_ID);
    expect(nextVoiceProfileId(undefined)).toBe(VOICE_PROFILES[1]!.id);
  });

  it('cycles only the AVAILABLE voices when the server reported availability', () => {
    const openaiIds = VOICE_PROFILES.filter((v) => v.provider === 'openai').map((v) => v.id);
    // An unavailable current voice cycles INTO the available set instead of staying stuck.
    expect(openaiIds).toContain(nextVoiceProfileId('azure-us-jenny', openaiIds));
    // Within the set, cycling stays inside it and wraps.
    let id = openaiIds[0]!;
    for (let i = 0; i < openaiIds.length; i += 1) {
      id = nextVoiceProfileId(id, openaiIds);
      expect(openaiIds).toContain(id);
    }
    expect(id).toBe(openaiIds[0]); // wrapped around
    // An empty availability set (nothing synthesizable) degrades to whole-catalog cycling — every
    // voice is equally unavailable, so the chip stays usable instead of freezing.
    expect(nextVoiceProfileId('azure-us-jenny', [])).toBe(VOICE_PROFILES[1]!.id);
  });

  it('assigns scene speakers from the CONFIGURED providers only (availability-aware defaults)', () => {
    // OpenAI-only env: every accent/gender resolves to an OpenAI voice.
    for (const accent of ['us', 'gb', 'au', 'in'] as const) {
      expect(defaultVoiceFromProviders(['openai'], accent, 'female').provider).toBe('openai');
      expect(defaultVoiceFromProviders(['openai'], accent, 'male').provider).toBe('openai');
    }
    // An exact accent+gender match on a later provider beats a loose match on an earlier one:
    // Polly carries no US male voice, so the male guest lands on OpenAI's Onyx.
    const maleGuest = defaultVoiceFromProviders(['polly', 'openai'], 'us', 'male', 'guest');
    expect(maleGuest).toMatchObject({ provider: 'openai', gender: 'male', accent: 'us' });
    // Azure-first preference is preserved when azure is configured.
    expect(defaultVoiceFromProviders(['azure', 'openai'], 'us', 'female').provider).toBe('azure');
    // No provider configured: fall back to the catalog default (synthesis then reports not_configured).
    expect(defaultVoiceFromProviders([], 'us', 'female').id).toBe(defaultVoiceForAccent('us', 'female').id);
  });
});
