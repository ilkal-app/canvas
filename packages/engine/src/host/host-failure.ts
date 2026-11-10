/** A cloneable description of a failure (an `Error` does not survive cloning intact). */
export interface HostFailure {
  /** The original error's `name`, for example `RangeError`. */
  readonly name: string;
  /** The original error's message. */
  readonly message: string;
}

/**
 * Describes a thrown value as a cloneable {@link HostFailure}.
 *
 * @param error - What was thrown; non-`Error` values are converted to text.
 * @returns The failure.
 */
export function describeHostFailure(error: unknown): HostFailure {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: 'Error', message: String(error) };
}

/**
 * Rebuilds an `Error` from a received {@link HostFailure}.
 *
 * @param failure - The failure.
 * @returns An error with its name and message.
 */
export function toHostError(failure: HostFailure): Error {
  const error = new Error(failure.message);
  error.name = failure.name;
  return error;
}
