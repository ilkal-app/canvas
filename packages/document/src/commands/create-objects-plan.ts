import type { BoardObject, CommentAnchor, ConnectorEnd, ObjectId, PageId } from '@canvas/schema';

import { generateObjectKeys } from '../z-order/object-keys.js';

import { checkObject, referenceErrors } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type CommandContext, type CommandValidation } from './command.js';
import { copyInstanceOverrides } from './copy-instance-overrides.js';
import { checkCreatedComponents } from './created-components.js';
import {
  copiedOverrides,
  createdOverrideErrors,
  withResolvedOverrides,
} from './created-instance-overrides.js';
import type { NewObject } from './new-object-schema.js';
import { zKeysOnTop } from './z-placement.js';

// How `createObjects` plans: its steps, shared by its `validate`
// (`planCreateObjects`) and its `planInStages` (in `create-objects.ts`), which give the same plan
// and the same refusals.

/** The input of `createObjects`, after parsing (`createObjectsInputSchema`). */
export interface CreateObjectsInput {
  /** The objects to create. */
  readonly objects: readonly NewObject[];
  /** Where the objects with a null `parentId` go. */
  readonly parentId: ObjectId | null;
  /** The page the objects on the root go on. */
  readonly pageId?: PageId | undefined;
  /** Listed mains drawn as their default combination. */
  readonly drawnDefaults?: readonly ObjectId[] | undefined;
}

/** The objects `createObjects` will write. */
export interface CreateObjectsPlan {
  /** Every new object, whole and validated, in input order. */
  readonly objects: readonly BoardObject[];
}

/**
 * The input path of the entry at an index.
 *
 * @param index - The entry's index in `objects`.
 * @returns The path.
 */
const entryPath = (index: number): (string | number)[] => ['objects', index];

/**
 * Gives every listed object a new id, and maps each listed id to it. An id listed twice is
 * reported, and its later entries are not referable.
 *
 * @param context - The command's context, for the id generator and the board.
 * @param entries - The listed objects.
 * @param errors - Where to add the problems.
 * @returns The new ids in input order, and the map from listed id to new id.
 */
function assignIds(
  context: CommandContext,
  entries: readonly NewObject[],
  errors: CommandError[],
): { readonly newIds: ObjectId[]; readonly idMap: Map<ObjectId, ObjectId> } {
  const idMap = new Map<ObjectId, ObjectId>();
  const assigned = new Set<ObjectId>();
  const newIds = entries.map((entry, index) => {
    const newId = context.createId();
    if (context.board.get(newId) !== undefined || assigned.has(newId)) {
      const message = `the generated id "${newId}" is already in use`;
      errors.push(commandError('duplicate-id', newId, entryPath(index), message));
    }
    assigned.add(newId);
    if (entry.id !== undefined) {
      if (idMap.has(entry.id)) {
        const message = `"${entry.id}" is listed more than once`;
        errors.push(commandError('duplicate-id', entry.id, [...entryPath(index), 'id'], message));
      } else {
        idMap.set(entry.id, newId);
      }
    }
    if (entry.z !== undefined) {
      const message =
        'createObjects generates every stacking key: leave z out and list siblings bottom first';
      errors.push(commandError('invalid-input', null, [...entryPath(index), 'z'], message));
    }
    return newId;
  });
  return { newIds, idMap };
}

/**
 * Resolves each entry's parent: `null` is the command's `parentId`, a listed id is that
 * object's new id; anything else is refused, since references to parents stay inside the list.
 *
 * @param context - The command's context, for naming a parent already on the board.
 * @param input - The parsed input.
 * @param idMap - Listed id to new id.
 * @param errors - Where to add the problems.
 * @returns Each entry's parent, or `undefined` where it could not be resolved.
 */
function resolveParents(
  context: CommandContext,
  input: CreateObjectsInput,
  idMap: ReadonlyMap<ObjectId, ObjectId>,
  errors: CommandError[],
): (ObjectId | null | undefined)[] {
  return input.objects.map((entry, index) => {
    if (entry.parentId === null) return input.parentId;
    const parentId = idMap.get(entry.parentId);
    if (parentId === undefined) {
      // A parent already on the board, often a component main (MX run 6), goes in the call's
      // parentId: say so with what it is.
      const existing = context.board.get(entry.parentId);
      const what =
        existing?.type === 'component' ? 'a component main' : `a ${existing?.type ?? ''}`;
      const message =
        existing === undefined
          ? `"${entry.parentId}" is not among the listed objects; list the parent, or use null for the command's parentId`
          : `"${entry.parentId}" is ${what} already on the board, not a listed object: give it as the call's parentId and this entry's parentId null`;
      errors.push(
        commandError('missing-parent', entry.parentId, [...entryPath(index), 'parentId'], message),
      );
    }
    return parentId;
  });
}

/**
 * Generates the stacking keys: the objects going into the command's `parentId` go on top of its
 * current children, and the children of a new object stack from the first key, each in input
 * order. Every key is generated and ends in its object's tag (no copied keys), so two
 * clients pasting into one parent at once get distinct keys.
 *
 * @param context - The command's context.
 * @param input - The parsed input.
 * @param newIds - The new ids, in input order.
 * @param parents - Each entry's resolved parent.
 * @param errors - Where to add the refusal when no key fits on top of the target parent.
 * @returns Each new id's key; missing when the target parent's top key is unusable.
 */
function stackingKeys(
  context: CommandContext,
  input: CreateObjectsInput,
  newIds: readonly ObjectId[],
  parents: readonly (ObjectId | null | undefined)[],
  errors: CommandError[],
): Map<ObjectId, string> {
  const byParent = new Map<ObjectId | null, ObjectId[]>();
  parents.forEach((parentId, index) => {
    const id = newIds[index];
    if (parentId === undefined || id === undefined) return;
    const siblings = byParent.get(parentId);
    if (siblings === undefined) byParent.set(parentId, [id]);
    else siblings.push(id);
  });
  const created = new Set(newIds);
  const keys = new Map<ObjectId, string>();
  for (const [parentId, ids] of byParent) {
    const [first, ...rest] = ids;
    if (first === undefined) continue;
    const isNewParent = parentId !== null && created.has(parentId);
    const generated = isNewParent
      ? generateObjectKeys(null, null, ids)
      : zKeysOnTop(context.board, input.parentId, [first, ...rest], ['parentId'], errors);
    generated?.forEach((key, index) => {
      const id = ids[index];
      if (id !== undefined) keys.set(id, key);
    });
  }
  return keys;
}

/**
 * Rewrites a connector end attached to a listed object to that object's new id; an end on an
 * object that is not listed keeps its id and must name an object on the board.
 *
 * @param end - The end.
 * @param idMap - Listed id to new id.
 * @returns The end.
 */
function remapEnd(end: ConnectorEnd, idMap: ReadonlyMap<ObjectId, ObjectId>): ConnectorEnd {
  if (end.kind !== 'object') return end;
  const objectId = idMap.get(end.objectId);
  return objectId === undefined ? end : { ...end, objectId };
}

/**
 * Rewrites a comment anchor on a listed object to that object's new id.
 *
 * @param anchor - The anchor.
 * @param idMap - Listed id to new id.
 * @returns The anchor.
 */
function remapAnchor(anchor: CommentAnchor, idMap: ReadonlyMap<ObjectId, ObjectId>): CommentAnchor {
  if (anchor.kind !== 'object') return anchor;
  const objectId = idMap.get(anchor.objectId);
  return objectId === undefined ? anchor : { ...anchor, objectId };
}

/**
 * Prefixes the paths of errors about new objects (whose ids mean nothing to the caller yet) with
 * the input path of the entry that becomes each object.
 *
 * @param errors - Errors from checking the new objects.
 * @param indexById - Each new id's input index.
 * @returns The errors, located in the input.
 */
export function locateInInput(
  errors: readonly CommandError[],
  indexById: ReadonlyMap<string, number>,
): CommandError[] {
  return errors.map((error) => {
    const index = error.objectId === null ? undefined : indexById.get(error.objectId);
    return index === undefined ? error : { ...error, path: [...entryPath(index), ...error.path] };
  });
}

/** The new objects before they are checked as stored, and how to locate their errors. */
export interface PreparedCreate {
  readonly candidates: readonly unknown[];
  readonly nameErrors: readonly CommandError[];
  readonly idMap: ReadonlyMap<ObjectId, ObjectId>;
  readonly indexById: ReadonlyMap<string, number>;
}

/**
 * The new objects of a `createObjects` input: new ids, parents, z keys and remapped references,
 * override keys given as layer names resolved; not yet checked as stored.
 *
 * @param context - The command's context.
 * @param input - The parsed input.
 * @returns The candidates, or the errors that refuse the input.
 */
export function prepareCreate(
  context: CommandContext,
  input: CreateObjectsInput,
): PreparedCreate | { readonly errors: readonly CommandError[] } {
  const errors: CommandError[] = [];
  const { newIds, idMap } = assignIds(context, input.objects, errors);
  const parents = resolveParents(context, input, idMap, errors);
  const keys = stackingKeys(context, input, newIds, parents, errors);
  if (errors.length > 0) return { errors };
  const indexById = new Map(newIds.map((id, index) => [id as string, index]));
  const objectErrors: CommandError[] = [];
  const candidates: BoardObject[] = [];
  const sources = new Map(input.objects.map((entry) => [entry.id, entry]));
  input.objects.forEach((entry, index) => {
    const id = newIds[index];
    const z = id === undefined ? undefined : keys.get(id);
    if (id === undefined || z === undefined) return;
    const parentId = parents[index] ?? null;
    const candidate = {
      ...entry,
      id,
      parentId,
      pageId: parentId === null ? (input.pageId ?? entry.pageId) : null,
      z,
      createdBy: context.origin.principalId,
      createdAt: context.now,
      updatedAt: context.now,
      ...(entry.type === 'connector'
        ? { from: remapEnd(entry.from, idMap), to: remapEnd(entry.to, idMap) }
        : {}),
      ...(entry.type === 'instance'
        ? {
            mainId: idMap.get(entry.mainId) ?? entry.mainId,
            overrides: copiedOverrides(entry.overrides, entry.mainId, idMap, sources, context),
            // A slot's options follow its swaps to the copied mains.
            ...(entry.swapOptions === undefined
              ? {}
              : { swapOptions: entry.swapOptions.map((option) => idMap.get(option) ?? option) }),
          }
        : {}),
      ...(entry.type === 'comment' ? { anchor: remapAnchor(entry.anchor, idMap) } : {}),
      // A copied main's presets address its children as an instance's overrides do.
      ...(entry.type === 'component' && entry.variantPresets !== undefined
        ? {
            variantPresets: Object.fromEntries(
              Object.entries(entry.variantPresets).map(([key, records]) => [
                key,
                copyInstanceOverrides(records, entry.id ?? id, idMap, (sourceId) => {
                  const source = sources.get(sourceId) ?? context.board.get(sourceId);
                  return source?.type === 'instance' ? source.mainId : undefined;
                }),
              ]),
            ),
          }
        : {}),
    };
    candidates.push(candidate);
  });
  // Override keys given as layer names, resolved before the objects are checked as stored.
  const named = withResolvedOverrides(context, candidates);
  objectErrors.push(...named.errors);
  return { candidates: named.objects, nameErrors: objectErrors, idMap, indexById };
}

/**
 * The checks of a `createObjects` input after each object passed as stored: inline presets,
 * component sets drawn as their defaults, references and instance overrides.
 *
 * @param context - The command's context.
 * @param input - The parsed input.
 * @param objects - The checked objects, in input order.
 * @param prepared - The ids and how to locate errors.
 * @returns The plan, or the errors.
 */
export function finishCreate(
  context: CommandContext,
  input: CreateObjectsInput,
  objects: BoardObject[],
  prepared: PreparedCreate,
): CommandValidation<CreateObjectsPlan> {
  const { idMap, indexById } = prepared;
  // Inline presets checked as set_variant_preset checks them, sets drawn as their defaults.
  const drawn = new Set((input.drawnDefaults ?? []).flatMap((id) => idMap.get(id) ?? []));
  const checked = checkCreatedComponents(context.board, objects, drawn);
  if ('errors' in checked) return reject(locateInInput(checked.errors, indexById));
  const references = referenceErrors(context.board, checked.objects);
  if (references.length > 0) return reject(locateInInput(references, indexById));
  // Each record as createInstance checks it: fields its child takes, allowed swaps.
  const overrides = createdOverrideErrors(context.board, checked.objects);
  return overrides.length > 0
    ? reject(locateInInput(overrides, indexById))
    : accept({ objects: checked.objects });
}

/**
 * Plans `createObjects` whole: its `validate`.
 *
 * @param context - The command's context.
 * @param input - The parsed input.
 * @returns The plan, or every problem found.
 */
export function planCreateObjects(
  context: CommandContext,
  input: CreateObjectsInput,
): CommandValidation<CreateObjectsPlan> {
  const prepared = prepareCreate(context, input);
  if ('errors' in prepared) return reject(prepared.errors);
  const objectErrors = [...prepared.nameErrors];
  const objects: BoardObject[] = [];
  for (const candidate of prepared.candidates) {
    const object = checkObject(context.board, candidate, objectErrors);
    if (object !== undefined) objects.push(object);
  }
  if (objectErrors.length > 0) return reject(locateInInput(objectErrors, prepared.indexById));
  return finishCreate(context, input, objects, prepared);
}
