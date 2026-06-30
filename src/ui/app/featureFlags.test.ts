import { describe, it, expect } from 'vitest';
import { DEFAULT_FEATURE_FLAGS, resolveFeatureFlags, type FeatureFlags } from './featureFlags';

describe('featureFlags scaffold (7.4 / 9.2)', () => {
  it('every flag is a boolean (typed staged-rollout switches)', () => {
    const values = Object.values(DEFAULT_FEATURE_FLAGS);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((v) => typeof v === 'boolean')).toBe(true);
  });

  it('ships the completed display-improvement cluster ON by default (newReadingLayout)', () => {
    // The reading-layout cluster (Requirements 1–4) is implemented end-to-end, so it ships on.
    expect(DEFAULT_FEATURE_FLAGS.newReadingLayout).toBe(true);
  });

  it('keeps the not-yet-built generation/story clusters OFF by default', () => {
    // These phases are not implemented yet, so they stay default-off to preserve behavior.
    expect(DEFAULT_FEATURE_FLAGS.newGenerationSetup).toBe(false);
    expect(DEFAULT_FEATURE_FLAGS.storyMode).toBe(false);
  });

  it('resolves to the defaults when no overrides are given', () => {
    expect(resolveFeatureFlags()).toEqual(DEFAULT_FEATURE_FLAGS);
  });

  it('applies overrides over the defaults without mutating the defaults', () => {
    // Override the default-on flag OFF to prove the override path works (kill-switch).
    const resolved = resolveFeatureFlags({ newReadingLayout: false });
    expect(resolved.newReadingLayout).toBe(false);
    // Other flags stay at their default.
    expect(resolved.newGenerationSetup).toBe(false);
    // The shared default object is not mutated.
    expect(DEFAULT_FEATURE_FLAGS.newReadingLayout).toBe(true);
  });

  it('ignores unknown override keys (only known flags are resolved)', () => {
    const resolved = resolveFeatureFlags({ bogus: true } as unknown as Partial<FeatureFlags>);
    expect((resolved as unknown as Record<string, unknown>).bogus).toBeUndefined();
  });
});
