import type { BoardReader } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import type { LayerRowIndex } from './layer-row-index.js';
import type { LayerRow } from './layer-rows.js';
import { appendRow, rebuildSlice, type SliceChange, type SliceRows } from './layer-slice.js';

/** A structural change to the layers tree: what changed, and the rows before it. */
export interface LayerStructureChange {
  /** The document, after the change. */
  readonly board: BoardReader;
  /** The frames and groups whose children are listed, after the change. */
  readonly expandedIds: ReadonlySet<ObjectId>;
  /** The rows before the change. */
  readonly rows: readonly LayerRow[];
  /** The rows' index, as of `rows`. */
  readonly index: LayerRowIndex;
  /** Each parent whose children changed (created, deleted, moved in or out, restacked). */
  readonly changedChildren: ReadonlyMap<ObjectId | null, ReadonlySet<ObjectId>>;
  /** Every parent whose slice changed: those of `changedChildren`, and any expanded or collapsed. */
  readonly dirty: ReadonlySet<ObjectId | null>;
}

/** The rows after a structural change, and what the index needs to follow it. */
export interface RestructuredRows {
  /** The rows. */
  readonly rows: readonly LayerRow[];
  /** The first index that changed. */
  readonly changedFrom: number;
  /** The ids no longer listed where they were. */
  readonly removed: readonly ObjectId[];
  /** The rows made or replaced. */
  readonly added: readonly LayerRow[];
}

/** One run of the old rows and what replaces it. */
interface Region extends SliceRows {
  /** Its first old row. */
  readonly start: number;
  /** One past its last old row. */
  readonly end: number;
}

/**
 * An object's ancestors, its parent first and the root (null) last.
 *
 * @param board - The document.
 * @param id - The object, or null for the root (which has none).
 * @returns The ancestors, or undefined when the object or one of them cannot be read (it is not
 *   in the tree) or they loop.
 */
function ancestorsOf(board: BoardReader, id: ObjectId | null): (ObjectId | null)[] | undefined {
  const ancestors: (ObjectId | null)[] = [];
  let parentId = id === null ? undefined : board.get(id)?.parentId;
  while (parentId !== undefined) {
    if (ancestors.includes(parentId)) return undefined;
    ancestors.push(parentId);
    if (parentId === null) return ancestors;
    parentId = board.get(parentId)?.parentId;
  }
  return id === null ? ancestors : undefined;
}

/**
 * The parents whose slices are rebuilt from the old rows (those with no changed ancestor, whose
 * old rows are disjoint), and every changed parent with all its ancestors, which a rebuild does
 * not copy. O(changed parents × depth).
 *
 * @param board - The document.
 * @param dirty - The parents whose slices changed.
 * @returns The outermost changed parents and the touched ones.
 */
function outermostOf(
  board: BoardReader,
  dirty: ReadonlySet<ObjectId | null>,
): { readonly outermost: (ObjectId | null)[]; readonly touched: Set<ObjectId | null> } {
  const outermost: (ObjectId | null)[] = [];
  const touched = new Set<ObjectId | null>();
  for (const parentId of dirty) {
    const ancestors = ancestorsOf(board, parentId);
    if (ancestors === undefined) continue;
    touched.add(parentId);
    for (const ancestor of ancestors) touched.add(ancestor);
    if (!ancestors.some((ancestor) => dirty.has(ancestor))) outermost.push(parentId);
  }
  return { outermost, touched };
}

/**
 * The run of old rows an outermost changed parent owns, rebuilt: the whole list for the root;
 * else the parent's own row (its `hasChildren` or expansion may change) and its descendants.
 *
 * @param change - The change.
 * @param slice - The change as the slice builder reads it.
 * @param parentId - The parent.
 * @returns The region, or undefined when the parent is not listed.
 */
function regionOf(
  change: LayerStructureChange,
  slice: SliceChange,
  parentId: ObjectId | null,
): Region | undefined {
  const { rows, index } = change;
  const region = { rows: [], removed: [], added: [] };
  if (parentId === null) {
    rebuildSlice(slice, null, 1, { start: 0, end: rows.length }, region);
    return { ...region, start: 0, end: rows.length };
  }
  const row = index.rowOf(parentId);
  const start = index.indexOf(parentId);
  const object = change.board.get(parentId);
  if (row === undefined || start === undefined || object === undefined) return undefined;
  let end = start + 1;
  while (end < rows.length && (rows[end]?.level ?? 0) > row.level) end += 1;
  appendRow(slice, object, row, { row, below: { start: start + 1, end } }, region);
  return { ...region, start, end };
}

/**
 * Whether a region's new rows are its old ones.
 *
 * @param rows - The old rows.
 * @param region - The region.
 * @returns True when nothing in it changed.
 */
function isUnchanged(rows: readonly LayerRow[], region: Region): boolean {
  if (region.rows.length !== region.end - region.start) return false;
  return region.rows.every((row, offset) => row === rows[region.start + offset]);
}

/**
 * The layers tree's rows after a structural change: each outermost changed parent's
 * run of rows is rebuilt (`rebuildSlice`: its changed children spliced into its old order, the
 * untouched descendants copied) and the runs spliced into one new list, in one pass however
 * many parents changed. The rows equal what `buildLayerRows` would list, and the rows of
 * collapsed parents are never visited. O(changed parents × depth + their slices + one copy of
 * the list).
 *
 * @param change - The change and the rows before it.
 * @returns The new rows, or undefined when they are the same.
 */
export function restructureRows(change: LayerStructureChange): RestructuredRows | undefined {
  const { board, expandedIds, rows, changedChildren } = change;
  const { outermost, touched } = outermostOf(board, change.dirty);
  const slice: SliceChange = { board, expandedIds, rows, changedChildren, touched };
  const regions: Region[] = [];
  for (const parentId of outermost) {
    const region = regionOf(change, slice, parentId);
    if (region !== undefined && !isUnchanged(rows, region)) regions.push(region);
  }
  if (regions.length === 0) return undefined;
  regions.sort((first, second) => first.start - second.start);
  const pieces: (readonly LayerRow[])[] = [];
  let at = 0;
  for (const region of regions) {
    pieces.push(rows.slice(at, region.start), region.rows);
    at = region.end;
  }
  pieces.push(rows.slice(at));
  return {
    rows: ([] as LayerRow[]).concat(...pieces),
    changedFrom: regions[0]?.start ?? 0,
    removed: regions.flatMap((region) => region.removed),
    added: regions.flatMap((region) => region.added),
  };
}
