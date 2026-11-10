import { z } from 'zod';

import {
  MAX_INSTANCE_DEPTH,
  effectiveOverridesOf,
  overridePathSchema,
  slotExpansion,
  type Board,
  type BoardObject,
  type ChildIndex,
  type InstanceObject,
  type ObjectId,
} from '@canvas/schema';

import { commandError, type CommandError } from './command-error.js';
import type { BoardReader } from './command.js';
import { definitionBoard, overridePathTarget } from './instance-override-target.js';

// Override paths by child name as well as id. A stored path is ids: the nested instances
// it enters, then the target. A command also takes the path as names, walked as the layers panel
// shows the tree, and resolves it to that id path before it validates or stores anything.

/** The longest override path a command takes, as ids or names. */
export const MAX_OVERRIDE_PATH_INPUT = 1000;

/**
 * An override path as a command takes it: an id path as stored (`overridePathSchema`), or
 * the names of the layers down to the target, separated by `/` (a name may itself contain `/`).
 */
export const overridePathInputSchema = z
  .string()
  .min(1)
  .max(MAX_OVERRIDE_PATH_INPUT)
  .describe(
    "Child ids as query_board lists them, or the layers' names down to the child (e.g. icon/select/Vector), separated by /.",
  );

/** A path resolved to the id path a record is stored at. */
export interface ResolvedOverridePath {
  /** The id path. */
  readonly path: string;
}

/** Why a path cannot be resolved. */
export interface OverridePathRefusal {
  /** `invalid-override-path`: no reading; `ambiguous-override-path`: more than one. */
  readonly error: 'invalid-override-path' | 'ambiguous-override-path';
  /** What to tell the caller. */
  readonly message: string;
}

/** A path resolved to ids, or why it cannot be. */
export type OverridePathResolution = ResolvedOverridePath | OverridePathRefusal;

/** The root a preset path may name: the main itself. */
export interface OverridePathRoot {
  /** The main's id. */
  readonly id: ObjectId;
  /** Its name. */
  readonly name: string;
}

/** One level of a name walk: the container listed, and the instance whose main it is in. */
interface Level {
  /** The object whose direct children the next name picks from. */
  readonly containerId: ObjectId;
  /** The instance (or nested slot) whose effective main holds the container. */
  readonly instance: InstanceObject;
  /** The mains entered above, outermost first. */
  readonly ancestorMains: readonly ObjectId[];
  /** The ids of the nested instances entered so far. */
  readonly entered: readonly string[];
}

/** What a name walk shares across its branches. */
interface Walk {
  readonly board: Board;
  readonly children: ChildIndex;
  /** The distinct id paths found. */
  readonly readings: Set<string>;
  /** A name two siblings share on some reading, for the message. */
  shared: string | undefined;
}

/**
 * Resolves an override path to the id path a record is stored at. An id path that
 * addresses a child is kept as it is. Otherwise each step names a direct child of the current
 * container (the main, a frame, a group, or a nested instance's effective main), the last naming
 * the target; a child's name is its `name`, or an unnamed instance's main's name; a step may also
 * be a child's id, and since names may contain `/`, every way of splitting the path is tried.
 * Frames and groups on the way are left out of the result, as an id path leaves them out.
 *
 * @param reader - Current document.
 * @param instance - The instance (a stand-in for a preset) whose definition the path addresses,
 *   with its records as they will be.
 * @param path - The path as given.
 * @param overlay - Other proposed objects read in place of the stored ones.
 * @param root - For a preset, the main: its name or id as the whole path addresses the root.
 * @returns The id path, or `invalid-override-path` (no reading) or `ambiguous-override-path` (more
 *   than one, or a step two siblings share).
 */
export function resolveOverridePath(
  reader: BoardReader,
  instance: InstanceObject,
  path: string,
  overlay: readonly BoardObject[] = [],
  root?: OverridePathRoot,
): OverridePathResolution {
  if (path === root?.id) return { path };
  if (
    overridePathSchema.safeParse(path).success &&
    overridePathTarget(reader, instance, path, overlay) !== undefined
  ) {
    return { path };
  }
  const { board, children } = definitionBoard(reader, instance, overlay);
  const walk: Walk = {
    board,
    children,
    readings: new Set(),
    shared: undefined,
  };
  if (root?.name === path) walk.readings.add(root.id);
  const start: Level = {
    containerId: instance.mainId,
    instance: { ...instance, overrides: effectiveOverridesOf(instance, board) },
    ancestorMains: [instance.mainId],
    entered: [],
  };
  readNames(walk, start, path.split('/'));
  // A step two siblings share is ambiguous whether or not one branch completes: the caller
  // cannot know which layer it named.
  if (walk.shared !== undefined) {
    return {
      error: 'ambiguous-override-path',
      message: `Two siblings are named "${walk.shared}". Give ids.`,
    };
  }
  const [first, second] = walk.readings;
  if (first === undefined) {
    return {
      error: 'invalid-override-path',
      message: 'The path names no child of this main, by id or by name.',
    };
  }
  if (second !== undefined) {
    return {
      error: 'ambiguous-override-path',
      message: `The path "${path}" reads more than one way, as ${first} or ${second}. Give ids.`,
    };
  }
  return { path: first };
}

/**
 * Turns a resolution's refusal into a command error.
 *
 * @param resolution - A refused resolution.
 * @param resolution.error - Its code.
 * @param resolution.message - Its message.
 * @param objectId - The instance or main the command edits.
 * @param where - Where the error points in the input.
 * @returns The command error.
 */
export function overridePathError(
  resolution: OverridePathRefusal,
  objectId: ObjectId,
  where: readonly (string | number)[],
): CommandError {
  return commandError(resolution.error, objectId, where, resolution.message);
}

/**
 * Reads the remaining steps from one level, adding each complete reading's id path. Each step
 * down consumes at least one part of the path, so the walk ends however the tree is shaped.
 *
 * @param walk - The shared state.
 * @param level - Where the walk is.
 * @param steps - The path's `/`-separated parts left to read.
 */
function readNames(walk: Walk, level: Level, steps: readonly string[]): void {
  const byName = childrenByName(walk, level.containerId);
  let name = '';
  for (const [index, step] of steps.entries()) {
    name = index === 0 ? step : `${name}/${step}`;
    const matches = byName.get(name) ?? [];
    if (matches.length > 1) {
      walk.shared ??= name;
      return;
    }
    const rest = steps.slice(index + 1);
    for (const child of matches) {
      if (rest.length === 0) walk.readings.add([...level.entered, child.id].join('/'));
      else descend(walk, level, child, rest);
    }
  }
}

/**
 * A container's direct children by the names a step may give: each child's name (an unnamed
 * instance by its main's) and its id. A child named by its own id is listed once.
 *
 * @param walk - The shared state.
 * @param containerId - The container.
 * @returns The children by name and id.
 */
function childrenByName(walk: Walk, containerId: ObjectId): Map<string, BoardObject[]> {
  const byName = new Map<string, BoardObject[]>();
  for (const id of walk.children.get(containerId) ?? []) {
    const child = walk.board.objects.get(id);
    if (child === undefined) continue;
    const name = nameOf(walk.board, child);
    for (const key of name === undefined || name === child.id ? [child.id] : [child.id, name]) {
      byName.set(key, [...(byName.get(key) ?? []), child]);
    }
  }
  return byName;
}

/**
 * Continues a reading below a matched child: into a frame's or group's children, or into a
 * nested instance's effective main as resolution expands it.
 *
 * @param walk - The shared state.
 * @param level - The level the child was matched at.
 * @param child - The matched child.
 * @param rest - The steps left below it.
 */
function descend(walk: Walk, level: Level, child: BoardObject, rest: readonly string[]): void {
  if (child.type === 'instance') {
    // A stored path holds at most MAX_INSTANCE_DEPTH parts. The bound also stops a cycle a peer's
    // raw write made (a main holding an instance of itself) from branching without end.
    if (level.entered.length + 1 >= MAX_INSTANCE_DEPTH) return;
    const nested = slotExpansion(
      walk.board,
      child,
      level.instance.overrides,
      level.ancestorMains,
      walk.children,
    );
    readNames(
      walk,
      {
        containerId: nested.mainId,
        instance: nested,
        ancestorMains: [...level.ancestorMains, nested.mainId],
        entered: [...level.entered, child.id],
      },
      rest,
    );
  } else if (child.type === 'frame' || child.type === 'group') {
    readNames(walk, { ...level, containerId: child.id }, rest);
  }
}

/**
 * A child's name as the layers panel shows it: its own, or an unnamed instance's main's.
 *
 * @param board - The gathered definitions.
 * @param child - The child.
 * @returns The name, if it has one.
 */
function nameOf(board: Board, child: BoardObject): string | undefined {
  if (child.name !== undefined && child.name !== '') return child.name;
  return child.type === 'instance' ? board.objects.get(child.mainId)?.name : undefined;
}
