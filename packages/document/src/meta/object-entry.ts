/** An item of a board's document, as the per-writer stamp rule sees it. */
export interface EntryCandidate {
  /** Whether its parent is the top-level `objects` map. */
  readonly isUnderObjects: boolean;
  /** Its key in that map, or undefined for an item without one. */
  readonly key: string | undefined;
  /** Whether it is deleted (or arrives deleted). */
  readonly isDeleted: boolean;
}

/**
 * Tells whether an item is an object entry whose writer must have stamped the document:
 * any live item under a key of the top-level `objects` map, whatever its content, a
 * plain value as much as a `Y.Map`. Package-internal, shared by the store's version guard and
 * the relay's stamp check, so the relay counts exactly the entries a store refuses.
 *
 * @param candidate - The item.
 * @returns True for an object entry.
 */
export function isObjectEntry(candidate: EntryCandidate): boolean {
  return candidate.isUnderObjects && candidate.key !== undefined && !candidate.isDeleted;
}
