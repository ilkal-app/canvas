import * as Y from 'yjs';

/**
 * Reads only a stored placement's own parent value. This is a cheap notification preflight,
 * not object decoding or validation: a false positive merely asks the normal cache to decode.
 *
 * @param source - The raw object map.
 * @param id - One object key.
 * @returns Its string parent, or undefined when no stored edge can be followed.
 */
function parentOf(source: Y.Map<unknown>, id: string): string | undefined {
  const object = source.get(id);
  if (!(object instanceof Y.Map)) return undefined;
  const placement: unknown = object.get('placement');
  if (typeof placement !== 'object' || placement === null) return undefined;
  const parent: unknown = Object.getOwnPropertyDescriptor(placement, 'parentId')?.value;
  return typeof parent === 'string' ? parent : undefined;
}

/**
 * Whether changed entries lead to a stored cycle that needs a virtual change notification.
 * Walks each ancestor once. Ordinary acyclic transactions retain the cache's existing lazy
 * decode/last-known timing; eagerly decoding every transaction can change repair geometry.
 *
 * @param source - The raw object map, after the transaction.
 * @param changed - Its changed keys.
 * @returns Whether the ordinary decoder must run before notifying view subscribers.
 */
export function hasStoredParentCycle(source: Y.Map<unknown>, changed: Iterable<string>): boolean {
  const settled = new Set<string>();
  for (const start of changed) {
    const path = new Set<string>();
    let id: string | undefined = start;
    while (id !== undefined && !settled.has(id)) {
      if (path.has(id)) return true;
      path.add(id);
      id = parentOf(source, id);
    }
    for (const member of path) settled.add(member);
  }
  return false;
}
