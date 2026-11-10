// A seeded source of randomness for fuzz tests, so a failing run replays from its seed.

/** Random choices drawn from one seed. */
export interface SeededRandom {
  /**
   * A number in [0, 1).
   *
   * @returns The next number.
   */
  next(): number;
  /**
   * An integer in [0, bound).
   *
   * @param bound - The exclusive upper bound, at least 1.
   * @returns The integer.
   */
  below(bound: number): number;
  /**
   * One item of a non-empty list.
   *
   * @param items - The items.
   * @returns One of them.
   * @throws {RangeError} When the list is empty.
   */
  pick<Item>(items: readonly Item[]): Item;
  /**
   * The items in a random order.
   *
   * @param items - The items; not modified.
   * @returns A new, shuffled array.
   */
  shuffle<Item>(items: readonly Item[]): Item[];
}

/**
 * Creates a Mulberry32 generator (the one the schema's seeded id generator uses).
 *
 * @param seed - Any integer; its low 32 bits select the sequence.
 * @returns The random choices.
 */
export function createSeededRandom(seed: number): SeededRandom {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
  const below = (bound: number): number => Math.floor(next() * bound);
  return {
    next,
    below,
    pick<Item>(items: readonly Item[]): Item {
      const item = items[below(items.length)];
      if (item === undefined) throw new RangeError('Cannot pick from an empty list');
      return item;
    },
    shuffle<Item>(items: readonly Item[]): Item[] {
      const shuffled = [...items];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const other = below(index + 1);
        [shuffled[index], shuffled[other]] = [shuffled[other] as Item, shuffled[index] as Item];
      }
      return shuffled;
    },
  };
}
