import type { StickyAuthors } from '../text/scene/sticky-author-box.js';

/** The board's sticky authors as the `stickyAuthors` command carries them. */
export interface SerializableStickyAuthors {
  /** Whether stickies show their author. */
  readonly isShown: boolean;
  /** Each principal id and its display name, in the map's order. */
  readonly names: readonly (readonly [string, string])[];
  /** The name of a principal the names lack. */
  readonly fallback: string;
}

/**
 * The board's sticky authors as the `stickyAuthors` command carries them: structured-cloneable
 * pairs for the map.
 *
 * @param authors - The authors.
 * @returns The command's fields.
 */
export function serializeStickyAuthors(authors: StickyAuthors): SerializableStickyAuthors {
  return { isShown: authors.isShown, names: [...authors.names], fallback: authors.fallback };
}

/**
 * The authors a `stickyAuthors` command carries, as the worker's scene reads them.
 *
 * @param authors - The checked fields (`isHostToWorkerMessage`).
 * @returns The authors.
 */
export function deserializeStickyAuthors(authors: SerializableStickyAuthors): StickyAuthors {
  return {
    isShown: authors.isShown,
    names: new Map(authors.names),
    fallback: authors.fallback,
  };
}

/**
 * Whether a value is the names of a `stickyAuthors` command: pairs of strings.
 *
 * @param value - The value.
 * @returns True for an array of [string, string] pairs.
 */
export function isStickyAuthorNames(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (pair) =>
        Array.isArray(pair) &&
        pair.length === 2 &&
        typeof pair[0] === 'string' &&
        typeof pair[1] === 'string',
    )
  );
}
