import type { TextLayout } from '@canvas/text';

/** At most this many repeated labels are retained, including jobs still in flight. */
const MAX_ENTRIES = 512;
/** Bounds key characters plus source code units (which bound glyph/line counts). */
const MAX_UNITS = 256 * 1024;

interface SharedLayout {
  readonly result: Promise<TextLayout>;
  readonly units: number;
}

/** Bounded per-renderer reuse of identical layout work, independent of any object's lifetime. */
export class SharedTextLayouts {
  private readonly entries = new Map<string, SharedLayout>();
  private units = 0;
  private revision = -1;

  /**
   * Reuses identical work only within the same font catalogue revision. Eviction never
   * cancels a job an object is waiting for; a rejected job is removed so a later edit retries.
   *
   * @param key - Exact layout inputs, including font selection, runs, width and alignment.
   * @param textLength - Source UTF-16 length, a bound on output glyph and line counts.
   * @param revision - Font library generation; replacing a face invalidates reuse too.
   * @param create - Starts the work only when no matching job or result is retained.
   * @returns The shared or newly started layout.
   */
  get(
    key: string,
    textLength: number,
    revision: number,
    create: () => Promise<TextLayout>,
  ): Promise<TextLayout> {
    if (revision !== this.revision) {
      this.entries.clear();
      this.units = 0;
      this.revision = revision;
    }
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing.result;
    }
    const units = key.length + textLength + 1;
    if (units > MAX_UNITS) return create();
    while (this.entries.size >= MAX_ENTRIES || this.units + units > MAX_UNITS) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
    const result = create();
    // Observe failure without wrapping the promise: object listeners keep the original
    // completion timing, and receive its rejection through their own handler.
    void result.catch(() => {
      if (this.entries.get(key)?.result === result) this.remove(key);
    });
    this.entries.set(key, { result, units });
    this.units += units;
    return result;
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (entry === undefined) return;
    this.units -= entry.units;
    this.entries.delete(key);
  }
}
