import * as Y from 'yjs';

import {
  drawableValuesReason,
  type DrawableValueKind,
  type DrawableValueReason,
  type StoredValueReader,
} from '@canvas/schema';

import { readScannedPlainValue } from '../assets/scanned-value.js';
import type { ScannedItem } from '../assets/update-scan.js';
import { readStoredMember } from '../codec/network-codec.js';
import { OBJECTS_MAP_NAME } from '../store/yjs-document-store.js';

import { IMAGE_PAINT_LAYOUT_VERSION } from './document-meta.js';
import type { ObjectFieldLanding } from './field-landings.js';
import type { BoardLayout } from './layout-gate.js';

// The relay's door check of the values an update writes into objects (part 1): the
// stored keys whose numbers a renderer draws, judged by the schema's ranges
// (`drawableValuesReason`), the ranges the engine's reader applies to a stored object. The keys
// are the stored layout's (`codec/object-layout.ts`): the `placement`, `size` and `style` groups,
// a line's ends (`points.0`, `points.1`, or the pair `points` of a board stored before the split),
// a freehand stroke's `strokePoints` and `strokePressures`,
// and the members of a path's `vertices` and `segments` maps (`[order, member]`,
// `codec/network-codec.ts`). Fix round 1: a value is judged whatever content wrote it (`any`,
// JSON, an embed: what `Y.Map#get` returns), any other content under a judged key is refused,
// and a field written as the hub already holds it is not judged (one lookup in the hub per
// value that would be refused). Package-internal: `UpdateStampCheck` reports what it finds.

/**
 * The layout from which each line end has its own key: a write of the whole pair under
 * `points` on a board at this layout or above has the shape of an older layout.
 */
const SPLIT_LINE_ENDS_LAYOUT = 2;

/** The key of a line's whole pair, as boards stored before the split hold it. */
const WHOLE_PAIR_KEY = 'points';

/** What each judged key of an object's map holds. */
const KINDS_BY_KEY: ReadonlyMap<string, DrawableValueKind> = new Map([
  ['placement', 'placement'],
  ['size', 'size'],
  ['style', 'style'],
  ['points.0', 'point'],
  ['points.1', 'point'],
  [WHOLE_PAIR_KEY, 'points'],
  ['strokePoints', 'stroke-points'],
  ['strokePressures', 'stroke-pressures'],
]);

/** What each network's members hold. */
const KINDS_BY_NETWORK: ReadonlyMap<string, DrawableValueKind> = new Map([
  ['vertices', 'vertex'],
  ['segments', 'segment'],
]);

/** A value an update writes into an object, where it lands, and what it holds. */
export interface FieldWrite {
  /** The value's item in the update. */
  readonly item: ScannedItem;
  /** Where it lands. */
  readonly field: ObjectFieldLanding;
  /** What it holds, as the door judges it (`judgedKindOf`). */
  readonly kind: DrawableValueKind;
}

/** A value an update writes that the door refuses: where, and why. */
export interface HostileValue {
  /** The object's id. */
  readonly objectId: string;
  /** The stored key: a group (`placement`), an own key (`points.1`), or a network's key. */
  readonly key: string;
  /** For a network member: its id. */
  readonly memberId?: string;
  /** Where in the value, as a dotted path (`x`, `crop`, `naturalSize.width`, `ha.y`). */
  readonly field: string;
  /**
   * Why it is refused: a number out of its range, a field or value of the wrong type
   * (`DrawableValueReason`), content that is not a plain value, such as a string, binary or
   * a shared type under a judged key (`not-a-plain-value`), a page key or value the door
   * refuses, a colour token key or value it refuses, a named style key
   * or value it refuses, or a facilitation key or value it refuses.
   */
  readonly reason:
    | DrawableValueReason
    | 'not-a-plain-value'
    | 'not-a-page-key'
    | 'not-a-page-value'
    | 'not-a-token-key'
    | 'not-a-token-value'
    | 'not-a-style-key'
    | 'not-a-style-value'
    | 'not-a-facilitation-key'
    | 'not-a-facilitation-value';
  /**
   * For a write into the pages map: its key, refused for its shape
   * (`not-a-page-key`) or its value (`not-a-page-value`); `objectId` is then empty.
   */
  readonly pageKey?: string;
  /**
   * For a write into the colour tokens map: its key, refused for its shape
   * (`not-a-token-key`) or its value (`not-a-token-value`); `objectId` is then empty.
   */
  readonly tokenKey?: string;
  /**
   * For a write into a named style map: its key, refused for its shape
   * (`not-a-style-key`) or its value (`not-a-style-value`); `objectId` is then empty.
   */
  readonly styleKey?: string;
}

/** What the door check found in an update's values. */
export interface FieldValueReading {
  /** The first value out of its range, if any. */
  readonly hostileValue?: HostileValue;
  /**
   * How many values have the shape of an older layout than the board's: a whole pair under
   * `points` on a board of layout 2 or above. Counted, not refused.
   */
  readonly layoutShapedWrites: number;
}

/**
 * What the door judges a field's value as: by its key in the object's map, or, for a member of a
 * network, by the network's key.
 *
 * @param field - Where a value lands.
 * @returns What it holds, or undefined when the door does not judge it.
 */
export function judgedKindOf(field: ObjectFieldLanding): DrawableValueKind | undefined {
  return (field.memberId === undefined ? KINDS_BY_KEY : KINDS_BY_NETWORK).get(field.key);
}

/** The finding for content under a judged key that is not a plain value. */
const NOT_PLAIN = 'not-a-plain-value';

/**
 * Reads the value to judge, as a reader of the board gets it: a network member unwrapped from
 * its stored `[order, member]`.
 *
 * @param update - The update's bytes.
 * @param write - The value's write.
 * @returns `{ value }`, or undefined when the content is not a plain value (or its JSON does not
 *   parse, which would make Yjs throw).
 */
function judgedValueOf(update: Uint8Array, write: FieldWrite): { value: unknown } | undefined {
  let read: { readonly value: unknown } | undefined;
  try {
    read = readScannedPlainValue(update, write.item);
  } catch {
    return undefined;
  }
  if (read === undefined || write.field.memberId === undefined) return read;
  return { value: readStoredMember(read.value)?.[1] };
}

/**
 * Reads, from the hub, the value it holds where a write lands: an object's key, or a network
 * member (unwrapped). One lookup, read only when a field would be refused.
 *
 * @param doc - The hub's document, before the update.
 * @param field - Where the write lands.
 * @returns The reader.
 */
function storedReaderOf(doc: Y.Doc, field: ObjectFieldLanding): StoredValueReader {
  return () => {
    const object: unknown = doc.getMap<unknown>(OBJECTS_MAP_NAME).get(field.objectId);
    if (!(object instanceof Y.Map) || !object.has(field.key)) return undefined;
    const value: unknown = object.get(field.key);
    if (field.memberId === undefined) return { value };
    if (!(value instanceof Y.Map) || !value.has(field.memberId)) return undefined;
    const member = readStoredMember(value.get(field.memberId));
    return member === undefined ? undefined : { value: member[1] };
  };
}

/** The one style field of each object type that may hold an image paint. */
const IMAGE_PAINT_FIELD_OF: ReadonlyMap<unknown, string> = new Map([
  ['shape', 'fill'],
  ['frame', 'background'],
]);

/** The style fields that hold a paint. */
const PAINT_FIELDS = ['fill', 'background'] as const;

/**
 * Tells whether a value is a plain record.
 *
 * @param value - The value.
 * @returns True for a non-array object.
 */
function isRecordValue(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The paint fields of a style that hold an image paint.
 *
 * @param style - A style value, from any peer.
 * @returns The fields, in `PAINT_FIELDS` order.
 */
function imagePaintFieldsOf(style: unknown): string[] {
  if (!isRecordValue(style)) return [];
  return PAINT_FIELDS.filter((field) => {
    const paint = style[field];
    return isRecordValue(paint) && paint.type === 'image';
  });
}

/** What the door knows of the update it judges beyond each write. */
interface UpdateContext {
  /** The hub's document, before the update. */
  readonly doc: Y.Doc;
  /** The update's bytes. */
  readonly update: Uint8Array;
  /** The update's identity writes by object id. */
  readonly identities: ReadonlyMap<string, ScannedItem>;
  /** The board's layout after the update. */
  readonly layoutAfter: number;
}

/**
 * Reads a plain value an update writes, or undefined when it cannot be read.
 *
 * @param update - The update's bytes.
 * @param item - The value's item.
 * @returns The value, or undefined.
 */
function readWritten(update: Uint8Array, item: ScannedItem): unknown {
  try {
    return readScannedPlainValue(update, item)?.value;
  } catch {
    return undefined;
  }
}

/**
 * The type of an object after the update: from the `identity` the update writes, else from the
 * hub; undefined when neither has one.
 *
 * @param context - The update.
 * @param objectId - The object.
 * @returns The type, or undefined.
 */
function objectTypeAfter(context: UpdateContext, objectId: string): unknown {
  const written = context.identities.get(objectId);
  const identity =
    written === undefined
      ? hubObjectKey(context.doc, objectId, 'identity')
      : readWritten(context.update, written);
  return isRecordValue(identity) ? identity.type : undefined;
}

/**
 * Reads one key of an object the hub holds.
 *
 * @param doc - The hub's document.
 * @param objectId - The object.
 * @param key - The key.
 * @returns The value, or undefined.
 */
function hubObjectKey(doc: Y.Doc, objectId: string, key: string): unknown {
  const object: unknown = doc.getMap<unknown>(OBJECTS_MAP_NAME).get(objectId);
  return object instanceof Y.Map ? object.get(key) : undefined;
}

/**
 * Judges the image paints of a style an object holds after the update: each must sit in
 * the one field its object's type allows (a shape's fill, a frame's background), on a board whose
 * layout after the update reads it. An object whose type cannot be established is refused, so no
 * order of writes puts an image paint where it may not be.
 *
 * @param context - The update.
 * @param objectId - The object.
 * @param style - Its style after the update.
 * @returns The refused field, or undefined.
 */
function imagePaintFinding(
  context: UpdateContext,
  objectId: string,
  style: unknown,
): Pick<HostileValue, 'field' | 'reason'> | undefined {
  const fields = imagePaintFieldsOf(style);
  const [first] = fields;
  if (first === undefined) return undefined;
  if (context.layoutAfter < IMAGE_PAINT_LAYOUT_VERSION) {
    return { field: first, reason: 'not-a-record' };
  }
  const allowed = IMAGE_PAINT_FIELD_OF.get(objectTypeAfter(context, objectId));
  const misplaced = fields.find((field) => field !== allowed);
  return misplaced === undefined ? undefined : { field: misplaced, reason: 'not-a-record' };
}

/**
 * Judges one write: its values' ranges (`drawableValuesReason`), and, for a style, where its
 * image paints may sit (`imagePaintFinding`).
 *
 * @param context - The update.
 * @param write - The write.
 * @returns The refused field, or undefined.
 */
function findingOf(
  context: UpdateContext,
  write: FieldWrite,
): Pick<HostileValue, 'field' | 'reason'> | undefined {
  const read = judgedValueOf(context.update, write);
  if (read === undefined) return { field: '', reason: NOT_PLAIN };
  const finding = drawableValuesReason(
    write.kind,
    read.value,
    storedReaderOf(context.doc, write.field),
  );
  if (finding !== undefined || write.kind !== 'style') return finding;
  return imagePaintFinding(context, write.field.objectId, read.value);
}

/**
 * Judges the identities an update writes: an object retyped, or typed for the first
 * time, keeps only image paints its new type allows, its style read from the same update when it
 * writes one, else from the hub.
 *
 * @param context - The update.
 * @param writes - The update's field writes, for the styles it writes.
 * @returns The first refused identity, or undefined.
 */
function identityFinding(
  context: UpdateContext,
  writes: readonly FieldWrite[],
): HostileValue | undefined {
  for (const objectId of context.identities.keys()) {
    let styleWrite: FieldWrite | undefined;
    for (const write of writes) {
      if (write.kind === 'style' && write.field.objectId === objectId) styleWrite = write;
    }
    const style =
      styleWrite === undefined
        ? hubObjectKey(context.doc, objectId, 'style')
        : readWritten(context.update, styleWrite.item);
    const finding = imagePaintFinding(context, objectId, style);
    if (finding !== undefined) return { objectId, key: 'identity', ...finding };
  }
  return undefined;
}

/**
 * Judges the values an update writes into objects (part 1): the first the door refuses
 * (out of the ranges a renderer draws within, of the wrong type, or not a plain value), and how
 * many have an older layout's shape. A field written as the hub holds it is not judged. Reads
 * each judged value once from the update's bytes; reads the hub, once, only for a value it would
 * refuse.
 *
 * @param doc - The hub's document, before the update; read, never changed.
 * @param update - The update's bytes; not mutated.
 * @param writes - The values it writes into objects, where Yjs puts them.
 * @param board - The board's layout before the update.
 * @param identities - The update's `identity` writes by object id, to judge image paints by
 *   their object's type.
 * @param stampedLayout - The highest layout the update's stamps add, if any.
 * @returns What it found.
 * @throws {Error} When a value runs past the update, which the scan of the same bytes has
 *   already ruled out.
 */
export function judgeFieldWrites(
  doc: Y.Doc,
  update: Uint8Array,
  writes: readonly FieldWrite[],
  board: BoardLayout,
  identities: ReadonlyMap<string, ScannedItem> = new Map(),
  stampedLayout?: number,
): FieldValueReading {
  const context: UpdateContext = {
    doc,
    update,
    identities,
    layoutAfter: Math.max(board.layoutVersion ?? 0, stampedLayout ?? 0),
  };
  const isSplitBoard = (board.layoutVersion ?? 0) >= SPLIT_LINE_ENDS_LAYOUT;
  let layoutShapedWrites = 0;
  for (const write of writes) {
    const finding = findingOf(context, write);
    if (finding !== undefined) {
      const { objectId, key, memberId } = write.field;
      return {
        hostileValue: {
          objectId,
          key,
          ...(memberId === undefined ? {} : { memberId }),
          ...finding,
        },
        layoutShapedWrites,
      };
    }
    if (isSplitBoard && write.kind === 'points') layoutShapedWrites += 1;
  }
  const hostileIdentity = identityFinding(context, writes);
  return hostileIdentity === undefined
    ? { layoutShapedWrites }
    : { hostileValue: hostileIdentity, layoutShapedWrites };
}
