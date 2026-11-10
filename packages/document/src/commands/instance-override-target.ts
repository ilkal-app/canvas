import {
  buildChildIndex,
  definitionContent,
  effectiveOverridesOf,
  instanceOverrideFields,
  overrideRunsIssues,
  slotExpansion,
  slotSwapIssue,
  type Board,
  type BoardObject,
  type ChildIndex,
  type InstanceObject,
  type ObjectId,
  type OverrideRecord,
} from '@canvas/schema';

import { commandError, type CommandError } from './command-error.js';
import type { BoardReader } from './command.js';
import { containingMains } from './containing-mains.js';
import { SubBoard } from './sub-board.js';

/** Where an override path leads in an instance's definition. */
export interface OverridePathTarget {
  /** The source child the path addresses, in the effective main of its last slot. */
  readonly target: BoardObject;
  /** The mains expanded above the target, outermost (the instance's own) first. */
  readonly ancestorMains: readonly ObjectId[];
  /** The gathered definitions the walk read, with the instance laid over them. */
  readonly board: Board;
}

/** The definitions an override path walks, gathered once: the board and its child index. */
export interface DefinitionBoard {
  /** The gathered definitions, with the instance and the overlay laid over them. */
  readonly board: Board;
  /** Its child index. */
  readonly children: ChildIndex;
}

/**
 * Gathers what an override path can walk: the instance, its containing mains (a main swapped in
 * finds itself inside them), the overlay as the command writes it (a new main's children placed
 * in it), and every definition the instance's nested instances reference.
 *
 * @param reader - Current document.
 * @param instance - The instance, stored or planned.
 * @param overlay - Other proposed objects read in place of the stored ones.
 * @returns The board and its child index.
 */
export function definitionBoard(
  reader: BoardReader,
  instance: InstanceObject,
  overlay: readonly BoardObject[] = [],
): DefinitionBoard {
  const subBoard = new SubBoard(reader, [instance, ...overlay]);
  subBoard.addWithAncestors(instance.id);
  // Gathered first, whatever the stored board's child index says of them, so the definitions
  // their nested instances reference are gathered with them.
  for (const object of overlay) subBoard.add(object.id);
  subBoard.addInstanceDefinitions(instance.id);
  const board = subBoard.toBoard();
  return { board, children: buildChildIndex(board) };
}

/**
 * Walks an override path through an instance's definition as resolution expands it: each
 * non-final segment must be a nested instance (a slot), entered through its effective main
 * (`slotExpansion`: a swap in the instance's records where it can expand), without applying
 * visibility or copying virtual objects.
 *
 * @param reader - Current document.
 * @param instance - Instance whose definition is addressed, with its records as they will be
 *   after the write; it need not be stored yet.
 * @param path - Source instance segments followed by the source child id.
 * @param overlay - Other proposed objects the walk reads in place of the stored ones (a main with
 *   an edited preset).
 * @returns The target and its ancestor mains, or undefined for a path outside the definition.
 */
export function overridePathTarget(
  reader: BoardReader,
  instance: InstanceObject,
  path: string,
  overlay: readonly BoardObject[] = [],
): OverridePathTarget | undefined {
  const { board, children } = definitionBoard(reader, instance, overlay);
  let current: InstanceObject = { ...instance, overrides: effectiveOverridesOf(instance, board) };
  const ancestorMains: ObjectId[] = [];
  const parts = path.split('/');
  for (const [index, part] of parts.entries()) {
    const source = definitionContent(board, current.mainId, children).find(
      (object) => object.id === part,
    );
    ancestorMains.push(current.mainId);
    if (index === parts.length - 1)
      return source === undefined ? undefined : { target: source, ancestorMains, board };
    if (source?.type !== 'instance') return undefined;
    current = slotExpansion(board, source, current.overrides, ancestorMains, children);
  }
  return undefined;
}

/**
 * The refusal of override fields a child does not take: the fields its type does take
 * (a frame's include fill and strokeColor since).
 *
 * @param target - The child the path addresses.
 * @returns The message.
 */
function unsupportedFieldsMessage(target: BoardObject): string {
  const fields = instanceOverrideFields(target);
  const taken = `A ${target.type} child takes ${fields.join(', ')}.`;
  return `The child does not support these override fields. ${taken}`;
}

/**
 * Checks a swap at a slot: the target must be one `slotSwapIssue` finds nothing wrong
 * with where the slot expands, reaching none of the mains that contain the instance (a cycle or
 * a depth breach keeps its own code, anything else is `invalid-override`), and within the slot's
 * `swapOptions` when it lists some. Swapping back to the slot's stored main is always allowed.
 *
 * @param reader - Current document.
 * @param instance - The instance written, stored or planned.
 * @param walk - Where the path leads.
 * @param mainId - The main to swap in.
 * @param where - Where the error points.
 * @returns The error, or `undefined` when the swap may be stored.
 */
function swapError(
  reader: BoardReader,
  instance: InstanceObject,
  walk: OverridePathTarget,
  mainId: ObjectId,
  where: readonly (string | number)[],
): CommandError | undefined {
  const { ancestorMains, board } = walk;
  const instanceId = instance.id;
  // The fields check admits `mainId` only on an instance-type child.
  const target = walk.target as InstanceObject;
  if (target.mainId === mainId) return undefined;
  const issue = slotSwapIssue(
    board,
    mainId,
    ancestorMains,
    undefined,
    containingMains(reader, instance),
  );
  if (issue === 'instance-cycle' || issue === 'instance-depth')
    return commandError(issue, instanceId, where, 'The main cannot be expanded in this slot.');
  if (issue !== undefined)
    return commandError('invalid-override', instanceId, where, 'A live main is required.');
  if (target.swapOptions !== undefined && !target.swapOptions.includes(mainId))
    return commandError(
      'invalid-override',
      instanceId,
      where,
      "The main is not among the slot's swap options.",
    );
  return undefined;
}

/**
 * Checks one override record against the instance's definition: the path must address a child
 * of the main (`invalid-override-path`) and every field must be one that child's type takes
 * (`invalid-override`), and a swapped-in `mainId` must be one the slot may show. Paths
 * follow each slot's main as it will be after the write, so `instance` carries the records as
 * the command will leave them. Shared by `setInstanceOverride` and `createInstance`, so both refuse
 * alike.
 *
 * @param reader - Current document.
 * @param instance - The instance, stored or about to be.
 * @param path - The override path.
 * @param override - The record at that path, already parsed by the schema.
 * @param where - Error paths into the command's input.
 * @param where.path - Where an `invalid-override-path` error points.
 * @param where.override - Where an `invalid-override` error points.
 * @param overlay - Other proposed objects to read in place of the stored ones (see
 *   {@link overridePathTarget}).
 * @returns The error, or `undefined` when the record may be stored.
 */
export function instanceOverrideError(
  reader: BoardReader,
  instance: InstanceObject,
  path: string,
  override: OverrideRecord,
  where: {
    readonly path: readonly (string | number)[];
    readonly override: readonly (string | number)[];
  },
  overlay: readonly BoardObject[] = [],
): CommandError | undefined {
  const walk = overridePathTarget(reader, instance, path, overlay);
  if (walk === undefined) {
    return commandError(
      'invalid-override-path',
      instance.id,
      where.path,
      'The path does not address a child of this main.',
    );
  }
  const fields: readonly string[] = instanceOverrideFields(walk.target);
  if (Object.keys(override).some((key) => !fields.includes(key))) {
    return commandError(
      'invalid-override',
      instance.id,
      where.override,
      unsupportedFieldsMessage(walk.target),
    );
  }
  // A layout patch needs a layout to patch: a container without auto-layout ignores it.
  if (
    override.autoLayout !== undefined &&
    !('autoLayout' in walk.target && walk.target.autoLayout)
  ) {
    return commandError(
      'invalid-override',
      instance.id,
      [...where.override, 'autoLayout'],
      'The child has no auto-layout to patch.',
    );
  }
  const [runsIssue] = overrideRunsIssues(override);
  if (runsIssue !== undefined) {
    return commandError('invalid-override', instance.id, [...where.override, 'runs'], runsIssue);
  }
  return override.mainId === undefined
    ? undefined
    : swapError(reader, instance, walk, override.mainId, [...where.override, 'mainId']);
}
