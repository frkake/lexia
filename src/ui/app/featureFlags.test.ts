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

  it('keeps the not-yet-built story cluster OFF by default', () => {
    // The story flow (Requirement 6) is not fully wired yet, so it stays default-off.
    expect(DEFAULT_FEATURE_FLAGS.storyMode).toBe(false);
  });

  it('resolves to the defaults when no overrides are given', () => {
    expect(resolveFeatureFlags()).toEqual(DEFAULT_FEATURE_FLAGS);
  });

  it('applies overrides over the defaults without mutating the defaults', () => {
    // Override the default-on flag OFF to prove the override path works (kill-switch).
    const resolved = resolveFeatureFlags({ newReadingLayout: false });
    expect(resolved.newReadingLayout).toBe(false);
    // Other flags stay at their default (storyMode is still off).
    expect(resolved.storyMode).toBe(false);
    // The shared default object is not mutated.
    expect(DEFAULT_FEATURE_FLAGS.newReadingLayout).toBe(true);
  });

  it('ignores unknown override keys (only known flags are resolved)', () => {
    const resolved = resolveFeatureFlags({ bogus: true } as unknown as Partial<FeatureFlags>);
    expect((resolved as unknown as Record<string, unknown>).bogus).toBeUndefined();
  });
});
