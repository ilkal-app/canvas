interface FieldSkeleton {
  readonly names: readonly string[];
  readonly object: Readonly<Record<string, undefined>>;
}

// Only schema metadata is retained: no document objects, Yjs values or decoded fields.
const skeletons = new WeakMap<readonly string[], FieldSkeleton>();

/**
 * Copies decoded values into schema field order without allocating per-field entry pairs.
 * Layout arrays are readonly by type but not frozen; compare every name before reusing their
 * skeleton. Existing own data properties preserve special keys such as __proto__ on assignment.
 *
 * @param names - Schema field names.
 * @param fields - Decoded values, read afresh on every call.
 * @returns A fresh ordinary object with own data properties in schema order.
 */
export function orderedFields(
  names: readonly string[],
  fields: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  let cached = skeletons.get(names);
  if (
    cached?.names.length !== names.length ||
    !cached.names.every((name, index) => name === names[index])
  ) {
    cached = {
      names: Object.freeze([...names]),
      object: Object.freeze(Object.fromEntries(names.map((name) => [name, undefined]))),
    };
    skeletons.set(names, cached);
  }
  const object: Record<string, unknown> = { ...cached.object };
  for (const name of names) object[name] = fields[name];
  return object;
}
