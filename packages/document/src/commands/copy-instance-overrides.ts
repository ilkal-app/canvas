import type { InstanceOverrides, ObjectId } from '@canvas/schema';

/**
 * Rewrites path segments only while their containing definition is itself being copied.
 * A separately copied source child must not redirect an instance of the original main.
 *
 * A swap is followed: below a slot whose record names a `mainId`, the segments belong
 * to that main, so they are rewritten only when it is copied too; and the record's `mainId`
 * itself names the copy when the swapped-in main is among the copied objects.
 *
 * @param overrides - Original per-child records.
 * @param mainId - The original root definition.
 * @param idMap - Listed identities receiving fresh copies.
 * @param sourceMain - Reads the original main reference of a nested source instance.
 * @returns Records addressing the copied definitions, retaining uncopied suffixes.
 */
export function copyInstanceOverrides(
  overrides: InstanceOverrides,
  mainId: ObjectId,
  idMap: ReadonlyMap<ObjectId, ObjectId>,
  sourceMain: (id: ObjectId) => ObjectId | undefined,
): InstanceOverrides {
  // The main a slot's segments belong to: its record's swap, else its stored main.
  const slotMain = (prefix: string, id: ObjectId): ObjectId | undefined => {
    const record = Object.hasOwn(overrides, prefix) ? overrides[prefix] : undefined;
    return record?.mainId ?? sourceMain(id);
  };
  return Object.fromEntries(
    Object.entries(overrides).map(([path, record]) => {
      let definition: ObjectId | undefined = mainId;
      const segments = path.split('/');
      const rewritten = segments
        .map((segment, index) => {
          const id = segment as ObjectId;
          const isCopied = definition !== undefined && idMap.has(definition);
          definition = isCopied ? slotMain(segments.slice(0, index + 1).join('/'), id) : undefined;
          return isCopied ? (idMap.get(id) ?? id) : id;
        })
        .join('/');
      const swapped = record.mainId === undefined ? undefined : idMap.get(record.mainId);
      return [rewritten, swapped === undefined ? record : { ...record, mainId: swapped }];
    }),
  );
}
