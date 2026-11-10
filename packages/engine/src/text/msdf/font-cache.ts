// The fonts a job handler keeps loaded: the msdf job's parsed fonts and msdfgen fonts,
// and the glyph-geometry job's parsed fonts, each by font key.

/** A small least-recently-used cache that calls `dispose` on what it drops. */
export class FontCache<T> {
  private readonly items = new Map<string, T>();

  /**
   * Creates the cache.
   *
   * @param capacity - How many items it keeps.
   * @param dispose - Called with each item it drops.
   */
  constructor(
    private readonly capacity: number,
    private readonly dispose: (item: T) => void,
  ) {}

  /**
   * The item under a key, made with `create` when there is none (dropping the least recently
   * used item at capacity), and now the most recently used.
   *
   * @param key - The key: a font key.
   * @param create - Makes the item.
   * @returns The item.
   */
  get(key: string, create: () => T): T {
    let item = this.items.get(key);
    if (item === undefined) {
      item = create();
      for (const [oldest, dropped] of this.items) {
        if (this.items.size < this.capacity) break;
        this.items.delete(oldest);
        this.dispose(dropped);
      }
    } else {
      this.items.delete(key);
    }
    this.items.set(key, item);
    return item;
  }
}
