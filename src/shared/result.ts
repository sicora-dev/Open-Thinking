/**
 * Result type for explicit error handling.
 * All core functions return Result instead of throwing.
 */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

/** Create a success result */
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

/** Create a failure result */
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Map over a success value */
export const map = <T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> =>
  result.ok ? ok(fn(result.value)) : result;

/** FlatMap (chain) over a success value */
export const flatMap = <T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> => (result.ok ? fn(result.value) : result);

/** Unwrap a result, throwing if it's an error (use only at boundaries) */
export const unwrap = <T, E>(result: Result<T, E>): T => {
  if (result.ok) return result.value;
  throw result.error instanceof Error ? result.error : new Error(String(result.error));
};

/** Unwrap with a default value */
export const unwrapOr = <T, E>(result: Result<T, E>, defaultValue: T): T =>
  result.ok ? result.value : defaultValue;

/** Collect an array of Results into a Result of array */
export const collect = <T, E>(results: Result<T, E>[]): Result<T[], E> => {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
};

/** Try-catch wrapper that returns a Result */
export const tryCatch = <T>(fn: () => T): Result<T, Error> => {
  try {
    return ok(fn());
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
};

/** Async try-catch wrapper */
export const tryCatchAsync = async <T>(fn: () => Promise<T>): Promise<Result<T, Error>> => {
  try {
    return ok(await fn());
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
};
