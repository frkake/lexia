import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as params from './parameters';

/**
 * C-5a reconciliation test. Parses ONLY the ◎-marked rows of the 設定値 table in
 * `docs/learning-policy.md` and asserts every machine-readable `NAME=value` token
 * there equals the constant that `parameters.ts` exports. This is the CI guard that
 * makes the policy document and the code constants a single source of truth; ◎-less
 * rows (段階 2/3 recall formats, prose-only guidance) are intentionally out of scope.
 */

const POLICY_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/learning-policy.md',
);

/** A markdown table row of the 設定値 table that carries the ◎ CI-reconcile marker. */
interface PolicyRow {
  readonly line: string;
  /** `[NAME, value]` pairs pulled from `` `NAME=value` `` tokens in that row. */
  readonly tokens: ReadonlyArray<readonly [string, string]>;
}

function policyRows(): PolicyRow[] {
  const md = readFileSync(POLICY_PATH, 'utf8');
  return md
    .split('\n')
    .filter((line) => line.trimStart().startsWith('|') && line.includes('◎'))
    .map((line) => ({
      line,
      tokens: [...line.matchAll(/`([A-Z][A-Z0-9_]*)=([0-9]+(?:\.[0-9]+)?)`/g)].map(
        (m) => [m[1]!, m[2]!] as const,
      ),
    }));
}

describe('learning-policy.md ◎ table ↔ parameters.ts', () => {
  const rows = policyRows();
  const tokens = rows.flatMap((row) => row.tokens);

  it('locates ◎ rows carrying machine-readable NAME=value constants', () => {
    // Guards against a silently-passing it.each when the parse breaks (e.g. the
    // table is reformatted or the ◎ marker is dropped).
    expect(rows.length).toBeGreaterThan(0);
    expect(tokens.length).toBeGreaterThanOrEqual(5);
  });

  it.each(tokens.map(([name, value]) => ({ name, value })))(
    'policy constant $name=$value matches the exported value',
    ({ name, value }) => {
      const actual = (params as Record<string, unknown>)[name];
      expect(actual, `${name} must be exported from parameters.ts`).toBeTypeOf('number');
      expect(actual).toBe(Number(value));
    },
  );

  it('◎ 初回表示ラダー row matches FIRST_DISPLAY_LADDER_MS', () => {
    expect(params.FIRST_DISPLAY_LADDER_MS).toEqual({
      1: 10 * params.MINUTE_MS,
      2: 1 * params.DAY_MS,
      3: 4 * params.DAY_MS,
      4: 10 * params.DAY_MS,
    });
    const ladder = rows.find((row) => row.line.includes('初回表示ラダー'));
    expect(ladder, '初回表示ラダー ◎ row exists').toBeDefined();
    expect(ladder?.line).toMatch(/Again 10分/);
    expect(ladder?.line).toMatch(/Hard 1日/);
    expect(ladder?.line).toMatch(/Good 4日/);
    expect(ladder?.line).toMatch(/Easy 10日/);
  });

  it('◎ 受動再認 24h cross-source cooldown matches DAILY_COOLDOWN_MS', () => {
    expect(params.DAILY_COOLDOWN_MS).toBe(params.DAY_MS);
    const cooldown = rows.find((row) => row.line.includes('DAILY_COOLDOWN_MS'));
    expect(cooldown, '受動再認 ◎ row names DAILY_COOLDOWN_MS').toBeDefined();
    expect(cooldown?.line).toMatch(/24h/);
  });

  it('covers every ◎ scalar policy constant the loop reads', () => {
    // The reconciled set must at least include the four C-5a additions plus the
    // two pre-existing scalars the policy table pins.
    const names = new Set(tokens.map(([name]) => name));
    for (const required of [
      'DESIRED_RETENTION',
      'SESSION_REVIEW_LIMIT',
      'DAILY_REVIEW_LIMIT',
      'DAILY_NEW_WORD_LIMIT',
      'PASSIVE_RECALL_DECAY',
      'LEECH_LAPSE_THRESHOLD',
    ]) {
      expect(names, `${required} appears as a ◎ NAME=value token`).toContain(required);
    }
  });
});
