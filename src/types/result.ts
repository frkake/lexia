/**
 * L0 — `Result<T, E>` discriminated union.
 *
 * Every boundary (generation, TTS, persistence, adjacent fetch) expresses failure
 * with `Result`; the domain never throws (design.md "Error Handling"). Adjacent I/O
 * may reject Promises; the state layer normalizes those rejections into `Result`.
 */

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** Build a success variant. */
export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

/** Build a failure variant. */
export function err<E>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}

/** Narrowing guard for the success variant. */
export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok;
}

/** Narrowing guard for the failure variant. */
export function isErr<T, E>(r: Result<T, E>): r is { ok: false; error: E } {
  return !r.ok;
}

/** Transform the success value, leaving a failure untouched. */
export function map<T, E, U>(r: Result<T, E>, f: (value: T) => U): Result<U, E> {
  return r.ok ? ok(f(r.value)) : r;
}

/** Transform the error, leaving a success untouched. */
export function mapErr<T, E, F>(r: Result<T, E>, f: (error: E) => F): Result<T, F> {
  return r.ok ? r : err(f(r.error));
}

/** Return the success value, or `fallback` when the result is a failure. */
export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}
