import {
  overridePathSchema,
  type BoardObject,
  type InstanceObject,
  type ObjectId,
  type OverrideRecord,
} from '@canvas/schema';

import type { CommandError } from './command-error.js';
import type { BoardReader, CommandContext } from './command.js';
import { copyInstanceOverrides } from './copy-instance-overrides.js';
import { instanceOverrideError } from './instance-override-target.js';
import type { NewObject } from './new-object-schema.js';
import { overridePathError, resolveOverridePath } from './override-path-names.js';

// Instance override keys of the objects createObjects creates: keys addressing a copied
// main by listed ids are rewritten to the new ids, then every key is resolved as createInstance
// resolves it, layer names included.

/**
 * The created instances with their override keys resolved, as `createInstance` resolves
 * them: an id path that addresses a child stays, any other key is read as layer names
 * through the main, the board or the objects created in the same call, and records given under
 * two keys of one path merge in input order. A key that reads no way, or more than one, is an
 * error at `['overrides', key]` of its object, and is left out, so the object's own checks report
 * only its other problems.
 *
 * @param context - The command's context, for the board.
 * @param objects - The objects being created, ids final, not yet checked.
 * @returns The objects, instances' overrides by id path, and the errors.
 */
export function withResolvedOverrides(
  context: CommandContext,
  objects: readonly BoardObject[],
): { readonly objects: BoardObject[]; readonly errors: CommandError[] } {
  const errors: CommandError[] = [];
  const resolved = objects.map((object): BoardObject => {
    if (object.type !== 'instance') return object;
    const entries = Object.entries(object.overrides);
    // Keys already ids are read first, so a swap given in the same input leads its deeper paths.
    const asIds = Object.fromEntries(
      entries.filter(([path]) => overridePathSchema.safeParse(path).success),
    ) as Record<string, OverrideRecord>;
    const reading: InstanceObject = { ...object, overrides: asIds };
    const overrides: Record<string, OverrideRecord> = {};
    for (const [given, override] of entries) {
      const resolution = resolveOverridePath(context.board, reading, given, objects);
      if ('error' in resolution) {
        errors.push(overridePathError(resolution, object.id, ['overrides', given]));
      } else {
        overrides[resolution.path] = { ...overrides[resolution.path], ...override };
      }
    }
    return { ...object, overrides };
  });
  return { objects: resolved, errors };
}

/**
 * The created objects an override walk can read: those inside a main, created or
 * stored (a main's definition), gathered once for the call. An object outside every main is in
 * no definition, so it is left out, and a large paste does not lay its every object over each
 * record's walk.
 *
 * @param board - The board before the call.
 * @param objects - The objects being created.
 * @returns The created objects inside a main.
 */
function inDefinitions(board: BoardReader, objects: readonly BoardObject[]): BoardObject[] {
  const created = new Map(objects.map((object) => [object.id, object]));
  const known = new Map<ObjectId, boolean>();
  const isInMain = (start: BoardObject): boolean => {
    const chain: ObjectId[] = [];
    let current: BoardObject | undefined = start;
    let isInside = false;
    while (current !== undefined) {
      const wasInside = known.get(current.id);
      if (wasInside !== undefined) {
        isInside = wasInside;
        break;
      }
      if (current.type === 'component') {
        isInside = true;
        break;
      }
      chain.push(current.id);
      const parentId: ObjectId | null = current.parentId;
      if (parentId === null || chain.includes(parentId)) break;
      current = created.get(parentId) ?? board.get(parentId);
    }
    for (const id of chain) known.set(id, isInside);
    return isInside;
  };
  return objects.filter(isInMain);
}

/**
 * The created ancestors of a created object, nearest first: a walk from the instance up to the
 * mains containing it reads them.
 *
 * @param object - The created object.
 * @param created - The created objects by id.
 * @returns Its created ancestors.
 */
function createdAncestors(
  object: BoardObject,
  created: ReadonlyMap<ObjectId, BoardObject>,
): BoardObject[] {
  const ancestors: BoardObject[] = [];
  let parent = object.parentId === null ? undefined : created.get(object.parentId);
  while (parent !== undefined && !ancestors.includes(parent)) {
    ancestors.push(parent);
    parent = parent.parentId === null ? undefined : created.get(parent.parentId);
  }
  return ancestors;
}

/**
 * Checks the created instances' records as `createInstance` checks its own: each
 * record's fields must be ones its child takes, an auto-layout patch needs a layout, and a swap
 * must be one the slot may show, reading the objects created in the same call (those in a main's
 * definition, and the instance's own created ancestors) in place of the board's. Errors are at
 * `['overrides', path]` of their instance, the resolved id path.
 *
 * @param board - The board before the call.
 * @param objects - The objects being created, checked as stored, overrides by id path.
 * @returns The errors; none when every record may be stored.
 */
export function createdOverrideErrors(
  board: BoardReader,
  objects: readonly BoardObject[],
): CommandError[] {
  const errors: CommandError[] = [];
  const created = new Map(objects.map((object) => [object.id, object]));
  const definitions = inDefinitions(board, objects);
  for (const object of objects) {
    if (object.type !== 'instance' || Object.keys(object.overrides).length === 0) continue;
    const ancestors = createdAncestors(object, created).filter(
      (ancestor) => !definitions.includes(ancestor),
    );
    const overlay = ancestors.length === 0 ? definitions : [...definitions, ...ancestors];
    for (const [path, record] of Object.entries(object.overrides)) {
      const where = { path: ['overrides', path], override: ['overrides', path] };
      const refused = instanceOverrideError(board, object, path, record, where, overlay);
      if (refused !== undefined) errors.push(refused);
    }
  }
  return errors;
}

/**
 * The listed objects inside a listed main's definition: those whose chain of listed
 * parents reaches it. Only an override key starting at one of them addresses the copied main by
 * a listed id; any other key is the main's child id or a layer name, read by the resolver.
 *
 * @param sources - The listed objects by their listed id.
 * @param mainId - The main's listed id.
 * @returns The listed ids.
 */
function listedDefinition(
  sources: ReadonlyMap<string | undefined, NewObject>,
  mainId: string,
): Set<string> {
  const inside = new Set<string>();
  for (const [id, entry] of sources) {
    if (id === undefined) continue;
    const seen = new Set<string>([id]);
    let parent: string | null | undefined = entry.parentId;
    while (parent !== null && parent !== undefined && !seen.has(parent)) {
      if (parent === mainId) {
        inside.add(id);
        break;
      }
      seen.add(parent);
      parent = sources.get(parent)?.parentId;
    }
  }
  return inside;
}

/**
 * A record whose swap names a main listed in the call, with the main's new id: a listed id names
 * the listed object here as in an instance's own `mainId`, a parent or a connector's end.
 *
 * @param record - The record.
 * @param idMap - Listed ids to new ids.
 * @returns The record, its `mainId` rewritten when it was listed.
 */
function swappedToListed(
  record: OverrideRecord,
  idMap: ReadonlyMap<ObjectId, ObjectId>,
): OverrideRecord {
  const swapped = record.mainId === undefined ? undefined : idMap.get(record.mainId);
  return swapped === undefined ? record : { ...record, mainId: swapped };
}

/**
 * A listed instance's overrides with the keys that address a copied main by listed ids rewritten
 * to the new ids (`copyInstanceOverrides`); every other key, a child id of a stored main or a
 * layer name, is kept as given for the resolver (a name equal to an unrelated listed id
 * is not rewritten). A kept key's swap to a main listed in the call names that main's new id.
 *
 * @param overrides - The overrides as given.
 * @param mainId - The instance's main, as given.
 * @param idMap - Listed ids to new ids.
 * @param sources - The listed objects by their listed id.
 * @param context - The command's context, for the board.
 * @returns The overrides.
 */
export function copiedOverrides(
  overrides: Readonly<Record<string, OverrideRecord>>,
  mainId: ObjectId,
  idMap: ReadonlyMap<ObjectId, ObjectId>,
  sources: ReadonlyMap<string | undefined, NewObject>,
  context: CommandContext,
): Record<string, OverrideRecord> {
  const inside = idMap.has(mainId) ? listedDefinition(sources, mainId) : undefined;
  const copied: Record<string, OverrideRecord> = {};
  const kept: Record<string, OverrideRecord> = {};
  for (const [path, record] of Object.entries(overrides)) {
    const [first] = path.split('/');
    const isListed =
      inside === undefined
        ? overridePathSchema.safeParse(path).success
        : first !== undefined && inside.has(first);
    (isListed ? copied : kept)[path] = record;
  }
  const remapped = copyInstanceOverrides(copied, mainId, idMap, (sourceId) => {
    const source = sources.get(sourceId) ?? context.board.get(sourceId);
    return source?.type === 'instance' ? source.mainId : undefined;
  });
  // Input order kept: each key at its given place, rewritten when it was copied (the copy keeps
  // its entries' order); records landing on one key merge in that order.
  const rewritten = new Map(
    Object.keys(copied).map((path, index) => [path, Object.entries(remapped)[index]]),
  );
  const result: Record<string, OverrideRecord> = {};
  for (const [path, record] of Object.entries(overrides)) {
    const [key, value] = rewritten.get(path) ?? [path, swappedToListed(record, idMap)];
    result[key] = { ...result[key], ...value };
  }
  return result;
}
