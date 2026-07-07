/**
 * English voice catalog shared by UI and server-side TTS provider resolution.
 * `id` is the app-stable value persisted as Settings.voiceId; providerVoiceId is the
 * engine-specific voice name used at synthesis time.
 */

import type { EnglishAccent, VoiceGender, VoiceProfile, VoiceProvider, VoiceRole } from '../../types/domain';

export const DEFAULT_VOICE_PROFILE_ID = 'azure-us-jenny';

export const VOICE_PROFILES: VoiceProfile[] = [
  {
    id: DEFAULT_VOICE_PROFILE_ID,
    labelJa: 'アメリカ英語 Jenny',
    accent: 'us',
    gender: 'female',
    role: 'narrator',
    provider: 'azure',
    providerVoiceId: 'en-US-JennyNeural',
    locale: 'en-US',
  },
  {
    id: 'azure-us-guy',
    labelJa: 'アメリカ英語 Guy',
    accent: 'us',
    gender: 'male',
    role: 'guest',
    provider: 'azure',
    providerVoiceId: 'en-US-GuyNeural',
    locale: 'en-US',
  },
  {
    id: 'azure-gb-sonia',
    labelJa: 'イギリス英語 Sonia',
    accent: 'gb',
    gender: 'female',
    role: 'announcer',
    provider: 'azure',
    providerVoiceId: 'en-GB-SoniaNeural',
    locale: 'en-GB',
  },
  {
    id: 'azure-gb-ryan',
    labelJa: 'イギリス英語 Ryan',
    accent: 'gb',
    gender: 'male',
    role: 'guest',
    provider: 'azure',
    providerVoiceId: 'en-GB-RyanNeural',
    locale: 'en-GB',
  },
  {
    id: 'azure-au-natasha',
    labelJa: 'オーストラリア英語 Natasha',
    accent: 'au',
    gender: 'female',
    role: 'interviewer',
    provider: 'azure',
    providerVoiceId: 'en-AU-NatashaNeural',
    locale: 'en-AU',
  },
  {
    id: 'azure-au-william',
    labelJa: 'オーストラリア英語 William',
    accent: 'au',
    gender: 'male',
    role: 'guest',
    provider: 'azure',
    providerVoiceId: 'en-AU-WilliamNeural',
    locale: 'en-AU',
  },
  {
    id: 'azure-in-neerja',
    labelJa: 'インド英語 Neerja',
    accent: 'in',
    gender: 'female',
    role: 'interviewer',
    provider: 'azure',
    providerVoiceId: 'en-IN-NeerjaNeural',
    locale: 'en-IN',
  },
  {
    id: 'azure-in-prabhat',
    labelJa: 'インド英語 Prabhat',
    accent: 'in',
    gender: 'male',
    role: 'guest',
    provider: 'azure',
    providerVoiceId: 'en-IN-PrabhatNeural',
    locale: 'en-IN',
  },
  {
    id: 'polly-us-joanna',
    labelJa: 'アメリカ英語 Joanna',
    accent: 'us',
    gender: 'female',
    role: 'narrator',
    provider: 'polly',
    providerVoiceId: 'Joanna',
    locale: 'en-US',
  },
  {
    id: 'polly-gb-amy',
    labelJa: 'イギリス英語 Amy',
    accent: 'gb',
    gender: 'female',
    role: 'announcer',
    provider: 'polly',
    providerVoiceId: 'Amy',
    locale: 'en-GB',
  },
  {
    id: 'polly-au-olivia',
    labelJa: 'オーストラリア英語 Olivia',
    accent: 'au',
    gender: 'female',
    role: 'interviewer',
    provider: 'polly',
    providerVoiceId: 'Olivia',
    locale: 'en-AU',
  },
  {
    id: 'polly-in-kajal',
    labelJa: 'インド英語 Kajal',
    accent: 'in',
    gender: 'female',
    role: 'guest',
    provider: 'polly',
    providerVoiceId: 'Kajal',
    locale: 'en-IN',
  },
  // OpenAI TTS voices carry no inherent accent; the profile's accent is realized at
  // synthesis time via model instructions (server/tts/providers.ts), so every accent
  // below resolves even though the underlying voices are accent-neutral.
  {
    id: 'openai-us-nova',
    labelJa: 'アメリカ英語 Nova (OpenAI)',
    accent: 'us',
    gender: 'female',
    role: 'narrator',
    provider: 'openai',
    providerVoiceId: 'nova',
    locale: 'en-US',
  },
  {
    id: 'openai-us-onyx',
    labelJa: 'アメリカ英語 Onyx (OpenAI)',
    accent: 'us',
    gender: 'male',
    role: 'guest',
    provider: 'openai',
    providerVoiceId: 'onyx',
    locale: 'en-US',
  },
  {
    id: 'openai-gb-shimmer',
    labelJa: 'イギリス英語 Shimmer (OpenAI)',
    accent: 'gb',
    gender: 'female',
    role: 'announcer',
    provider: 'openai',
    providerVoiceId: 'shimmer',
    locale: 'en-GB',
  },
  {
    id: 'openai-gb-fable',
    labelJa: 'イギリス英語 Fable (OpenAI)',
    accent: 'gb',
    gender: 'male',
    role: 'guest',
    provider: 'openai',
    providerVoiceId: 'fable',
    locale: 'en-GB',
  },
  {
    id: 'openai-au-coral',
    labelJa: 'オーストラリア英語 Coral (OpenAI)',
    accent: 'au',
    gender: 'female',
    role: 'interviewer',
    provider: 'openai',
    providerVoiceId: 'coral',
    locale: 'en-AU',
  },
  {
    id: 'openai-au-echo',
    labelJa: 'オーストラリア英語 Echo (OpenAI)',
    accent: 'au',
    gender: 'male',
    role: 'guest',
    provider: 'openai',
    providerVoiceId: 'echo',
    locale: 'en-AU',
  },
  {
    id: 'openai-in-sage',
    labelJa: 'インド英語 Sage (OpenAI)',
    accent: 'in',
    gender: 'female',
    role: 'interviewer',
    provider: 'openai',
    providerVoiceId: 'sage',
    locale: 'en-IN',
  },
  {
    id: 'openai-in-ash',
    labelJa: 'インド英語 Ash (OpenAI)',
    accent: 'in',
    gender: 'male',
    role: 'guest',
    provider: 'openai',
    providerVoiceId: 'ash',
    locale: 'en-IN',
  },
];

const LEGACY_POLLY_IDS: Record<string, string> = {
  Joanna: 'polly-us-joanna',
  Matthew: 'azure-us-guy',
  Amy: 'polly-gb-amy',
};

export function resolveVoiceProfile(id: string | undefined): VoiceProfile {
  const normalized = id && LEGACY_POLLY_IDS[id] ? LEGACY_POLLY_IDS[id] : id;
  return VOICE_PROFILES.find((v) => v.id === normalized) ?? VOICE_PROFILES[0]!;
}

export function voiceProfilesForAccent(accent: EnglishAccent): VoiceProfile[] {
  return VOICE_PROFILES.filter((v) => v.accent === accent);
}

export function defaultVoiceForAccent(accent: EnglishAccent, gender?: VoiceGender, role?: VoiceRole): VoiceProfile {
  return (
    VOICE_PROFILES.find((v) => v.accent === accent && v.provider === 'azure' && (!gender || v.gender === gender) && (!role || v.role === role)) ??
    VOICE_PROFILES.find((v) => v.accent === accent && v.provider === 'azure' && (!gender || v.gender === gender)) ??
    VOICE_PROFILES.find((v) => v.accent === accent && v.provider === 'azure') ??
    VOICE_PROFILES.find((v) => v.accent === accent) ??
    VOICE_PROFILES[0]!
  );
}

export function defaultVoiceForProvider(
  provider: VoiceProvider,
  accent: EnglishAccent,
  gender?: VoiceGender,
  role?: VoiceRole,
): VoiceProfile {
  return (
    VOICE_PROFILES.find((v) => v.provider === provider && v.accent === accent && (!gender || v.gender === gender) && (!role || v.role === role)) ??
    VOICE_PROFILES.find((v) => v.provider === provider && v.accent === accent && (!gender || v.gender === gender)) ??
    VOICE_PROFILES.find((v) => v.provider === provider && v.accent === accent) ??
    VOICE_PROFILES.find((v) => v.provider === provider) ??
    defaultVoiceForAccent(accent, gender, role)
  );
}

export function compatibleVoiceForProvider(id: string | undefined, provider: VoiceProvider): VoiceProfile {
  const requested = resolveVoiceProfile(id);
  return requested.provider === provider
    ? requested
    : defaultVoiceForProvider(provider, requested.accent, requested.gender, requested.role);
}

/**
 * Best voice for accent/gender/role among the CONFIGURED providers only (in the given preference
 * order), so scene speakers are assigned voices that can actually be synthesized instead of the
 * catalog-wide azure-first default. Falls back tier-by-tier (drop role, then gender, then accent)
 * across the whole configured pool before relaxing, so an exact match on a later provider beats a
 * loose match on an earlier one. With NO configured provider, keeps the catalog-wide default —
 * synthesis then reports not_configured explicitly.
 */
export function defaultVoiceFromProviders(
  providers: VoiceProvider[],
  accent: EnglishAccent,
  gender?: VoiceGender,
  role?: VoiceRole,
): VoiceProfile {
  const pool = VOICE_PROFILES.filter((v) => providers.includes(v.provider));
  if (pool.length === 0) return defaultVoiceForAccent(accent, gender, role);
  const tiers: ((v: VoiceProfile) => boolean)[] = [
    (v) => v.accent === accent && (!gender || v.gender === gender) && (!role || v.role === role),
    (v) => v.accent === accent && (!gender || v.gender === gender),
    (v) => v.accent === accent,
    () => true,
  ];
  for (const matches of tiers) {
    const hit = pool.find(matches);
    if (hit) return hit;
  }
  return pool[0]!;
}

/**
 * Cycle to the next voice, restricted to `availableIds` when the server reported availability
 * (undefined = unknown → cycle the whole catalog). An unavailable current voice cycles into the
 * available set instead of staying stuck.
 */
export function nextVoiceProfileId(currentId: string | undefined, availableIds?: readonly string[]): string {
  const pool =
    availableIds && availableIds.length > 0
      ? VOICE_PROFILES.filter((v) => availableIds.includes(v.id))
      : VOICE_PROFILES;
  if (pool.length === 0) return resolveVoiceProfile(currentId).id;
  const current = resolveVoiceProfile(currentId);
  const i = pool.findIndex((v) => v.id === current.id);
  return pool[(i + 1) % pool.length]!.id;
}
