import type { Board } from '../board/board.js';
import type { ChildIndex } from '../board/child-index.js';
import type { ObjectId } from '../ids/object-id.js';
import type { BoardObject } from '../objects/board-object.js';

import { constrainChildren } from './constrain-children.js';
import type { InstanceOverrides, OverrideRecord } from './instance-overrides.js';
import { instanceOverrideFields } from './override-content.js';
import { recordAt } from './slot-expansion.js';

// A main as its records draw it: a variant's preset may move and size the main's
// children, patch an auto-layout container's layout, and size the variant itself through the
// record at the main's own id. Resolution reads the main this way before constraints and
// auto-layout run, so both work from the variant's geometry unchanged. Pure.

/** The record fields that change geometry or layout. */
const GEOMETRY_FIELDS = ['x', 'y', 'width', 'height', 'autoLayout'] as const;

/**
 * Whether a record changes geometry or layout: a single child read cannot place what it moves.
 *
 * @param record - A record, if any.
 * @returns True when it sets `x`, `y`, `width`, `height` or `autoLayout`.
 */
export function hasGeometry(record: OverrideRecord | undefined): boolean {
  return record !== undefined && GEOMETRY_FIELDS.some((field) => record[field] !== undefined);
}

/**
 * An object with its record's geometry applied: the box fields its type takes, and for an
 * auto-layout container the layout patch merged over its own (a container without auto-layout
 * keeps none). The root record of a main sizes the main itself.
 *
 * @param object - The object as stored.
 * @param record - Its record, if any.
 * @param isRoot - Whether the object is the main the record's path names, whose own fields are
 *   `width`, `height` and `autoLayout`.
 * @returns The object as the record draws it; the object itself when nothing changes, including
 *   a record that repeats the stored values or patches nothing.
 */
function withGeometry(
  object: BoardObject,
  record: OverrideRecord | undefined,
  isRoot: boolean,
): BoardObject {
  if (!hasGeometry(record) || record === undefined) return object;
  const fields: readonly string[] = isRoot
    ? ['width', 'height', 'autoLayout']
    : instanceOverrideFields(object);
  const patch: Record<string, unknown> = {};
  const stored = object as unknown as Readonly<Record<string, unknown>>;
  for (const field of ['x', 'y', 'width', 'height'] as const) {
    const value = record[field];
    if (fields.includes(field) && value !== undefined && value !== stored[field]) {
      patch[field] = value;
    }
  }
  const own = 'autoLayout' in object ? object.autoLayout : undefined;
  const layout = record.autoLayout;
  if (fields.includes('autoLayout') && layout !== undefined && own !== undefined) {
    const ownFields = own as unknown as Readonly<Record<string, unknown>>;
    const isChanged = Object.entries(layout).some(
      ([key, value]) => JSON.stringify(value) !== JSON.stringify(ownFields[key]),
    );
    if (isChanged) patch.autoLayout = { ...own, ...layout };
  }
  return Object.keys(patch).length === 0 ? object : { ...object, ...patch };
}

/** A main and its board as override records draw them ({@link withRecordGeometry}). */
export interface DrawnMain<Main extends BoardObject> {
  /** The board with the drawn content and main in place of the stored. */
  readonly board: Board;
  /** The main, sized and laid out as its root record has it. */
  readonly main: Main;
}

/**
 * A main and its content as an instance's effective records draw them. The root record (at the
 * main's own id) sizes the main and patches its layout; a main without auto-layout that it resizes
 * first maps its content to the variant's box by the content's constraints, as a resize would, so
 * a centred icon stays centred in a larger variant. Each content object's record then moves and
 * sizes it, in the variant's box. Content inside nested instances is theirs, read at their own
 * level.
 *
 * @param board - The board; not changed.
 * @param main - The main expanded.
 * @param content - Its definition content.
 * @param records - The instance's effective records.
 * @param children - The board's child index, for the constraints.
 * @returns The board and main as drawn: the inputs themselves when no record changes geometry.
 */
export function withRecordGeometry<Main extends BoardObject>(
  board: Board,
  main: Main,
  content: readonly BoardObject[],
  records: InstanceOverrides,
  children?: ChildIndex,
): DrawnMain<Main> {
  const changed = new Map<ObjectId, BoardObject>();
  const drawnMain = withGeometry(main, recordAt(records, main.id), true) as Main;
  if (drawnMain !== main) {
    changed.set(main.id, drawnMain);
    // An auto-layout main places its children itself; any other follows their constraints.
    if ('width' in drawnMain && 'height' in drawnMain && !hasAutoLayout(main)) {
      const size = { width: drawnMain.width, height: drawnMain.height };
      for (const object of constrainChildren(board, main, size, children)) {
        changed.set(object.id, object);
      }
    }
  }
  for (const object of content) {
    const base = changed.get(object.id) ?? object;
    const drawn = withGeometry(base, recordAt(records, object.id), false);
    if (drawn !== base) changed.set(object.id, drawn);
  }
  if (changed.size === 0) return { board, main };
  const objects = new Map(board.objects);
  for (const [id, object] of changed) objects.set(id, object);
  return { board: { ...board, objects }, main: drawnMain };
}

/**
 * Whether an object lays its children out itself.
 *
 * @param object - The object.
 * @returns True for a frame or main with auto-layout.
 */
function hasAutoLayout(object: BoardObject): boolean {
  return 'autoLayout' in object && object.autoLayout !== undefined;
}

/**
 * An object as a record at its path draws it, for a reader that reads one object at a time
 * (`laidInstanceSize`).
 *
 * @param object - The object, if any.
 * @param records - The instance's effective records.
 * @param mainId - The main expanded, whose record is its root.
 * @returns The object as drawn.
 */
export function drawnObject(
  object: BoardObject | undefined,
  records: InstanceOverrides,
  mainId: ObjectId,
): BoardObject | undefined {
  return object === undefined
    ? undefined
    : withGeometry(object, recordAt(records, object.id), object.id === mainId);
}

/** Which axes of a main its variants size. */
export interface VariantSizedAxes {
  /** Some preset's root record sets `width`. */
  readonly isWidthSized: boolean;
  /** Some preset's root record sets `height`. */
  readonly isHeightSized: boolean;
}

/**
 * The axes a main's variants size: those some preset's root record (at the main's own id) sets.
 * On such an axis an instance that has not fixed it takes its variant's size, or the main's own
 * when its variant sets none, and a resize fixes it.
 *
 * @param main - The main, or any object (only a main has presets).
 * @returns Per axis, whether a preset sizes it.
 */
export function variantSizedAxes(main: BoardObject): VariantSizedAxes {
  let isWidthSized = false;
  let isHeightSized = false;
  if (main.type === 'component') {
    for (const records of Object.values(main.variantPresets ?? {})) {
      const root = recordAt(records, main.id);
      isWidthSized ||= root?.width !== undefined;
      isHeightSized ||= root?.height !== undefined;
    }
  }
  return { isWidthSized, isHeightSized };
}
