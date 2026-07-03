import { describe, it, expect } from 'vitest';
import { DEFAULT_FEATURE_FLAGS, resolveFeatureFlags, type FeatureFlags } from './featureFlags';

describe('featureFlags scaffold (7.4 / 9.2)', () => {
  it('every flag is a boolean (typed staged-rollout switches)', () => {
    const values = Object.values(DEFAULT_FEATURE_FLAGS);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((v) => typeof v === 'boolean')).toBe(true);
  });

  it('ships the completed display + generation clusters ON by default', () => {
    // Reading layout (Req 1–4) and generation setup (Req 5/7/8/9) are implemented end-to-end.
    expect(DEFAULT_FEATURE_FLAGS.newReadingLayout).toBe(true);
    expect(DEFAULT_FEATURE_FLAGS.newGenerationSetup).toBe(true);
  });

  it('ships the story cluster ON by default once the confirmation gate is wired', () => {
    // The story flow (Requirement 6) now goes through plan -> confirm -> chapter generation.
    expect(DEFAULT_FEATURE_FLAGS.storyMode).toBe(true);
  });

  it('enables character illustrations by default (6.8 — graceful when no image API)', () => {
    // Rides inside storyMode; on by default so stories are illustrated when an image API is configured.
    expect(DEFAULT_FEATURE_FLAGS.characterIllustrations).toBe(true);
  });

  it('enables passage illustrations by default (graceful when no image API)', () => {
    expect(DEFAULT_FEATURE_FLAGS.passageIllustrations).toBe(true);
  });

  it('resolves to the defaults when no overrides are given', () => {
    expect(resolveFeatureFlags()).toEqual(DEFAULT_FEATURE_FLAGS);
  });

  it('applies overrides over the defaults without mutating the defaults', () => {
    // Override the default-on flag OFF to prove the override path works (kill-switch).
    const resolved = resolveFeatureFlags({ newReadingLayout: false });
    expect(resolved.newReadingLayout).toBe(false);
    // Other flags stay at their default (storyMode remains on).
    expect(resolved.storyMode).toBe(true);
    // The shared default object is not mutated.
    expect(DEFAULT_FEATURE_FLAGS.newReadingLayout).toBe(true);
  });

  it('ignores unknown override keys (only known flags are resolved)', () => {
    const resolved = resolveFeatureFlags({ bogus: true } as unknown as Partial<FeatureFlags>);
    expect((resolved as unknown as Record<string, unknown>).bogus).toBeUndefined();
  });
});
