/**
 * L4 — Feature-flag scaffold for the learning-experience-overhaul staged rollout (design.md
 * "Migration Strategy", Option C). Every flag DEFAULTS TO OFF so the existing behavior is
 * preserved until a flag is explicitly turned on; later phases (generation expansion, stories)
 * reuse this same scaffold as their staged-shipping switch. Plain data + a pure resolver — no
 * I/O — so it is trivially testable and can be driven from a settings store or env later.
 */

export interface FeatureFlags {
  /** Display-improvement cluster (Requirements 1–4): the 3-zone reading layout. */
  newReadingLayout: boolean;
  /** Generation-expansion cluster (Requirements 7–9): the reworked setup → request pipeline. */
  newGenerationSetup: boolean;
  /** Story cluster (Requirement 6): the plan → confirm → chapter story flow. */
  storyMode: boolean;
}

/**
 * Default rollout state. A flag turns on only when its cluster is implemented end-to-end:
 * `newReadingLayout` (Requirements 1–4) is complete and ships ON; the generation/story phases are
 * not built yet and stay OFF so existing behavior is preserved until they land. `resolveFeatureFlags`
 * still lets a caller override any flag (e.g. a kill-switch or an env read).
 */
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  newReadingLayout: true,
  newGenerationSetup: false,
  storyMode: false,
};

/**
 * Resolve the effective flags by layering known overrides over the defaults. Unknown keys in the
 * overrides are ignored (only declared flags are resolved) and the shared defaults are never
 * mutated — callers always get a fresh object.
 */
export function resolveFeatureFlags(overrides?: Partial<FeatureFlags>): FeatureFlags {
  const resolved: FeatureFlags = { ...DEFAULT_FEATURE_FLAGS };
  if (overrides) {
    for (const key of Object.keys(DEFAULT_FEATURE_FLAGS) as (keyof FeatureFlags)[]) {
      const value = overrides[key];
      if (typeof value === 'boolean') resolved[key] = value;
    }
  }
  return resolved;
}
