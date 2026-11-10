import { isTokenRef, type TokenRef } from '@canvas/schema';

/**
 * What a control shows when the selected objects disagree on its field (the prototype's toolbar
 * showed mixed values explicitly too). A symbol, so it can never be mistaken for a field's own
 * value.
 */
export const MIXED: unique symbol = Symbol('mixed');

/** A field's value across a selection: the value they share, or {@link MIXED}. */
export type Mixable<Value> = Value | typeof MIXED;

/**
 * The value every item has for a field, or {@link MIXED} when two differ. O(items).
 *
 * @template Item - What is read.
 * @template Value - The field's type.
 * @param items - The items, at least one.
 * @param read - Reads the field of an item.
 * @param isEqual - Compares two values; `Object.is` if absent.
 * @returns The shared value, {@link MIXED}, or undefined when there are no items.
 */
export function commonValue<Item, Value>(
  items: readonly Item[],
  read: (item: Item) => Value,
  isEqual: (first: Value, second: Value) => boolean = Object.is,
): Mixable<Value> | undefined {
  const [first, ...rest] = items;
  if (first === undefined) return undefined;
  const value = read(first);
  return rest.every((item) => isEqual(read(item), value)) ? value : MIXED;
}

/**
 * Whether two colours, or two absent colours, are the same, channel by channel; a colour token
 * (`'ink'`, or a board token `{ token }`) is the same only as the same token.
 *
 * @param first - A colour, a token or null.
 * @param second - Another colour, token or null.
 * @returns True when both are null, the same token, or every channel is equal.
 */
export function isSameColour(
  first: readonly number[] | string | TokenRef | null,
  second: readonly number[] | string | TokenRef | null,
): boolean {
  if (first === null || second === null) return first === second;
  if (typeof first === 'string' || typeof second === 'string') return first === second;
  if (isTokenRef(first) || isTokenRef(second)) {
    return isTokenRef(first) && isTokenRef(second) && first.token === second.token;
  }
  return (
    first.length === second.length && first.every((channel, index) => channel === second[index])
  );
}
