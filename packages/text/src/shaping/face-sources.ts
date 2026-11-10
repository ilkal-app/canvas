// The shaper's font files, kept while their summed size fits a byte budget: a use
// makes a file the most recent, and reading one past the budget drops the least recently used
// others first, never the one just read.

/** A kept file: anything with a size in bytes. */
interface Sized {
  readonly size: number;
}

/** Files by id, least recently used first, within a byte budget. */
export class FaceSources<T extends Sized> {
  private readonly byId = new Map<string, T>();
  private retained = 0;

  /**
   * Starts empty.
   *
   * @param maxBytes - The budget.
   */
  constructor(private readonly maxBytes: number) {}

  /**
   * The summed size of the kept files.
   *
   * @returns The bytes.
   */
  get retainedBytes(): number {
    return this.retained;
  }

  /**
   * A kept file, now the most recently used.
   *
   * @param id - Its id.
   * @returns The file, or `undefined` when it is not kept.
   */
  use(id: string): T | undefined {
    const kept = this.byId.get(id);
    if (kept === undefined) return undefined;
    // Moving it to the end keeps the map's order least recently used first.
    this.byId.delete(id);
    this.byId.set(id, kept);
    return kept;
  }

  /**
   * Keeps a newly read file, dropping the least recently used others until the rest fit.
   *
   * @param id - Its id, not already kept.
   * @param source - The file.
   */
  add(id: string, source: T): void {
    this.byId.set(id, source);
    this.retained += source.size;
    for (const [keptId, kept] of this.byId) {
      if (this.retained <= this.maxBytes || keptId === id) break;
      this.byId.delete(keptId);
      this.retained -= kept.size;
    }
  }
}
