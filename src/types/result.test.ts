import { describe, it, expect } from 'vitest';
import { ok, err, isOk, isErr, map, mapErr, unwrapOr, type Result } from './result';

describe('Result', () => {
  it('ok() builds a success variant carrying the value', () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
    if (r.ok) expect(r.value).toBe(42);
  });

  it('err() builds a failure variant carrying the error', () => {
    const r = err({ kind: 'no_token' });
    expect(r.ok).toBe(false);
    expect(isErr(r)).toBe(true);
    expect(isOk(r)).toBe(false);
    if (!r.ok) expect(r.error).toEqual({ kind: 'no_token' });
  });

  it('map() transforms the value only on success', () => {
    const a: Result<number, string> = ok(3);
    const b = map(a, (n) => n * 2);
    expect(b).toEqual(ok(6));

    // Explicit type args: a const annotated with a union narrows to its assigned
    // variant, which would otherwise leave the unused type parameter `unknown`.
    expect(map<number, string, number>(err('boom'), (n) => n * 2)).toEqual(err('boom'));
  });

  it('mapErr() transforms the error only on failure', () => {
    expect(mapErr<number, string, string>(err('boom'), (s) => s.toUpperCase())).toEqual(
      err('BOOM'),
    );
    expect(mapErr<number, string, string>(ok(3), (s) => s.toUpperCase())).toEqual(ok(3));
  });

  it('unwrapOr() returns the value on success and the fallback on failure', () => {
    expect(unwrapOr(ok(5), 0)).toBe(5);
    expect(unwrapOr(err('x') as Result<number, string>, 0)).toBe(0);
  });
});
