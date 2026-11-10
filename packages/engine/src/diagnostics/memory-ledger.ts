/**
 * The GPU memory categories, in the order every report lists them: persistent instance buffers (the
 * scene's passes), glyph atlas pages (MSDF text), image and video textures (the texture
 * manager), path meshes, uniform buffers, and the resolved colour of offscreen
 * layers (render targets).
 */
export const MEMORY_CATEGORIES = [
  'instanceBuffers',
  'atlases',
  'textures',
  'meshes',
  'uniforms',
  'layers',
] as const;

/** One of the {@link MEMORY_CATEGORIES}. */
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

/**
 * Who holds how many bytes of GPU memory, by category. Each owner of GPU memory reports its
 * current size under a name of its choosing (`ledger.set('atlases', 'msdf page 3', bytes)`)
 * whenever it allocates, grows or shrinks, and deletes its entry when it frees the memory; the
 * ledger keeps a running total per category, so reading the totals every frame costs nothing.
 * Setting an owner that already exists allocates nothing. The byte budget and eviction
 * read these totals. Owned by the thread that owns the backend.
 */
export class MemoryLedger {
  private readonly accounts: readonly CategoryAccount[] = MEMORY_CATEGORIES.map(() => ({
    owners: new Map<string, number>(),
    totalBytes: 0,
  }));

  /**
   * The bytes every owner reported, all categories together.
   *
   * @returns The total in bytes.
   */
  get totalBytes(): number {
    let total = 0;
    for (const account of this.accounts) total += account.totalBytes;
    return total;
  }

  /**
   * Records an owner's current size, replacing what it reported before.
   *
   * @param category - The kind of memory.
   * @param owner - A name unique within the category, for example a pass name or an atlas page.
   * @param bytes - The owner's size now, in bytes.
   * @throws {RangeError} When the category is unknown or `bytes` is not a non-negative integer.
   */
  set(category: MemoryCategory, owner: string, bytes: number): void {
    const account = this.accountOf(category);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new RangeError(`A byte count is a non-negative integer; received ${String(bytes)}.`);
    }
    account.totalBytes += bytes - (account.owners.get(owner) ?? 0);
    account.owners.set(owner, bytes);
  }

  /**
   * Forgets an owner that freed its memory.
   *
   * @param category - The kind of memory.
   * @param owner - The name it reported under.
   * @returns Whether the owner had an entry.
   * @throws {RangeError} When the category is unknown.
   */
  delete(category: MemoryCategory, owner: string): boolean {
    const account = this.accountOf(category);
    const bytes = account.owners.get(owner);
    if (bytes === undefined) return false;
    account.owners.delete(owner);
    account.totalBytes -= bytes;
    return true;
  }

  /**
   * The bytes a category holds now.
   *
   * @param category - The kind of memory.
   * @returns The sum of its owners' reports, in bytes.
   * @throws {RangeError} When the category is unknown.
   */
  bytesOf(category: MemoryCategory): number {
    return this.accountOf(category).totalBytes;
  }

  /**
   * A category's owners and their sizes, for the overlay's detail.
   *
   * @param category - The kind of memory.
   * @returns Bytes by owner name, in report order; a live view, not a copy.
   * @throws {RangeError} When the category is unknown.
   */
  ownersOf(category: MemoryCategory): ReadonlyMap<string, number> {
    return this.accountOf(category).owners;
  }

  /**
   * Writes every category's total into a caller-owned array, in {@link MEMORY_CATEGORIES} order,
   * without allocating: how the stage timers snapshot memory each frame.
   *
   * @param target - Receives one byte count per category, at the category's index in
   *   {@link MEMORY_CATEGORIES}.
   */
  copyTotalsInto(target: number[]): void {
    for (let index = 0; index < this.accounts.length; index += 1) {
      target[index] = this.accounts[index]?.totalBytes ?? 0;
    }
  }

  private accountOf(category: MemoryCategory): CategoryAccount {
    const account = this.accounts[MEMORY_CATEGORIES.indexOf(category)];
    if (account === undefined) throw new RangeError(`Unknown memory category "${category}".`);
    return account;
  }
}

/** One category's owners and their running total. */
interface CategoryAccount {
  readonly owners: Map<string, number>;
  totalBytes: number;
}
