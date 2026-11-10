// An in-bounds read of an array. With noUncheckedIndexedAccess every indexed read may be
// `undefined`, and a `?? fallback` for a read that cannot miss is a branch no input reaches.
// Package-internal.

/**
 * The element of an array at an index the caller has checked is inside it.
 *
 * @template Element - The element type.
 * @param array - The array or typed array.
 * @param index - An index from 0 to `array.length - 1`.
 * @returns The element.
 */
export function elementAt<Element>(array: ArrayLike<Element>, index: number): Element {
  return array[index] as Element;
}
