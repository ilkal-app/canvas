import { sortedSiblings, type BoardReader } from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { childOrderAfter } from './child-order.js';
import { layerRowOf, type LayerRow, type LayerRowPlace } from './layer-rows.js';

/** No changed children. */
const NONE: ReadonlySet<ObjectId> = new Set();

/** A run of the rows, `start` up to, not including, `end`. */
export interface RowSpan {
  /** Its first index. */
  readonly start: number;
  /** One past its last index. */
  readonly end: number;
}

/** What a structural change asks of the rows, and the rows as they were. */
export interface SliceChange {
  /** The document, after the change. */
  readonly board: BoardReader;
  /** The frames and groups whose children are listed, after the change. */
  readonly expandedIds: ReadonlySet<ObjectId>;
  /** The rows before the change. */
  readonly rows: readonly LayerRow[];
  /** Each parent whose children changed, with the children that did. */
  readonly changedChildren: ReadonlyMap<ObjectId | null, ReadonlySet<ObjectId>>;
  /** Every parent whose slice must be rebuilt, and all their ancestors. */
  readonly touched: ReadonlySet<ObjectId | null>;
}

/** A rebuilt slice: its rows, and how the listed ids changed. */
export interface SliceRows {
  /** The rows, top to bottom. */
  readonly rows: LayerRow[];
  /** The ids of the rows it dropped. */
  readonly removed: ObjectId[];
  /** The rows it made or replaced. */
  readonly added: LayerRow[];
}

/**
 * Each child of a parent in an old slice, top first, with the span of rows below it (its own
 * listed descendants). O(rows in the slice).
 *
 * @param rows - The rows.
 * @param slice - The parent's children and their descendants.
 * @param level - The children's level.
 * @returns The children's ids in order, and each one's row index and descendants.
 */
function oldChildrenIn(
  rows: readonly LayerRow[],
  slice: RowSpan,
  level: number,
): { readonly order: ObjectId[]; readonly spans: Map<ObjectId, RowSpan> } {
  const order: ObjectId[] = [];
  const spans = new Map<ObjectId, RowSpan>();
  for (let index = slice.start; index < slice.end;) {
    const row = rows[index];
    if (row === undefined) break;
    let end = index + 1;
    while (end < slice.end && (rows[end]?.level ?? 0) > level) end += 1;
    order.push(row.id);
    spans.set(row.id, { start: index + 1, end });
    index = end;
  }
  return { order, spans };
}

/**
 * Adds a span of the old rows to what was dropped.
 *
 * @param change - The change.
 * @param span - The rows.
 * @param removed - The dropped ids so far.
 */
function dropSpan(change: SliceChange, span: RowSpan, removed: ObjectId[]): void {
  for (let index = span.start; index < span.end; index += 1) {
    const row = change.rows[index];
    if (row !== undefined) removed.push(row.id);
  }
}

/**
 * Adds an object's row at its place, and below it, when it is expanded, its listed descendants:
 * its old rows copied as they were when nothing inside it changed (it is not `touched`), else
 * its slice rebuilt (`rebuildSlice`). Drops the old descendants of a row now collapsed.
 *
 * @param change - The change and the rows before it.
 * @param object - The object.
 * @param place - Its parent, level and place among its siblings.
 * @param previous - Its row before, with the span of its old descendants, if it was listed here.
 * @param out - Receives the rows, the dropped ids and the new rows.
 */
export function appendRow(
  change: SliceChange,
  object: BoardObject,
  place: LayerRowPlace,
  previous: { readonly row: LayerRow; readonly below: RowSpan } | undefined,
  out: SliceRows,
): void {
  const row = layerRowOf(change.board, change.expandedIds, object, place, previous?.row);
  out.rows.push(row);
  if (row !== previous?.row) out.added.push(row);
  const oldChildren = previous?.row.isExpanded === true ? previous.below : undefined;
  if (!row.isExpanded) {
    if (oldChildren !== undefined) dropSpan(change, oldChildren, out.removed);
  } else if (oldChildren !== undefined && !change.touched.has(row.id)) {
    for (let at = oldChildren.start; at < oldChildren.end; at += 1) {
      const copied = change.rows[at];
      if (copied !== undefined) out.rows.push(copied);
    }
  } else {
    rebuildSlice(change, row.id, place.level + 1, oldChildren, out);
  }
}

/**
 * Rebuilds the rows below a parent after a structural change: its children in their
 * new order (`childOrderAfter` from the order its old slice lists, or a full sort when it listed
 * none), each with its row (kept when unchanged) and its descendants (`appendRow`). The result
 * equals what `buildLayerRows` lists under the parent. O(children + rows rebuilt + rows copied),
 * and nothing below a collapsed child.
 *
 * @param change - The change and the rows before it.
 * @param parentId - The parent, or null for the root.
 * @param level - Its children's level.
 * @param oldSlice - Its children's rows before, when it listed them.
 * @param out - Receives the rows, the dropped ids and the new rows.
 */
export function rebuildSlice(
  change: SliceChange,
  parentId: ObjectId | null,
  level: number,
  oldSlice: RowSpan | undefined,
  out: SliceRows,
): void {
  const { board, rows } = change;
  const old = oldSlice === undefined ? undefined : oldChildrenIn(rows, oldSlice, level);
  const order =
    old === undefined
      ? sortedSiblings(board, parentId).reverse()
      : childOrderAfter(board, parentId, old.order, change.changedChildren.get(parentId) ?? NONE);
  const listed = new Set<ObjectId>();
  order.forEach((id, index) => {
    const object = board.get(id);
    if (object === undefined) return;
    listed.add(id);
    const below = old?.spans.get(id);
    const row = below === undefined ? undefined : rows[below.start - 1];
    const place = { parentId, level, positionInSet: index + 1, setSize: order.length };
    appendRow(
      change,
      object,
      place,
      below === undefined || row === undefined ? undefined : { row, below },
      out,
    );
  });
  if (old === undefined) return;
  for (const [id, span] of old.spans) {
    if (listed.has(id)) continue;
    out.removed.push(id);
    dropSpan(change, span, out.removed);
  }
}
