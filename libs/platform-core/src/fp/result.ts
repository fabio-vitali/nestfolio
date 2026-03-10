/**
 * Lightweight Result type for explicit error handling at handler boundaries.
 * Repositories keep throwing — use tryCatch() to bridge at handler/pipe boundaries.
 */
export type Result<T, E = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is { readonly ok: true; readonly value: T } => r.ok;

export const isErr = <T, E>(r: Result<T, E>): r is { readonly ok: false; readonly error: E } => !r.ok;

export function mapResult<T, U, E>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}

export function flatMapResult<T, U, E>(r: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> {
  return r.ok ? fn(r.value) : r;
}

/**
 * Bridge between throw-world and Result-world.
 * Wraps an async function that may throw into a Result.
 */
export async function tryCatch<T, E = Error>(
  fn: () => Promise<T>,
  mapError?: (e: unknown) => E,
): Promise<Result<T, E>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(mapError ? mapError(e) : (e as E));
  }
}
