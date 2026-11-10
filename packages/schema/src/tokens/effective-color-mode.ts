import type { ColorMode } from '../fields/color-tokens.js';
import type { ObjectId } from '../ids/object-id.js';
import type { BoardObject } from '../objects/board-object.js';

// The effective colour mode of an object: the nearest ancestor-or-self
// frame, main or instance with an explicit `colorMode`. An instance's virtual content (ids
// `<instance>/<path>`, `virtualObjectId`) walks through its source parents up to the main, then
// through the instance, so an instance's own mode wins over its main's; a main's own mode
// applies to its content and to every instance that sets none. Then a fallback hook (will
// give it the nearest filled frame's luminance), then the viewer's theme.

/** The most steps the walk takes: deeper chains (or a loop a merge left) end it. */
const MAX_COLOR_MODE_STEPS = 1024;

/** What {@link effectiveColorMode} reads of a board: its objects by id (a map, or a reader). */
export interface ColorModeBoard {
  /** Every object, by id: only `get` is read. */
  readonly objects: Pick<ReadonlyMap<ObjectId, BoardObject>, 'get'>;
}

/**
 * The mode used when no ancestor sets one, before the viewer's theme: `undefined` in v1.
 *
 * @param object - The object whose mode is asked.
 * @param board - The board.
 * @returns A mode, or `undefined` to fall through to the viewer's theme.
 */
export type ColorModeFallback = (
  object: BoardObject,
  board: ColorModeBoard,
) => ColorMode | undefined;

/** How {@link effectiveColorMode} ends a walk that found no explicit mode. */
export interface ColorModeOptions {
  /** The viewer's theme, the last resort; absent to return `undefined` instead. */
  readonly viewerTheme?: ColorMode;
  /** Asked before the viewer's theme; absent in v1. */
  readonly fallbackMode?: ColorModeFallback;
}

/**
 * A stored mode, read defensively: only `'light'` and `'dark'` count.
 *
 * @param object - An object of any type.
 * @returns Its own mode, or `undefined`.
 */
function ownMode(object: BoardObject): ColorMode | undefined {
  if (object.type !== 'frame' && object.type !== 'component' && object.type !== 'instance') {
    return undefined;
  }
  const { colorMode } = object as { readonly colorMode?: unknown };
  return colorMode === 'light' || colorMode === 'dark' ? colorMode : undefined;
}

/**
 * The stored object a walk node stands for: itself, or for a virtual id its source object (the
 * last segment). The walk's parents are read from it.
 *
 * @param board - The board.
 * @param id - A stored or virtual id.
 * @returns The object, or `undefined`.
 */
function sourceAt(board: ColorModeBoard, id: string): BoardObject | undefined {
  const slash = id.lastIndexOf('/');
  return board.objects.get((slash < 0 ? id : id.slice(slash + 1)) as ObjectId);
}

/**
 * The object a walk node names, as drawn: a virtual object the board holds (a merged board of
 * resolved content, such as a vector export's), with its overrides applied; else its
 * source object.
 *
 * @param board - The board.
 * @param id - A stored or virtual id.
 * @param source - Its source object ({@link sourceAt}).
 * @returns The object.
 */
function drawnAt(board: ColorModeBoard, id: string, source: BoardObject): BoardObject {
  return board.objects.get(id as ObjectId) ?? source;
}

/**
 * A node's mode: an instance's own, else its main's; another object's own.
 *
 * @param board - The board.
 * @param node - The node's object.
 * @returns The explicit mode, or `undefined`.
 */
function nodeMode(board: ColorModeBoard, node: BoardObject): ColorMode | undefined {
  const own = ownMode(node);
  if (own !== undefined || node.type !== 'instance') return own;
  const main = board.objects.get(node.mainId);
  return main?.type === 'component' ? ownMode(main) : undefined;
}

/**
 * The next node up from a node: a stored object's parent; for virtual content, its source parent
 * as a virtual id, or the containing instance when the source parent is the main.
 *
 * @param board - The board.
 * @param id - The node's id.
 * @param node - The node's object.
 * @returns The parent's id, or `null` at the root.
 */
function parentOf(board: ColorModeBoard, id: string, node: BoardObject): string | null {
  const slash = id.lastIndexOf('/');
  if (slash < 0) return node.parentId;
  const container = id.slice(0, slash);
  const instance = sourceAt(board, container);
  const mainId = instance?.type === 'instance' ? instance.mainId : undefined;
  if (node.parentId === null || node.parentId === mainId) return container;
  return `${container}/${node.parentId}`;
}

/**
 * The ancestors an object's colour mode walk visits, nearest first: as {@link effectiveColorMode}
 * walks them (virtual content through its source parents to its instance, then the instance's
 * ancestors), each node read as drawn (a virtual node as the board's virtual object when it
 * holds one, else as its source object). Bounded;
 * a missing parent ends it. Package-private: the frame-fill rule walks the same chain.
 *
 * @param object - The object: stored, or virtual content of an instance.
 * @param board - The board.
 * @returns The ancestors, nearest first, without the object itself.
 */
export function colorModeAncestors(object: BoardObject, board: ColorModeBoard): BoardObject[] {
  const ancestors: BoardObject[] = [];
  let id = object.parentId as string | null;
  for (let step = 0; id !== null && step < MAX_COLOR_MODE_STEPS; step += 1) {
    const source = sourceAt(board, id);
    if (source === undefined) break;
    const node = drawnAt(board, id, source);
    ancestors.push(node);
    id = parentOf(board, id, source);
  }
  return ancestors;
}

/**
 * The colour mode an object draws its tokens in, given the viewer's theme: never undefined.
 *
 * @param object - The object: stored, or virtual content of an instance.
 * @param board - The board.
 * @param options - The viewer's theme and the fallback hook, or the viewer's theme alone.
 * @returns The mode.
 */
export function effectiveColorMode(
  object: BoardObject,
  board: ColorModeBoard,
  options: (ColorModeOptions & { readonly viewerTheme: ColorMode }) | ColorMode,
): ColorMode;
/**
 * The colour mode an object draws its tokens in, without the viewer's theme.
 *
 * @param object - The object: stored, or virtual content of an instance.
 * @param board - The board.
 * @param options - The fallback hook.
 * @returns The mode, or `undefined` when nothing sets one (the viewer's theme applies).
 */
export function effectiveColorMode(
  object: BoardObject,
  board: ColorModeBoard,
  options?: ColorModeOptions,
): ColorMode | undefined;
/**
 * The colour mode an object draws its tokens in: the nearest ancestor-or-self
 * frame, main or instance with an explicit `colorMode`, where an instance's virtual content walks
 * through the instance and an instance that sets none takes its main's; else the fallback hook;
 * else the viewer's theme. Pure; the walk is bounded, and a missing parent ends it.
 *
 * @param object - The object: stored, or virtual content of an instance (`resolveInstance`).
 * @param board - The board.
 * @param viewer - The viewer's theme and the fallback hook, or the viewer's theme alone.
 * @returns The mode; `undefined` only when nothing sets one and no viewer theme is given.
 */
export function effectiveColorMode(
  object: BoardObject,
  board: ColorModeBoard,
  viewer: ColorModeOptions | ColorMode = {},
): ColorMode | undefined {
  const options: ColorModeOptions = typeof viewer === 'string' ? { viewerTheme: viewer } : viewer;
  // The object itself first: a virtual object's `parentId` is already its virtual parent.
  let mode = nodeMode(board, object);
  let id = object.parentId as string | null;
  for (let step = 0; mode === undefined && id !== null && step < MAX_COLOR_MODE_STEPS; step += 1) {
    const source = sourceAt(board, id);
    if (source === undefined) break;
    const node = drawnAt(board, id, source);
    mode = nodeMode(board, node);
    id = parentOf(board, id, source);
  }
  if (mode !== undefined) return mode;
  return options.fallbackMode?.(object, board) ?? options.viewerTheme;
}
