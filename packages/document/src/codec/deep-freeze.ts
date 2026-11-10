/**
 * Freezes a plain value and everything reachable from it. Decoded objects share their plain
 * field values with the document's own storage, so they are frozen before they leave the
 * package: a caller mutating one would otherwise change the document behind Yjs's back.
 *
 * Iterative, with no depth cap: a peer can send a value nested as deep as Yjs can carry it, and
 * a recursive walk would overflow the stack on the read, on every client. A member that is
 * already frozen is not walked again, which also stops a cycle.
 *
 * @param value - A plain value: a primitive, an array or a plain object.
 * @returns The same value, now deeply frozen.
 */
export function deepFreeze<Value>(value: Value): Value {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== 'object' || current === null || Object.isFrozen(current)) continue;
    Object.freeze(current);
    for (const member of Object.values(current)) {
      if (typeof member === 'object' && member !== null) pending.push(member);
    }
  }
  return value;
}
