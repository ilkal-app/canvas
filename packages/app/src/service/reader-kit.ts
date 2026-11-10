import { ApiError } from './api-error.js';

// The building blocks of the readers of the service's answers (api-shapes.ts,
// entitlement-shapes.ts): each checks a value and throws an `unavailable` ApiError for anything
// else, so a page never renders an answer it did not expect.

/** Reads one value of an answer, or throws. */
export type Reader<T> = (value: unknown) => T;

/**
 * The failure of a reader.
 *
 * @returns The error.
 */
export function malformed(): ApiError {
  return new ApiError('unavailable');
}

/**
 * Reads a string.
 *
 * @param value - The value.
 * @returns It.
 * @throws {ApiError} `unavailable` when it is not a string.
 */
export const text: Reader<string> = (value) => {
  if (typeof value !== 'string') throw malformed();
  return value;
};

/**
 * Reads a string that must not be empty.
 *
 * @param value - The value.
 * @returns It.
 * @throws {ApiError} `unavailable` when it is not a non-empty string.
 */
export const filledText: Reader<string> = (value) => {
  const read = text(value);
  if (read === '') throw malformed();
  return read;
};

/**
 * Reads a string or null.
 *
 * @param value - The value.
 * @returns It.
 * @throws {ApiError} `unavailable` otherwise.
 */
export const textOrNull: Reader<string | null> = (value) => (value === null ? null : text(value));

/**
 * Reads a boolean.
 *
 * @param value - The value.
 * @returns It.
 * @throws {ApiError} `unavailable` otherwise.
 */
export const flag: Reader<boolean> = (value) => {
  if (typeof value !== 'boolean') throw malformed();
  return value;
};

/**
 * Makes a reader of one of a few strings.
 *
 * @param allowed - The strings.
 * @returns The reader.
 */
export function oneOf<T extends string>(allowed: readonly T[]): Reader<T> {
  return (value) => {
    if (!(allowed as readonly unknown[]).includes(value)) throw malformed();
    return value as T;
  };
}

/**
 * Makes a reader of an object from readers of its fields. A field whose reader gives
 * `undefined` (an optional one) is left out.
 *
 * @param fields - A reader per field.
 * @returns The reader.
 */
export function record<T>(fields: { readonly [K in keyof T]: Reader<T[K]> }): Reader<T> {
  return (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw malformed();
    const source = value as Record<string, unknown>;
    const read: Record<string, unknown> = {};
    for (const [name, reader] of Object.entries(fields as Record<string, Reader<unknown>>)) {
      const field = reader(source[name]);
      if (field !== undefined) read[name] = field;
    }
    return read as T;
  };
}

/**
 * Makes a reader of a list.
 *
 * @param item - The reader of an item.
 * @returns The reader.
 */
export function list<T>(item: Reader<T>): Reader<readonly T[]> {
  return (value) => {
    if (!Array.isArray(value)) throw malformed();
    return value.map((entry) => item(entry));
  };
}

/**
 * Makes a reader of a field that may be absent.
 *
 * @param reader - The reader when present.
 * @returns The reader.
 */
export function optional<T>(reader: Reader<T>): Reader<T | undefined> {
  return (value) => (value === undefined ? undefined : reader(value));
}

/**
 * Makes a reader of an answer that wraps one field, giving the field.
 *
 * @param name - The field.
 * @param reader - Its reader.
 * @returns The reader.
 */
export function field<T>(name: string, reader: Reader<T>): Reader<T> {
  const wrapper = record<Record<string, T>>({ [name]: reader });
  return (value) => wrapper(value)[name] as T;
}
