/**
 * A `Map` that refuses changes once built. A snapshot's object map is shared by every reader of
 * that snapshot, so a reader that casts away `ReadonlyMap` and calls `set` must not change it
 * for the others. It stays a real `Map` (and `instanceof Map`), so it works wherever the
 * schema's `Board` does.
 */
export class SealedMap<Key, Value> extends Map<Key, Value> {
  readonly #isSealed: boolean = false;

  /**
   * Builds the map from entries, then seals it.
   *
   * @param entries - The entries, in order.
   */
  constructor(entries: Iterable<readonly [Key, Value]>) {
    super();
    for (const [key, value] of entries) super.set(key, value);
    this.#isSealed = true;
  }

  /**
   * Refuses to add or replace an entry.
   *
   * @param key - The key.
   * @param value - The value.
   * @returns Never returns once sealed.
   * @throws {TypeError} Always, once the map is sealed.
   */
  override set(key: Key, value: Value): this {
    if (this.#isSealed) throw new TypeError('A snapshot is immutable');
    return super.set(key, value);
  }

  /**
   * Refuses to remove an entry.
   *
   * @param key - The key.
   * @returns Never returns once sealed.
   * @throws {TypeError} Always, once the map is sealed.
   */
  override delete(key: Key): boolean {
    if (this.#isSealed) throw new TypeError('A snapshot is immutable');
    return super.delete(key);
  }

  /**
   * Refuses to remove every entry.
   *
   * @throws {TypeError} Always, once the map is sealed.
   */
  override clear(): void {
    if (this.#isSealed) throw new TypeError('A snapshot is immutable');
    super.clear();
  }
}
