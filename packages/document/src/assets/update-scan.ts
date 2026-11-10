import * as decoding from 'lib0/decoding';

import {
  readBoundedString,
  readByte,
  readCount,
  type MalformedUpdateError,
} from './update-bounds.js';
import {
  CONTENT_ANY,
  CONTENT_DELETED,
  CONTENT_EMBED,
  CONTENT_FORMAT,
  CONTENT_JSON,
  CONTENT_TYPE,
  GC_STRUCT,
  SKIP_STRUCT,
  skipContent,
  type ContentExtent,
} from './update-content.js';
import type { UpdateDepthError } from './update-depth.js';

// A reader of Yjs update format v1 (the bytes of `Y.encodeStateAsUpdate`) that walks every
// struct without building a document or any content: it keeps one flat record per item that can
// be a map entry, and skips text, formatting and nested values in place. `Y.applyUpdate` into a
// new `Y.Doc` takes about 1.1 s on the 50k-object board and a full store load 2.6 s (packages/
// document README). The format is Yjs's `readClientsStructRefs` and `readDeleteSet` for
// `UpdateDecoderV1` (yjs 13.6, src/utils/encoding.js and src/utils/DeleteSet.js), the sync
// protocol's wire format, which Yjs keeps stable across releases.

/** The bits of an item's info byte. */
const HAS_ORIGIN = 0b1000_0000;
const HAS_RIGHT_ORIGIN = 0b0100_0000;
const HAS_PARENT_SUB = 0b0010_0000;
const CONTENT_BITS = 0b0001_1111;

/** The type number of `Y.Map` in a `ContentType`. */
export const Y_MAP_TYPE = 1;

/** No client: the value of `originClient` and `parentClient` when there is none. */
export const NO_CLIENT = -1;

/**
 * What kind of content a scanned struct holds: `json` (`ContentJSON`) and `embed`
 * (`ContentEmbed`) are plain values the codec never writes but `Y.Map#get` returns; `format`
 * (`ContentFormat`) is a text format, whose value is JSON text too; `other` is any
 * other content that is never a map entry written by the codec (text, binary, subdocuments);
 * `gc` a collected range and `skip` a range the update does not hold. Those six are kept only
 * when asked for ({@link ScanOptions.shouldKeepEveryStruct}); a `gc` or `skip` record names no
 * neighbour.
 */
export type ScannedContent =
  'any' | 'type' | 'deleted' | 'json' | 'embed' | 'format' | 'other' | 'gc' | 'skip';

/**
 * One item that can be a map entry: a plain value (`ContentAny`), a shared type
 * (`ContentType`), or a deleted item (`ContentDeleted`). Parent and key are written only for an
 * item inserted with neither neighbour; the others inherit them from their origin. Ids are
 * flattened into numbers so a board's hundreds of thousands of items cost one object each.
 */
export interface ScannedItem {
  /** The item's client. */
  readonly client: number;
  /** The item's first clock. */
  readonly clock: number;
  /** How many clocks the item spans. */
  readonly length: number;
  /** What the item holds. */
  readonly content: ScannedContent;
  /** The client of the item to the left at insertion, or {@link NO_CLIENT}. */
  readonly originClient: number;
  /** The clock of the item to the left at insertion. */
  readonly originClock: number;
  /**
   * The client of the item to the right at insertion, or {@link NO_CLIENT}. Yjs takes an
   * item's parent from its right neighbour when it has no left one.
   */
  readonly rightOriginClient: number;
  /** The clock of the item to the right at insertion. */
  readonly rightOriginClock: number;
  /** The top-level type's name, when the parent is written and is a top-level type. */
  readonly parentName: string | undefined;
  /** The client of the parent type's item, when written and nested, or {@link NO_CLIENT}. */
  readonly parentClient: number;
  /** The clock of the parent type's item. */
  readonly parentClock: number;
  /** The map key, when written. */
  readonly parentSub: string | undefined;
  /**
   * For `any` and `json`: where the values start (at their count); for `embed`: where its JSON
   * string starts; for `format`: where its key starts (its JSON value follows); for `type`: the
   * type number.
   */
  readonly detail: number;
}

/** How {@link scanUpdate} chooses the items it keeps. */
export interface ScanOptions {
  /**
   * Keep every struct, as Yjs reads the update (the relay's stamp check, which replays Yjs's
   * integration): items of every key and content, collected (`gc`) and skipped (`skip`) ranges,
   * and, for a client listed more than once, only its last run of structs, which is the one
   * Yjs keeps (`readClientsStructRefs` sets each client's structs anew per run). A client's
   * records are then in the order Yjs integrates them, contiguous from its first clock.
   */
  readonly shouldKeepEveryStruct?: boolean;
  /** Traverse all content without retaining records, for pre-decode depth validation. */
  readonly shouldDiscardRecords?: boolean;
}

/** The items of an update that can be map entries, and its delete set. */
export interface UpdateScan {
  /** Each client's scanned items, ascending by clock. */
  readonly items: ReadonlyMap<number, readonly ScannedItem[]>;
  /** Each client's deleted ranges, as `[clock, length]` pairs, ascending. */
  readonly deleted: ReadonlyMap<number, readonly (readonly [number, number])[]>;
}

/**
 * The record of a collected or skipped range, which names no neighbour and no parent.
 *
 * @param client - The range's client.
 * @param clock - Its first clock.
 * @param length - How many clocks it spans.
 * @param content - `gc` or `skip`.
 * @returns The record.
 */
function rangeRecord(
  client: number,
  clock: number,
  length: number,
  content: 'gc' | 'skip',
): ScannedItem {
  return {
    client,
    clock,
    length,
    content,
    originClient: NO_CLIENT,
    originClock: 0,
    rightOriginClient: NO_CLIENT,
    rightOriginClock: 0,
    parentName: undefined,
    parentClient: NO_CLIENT,
    parentClock: 0,
    parentSub: undefined,
    detail: 0,
  };
}

/**
 * Names the content kinds that can be map entries.
 *
 * @param kind - The content number.
 * @returns The scanned kind, or undefined for content that is never a map entry.
 */
function contentOf(kind: number): ScannedContent | undefined {
  if (kind === CONTENT_ANY) return 'any';
  if (kind === CONTENT_TYPE) return 'type';
  if (kind === CONTENT_DELETED) return 'deleted';
  return undefined;
}

/**
 * Names the content kinds kept only when every struct is: JSON and embeds, which `Y.Map#get`
 * returns as plain values, and formats, whose value Yjs parses as JSON, apart from the rest.
 *
 * @param kind - The content number.
 * @returns The scanned kind.
 */
function otherContentOf(kind: number): ScannedContent {
  if (kind === CONTENT_JSON) return 'json';
  if (kind === CONTENT_FORMAT) return 'format';
  return kind === CONTENT_EMBED ? 'embed' : 'other';
}

/**
 * Walks one update's structs, reusing its fields for the content just read so no object is
 * made per struct.
 */
class StructWalker {
  readonly #decoder: decoding.Decoder;
  readonly #keys: ReadonlySet<string>;
  readonly #shouldKeepEveryStruct: boolean;
  readonly #shouldDiscardRecords: boolean;
  /** The clocks and detail of the content just skipped (see {@link ScannedItem.detail}). */
  readonly #extent: ContentExtent = { length: 0, detail: 0 };
  /** Where the delete set starts in the bytes, once the structs have been read. */
  deleteSetStart = 0;
  /** Whether the delete set read so far names any range. */
  hasDeletes = false;

  /**
   * Creates a walker at the start of an update.
   *
   * @param update - The update.
   * @param keys - The map keys whose entries are kept (see {@link scanUpdate}).
   * @param options - Which other items are kept.
   */
  constructor(update: Uint8Array, keys: ReadonlySet<string>, options: ScanOptions) {
    this.#decoder = decoding.createDecoder(update);
    this.#keys = keys;
    this.#shouldKeepEveryStruct = options.shouldKeepEveryStruct === true;
    this.#shouldDiscardRecords = options.shouldDiscardRecords === true;
  }

  /**
   * Reads every client's structs.
   *
   * @returns Each client's scanned items, ascending by clock.
   */
  readStructs(): Map<number, ScannedItem[]> {
    const decoder = this.#decoder;
    const items = new Map<number, ScannedItem[]>();
    for (let updates = readCount(decoder); updates > 0; updates -= 1) {
      const structCount = readCount(decoder);
      const client = decoding.readVarUint(decoder);
      let clock = decoding.readVarUint(decoder);
      const scanned = this.#shouldKeepEveryStruct ? [] : (items.get(client) ?? []);
      for (let index = 0; index < structCount; index += 1) {
        const info = readByte(decoder);
        const kind = info & CONTENT_BITS;
        if (kind === GC_STRUCT || kind === SKIP_STRUCT) {
          const length = decoding.readVarUint(decoder);
          if (this.#shouldKeepEveryStruct && !this.#shouldDiscardRecords) {
            scanned.push(rangeRecord(client, clock, length, kind === GC_STRUCT ? 'gc' : 'skip'));
          }
          clock += length;
          continue;
        }
        const item = this.#readItem(info, client, clock);
        if (item !== undefined) scanned.push(item);
        clock += this.#extent.length;
      }
      if (!this.#shouldDiscardRecords) items.set(client, scanned);
    }
    // A whole document's state lists each client once, in clock order; a merged update may not.
    if (!this.#shouldKeepEveryStruct) {
      for (const scanned of items.values())
        scanned.sort((first, second) => first.clock - second.clock);
    }
    return items;
  }

  /**
   * Reads the delete set that ends an update.
   *
   * @returns Each client's deleted ranges, ascending.
   */
  readDeleteSet(): Map<number, [number, number][]> {
    const decoder = this.#decoder;
    const deleted = new Map<number, [number, number][]>();
    this.deleteSetStart = decoder.pos;
    for (let clients = readCount(decoder); clients > 0; clients -= 1) {
      const client = decoding.readVarUint(decoder);
      const ranges = deleted.get(client) ?? [];
      for (let count = readCount(decoder); count > 0; count -= 1) {
        const clock = decoding.readVarUint(decoder);
        const length = decoding.readVarUint(decoder);
        if (length > 0) this.hasDeletes = true;
        if (!this.#shouldDiscardRecords) ranges.push([clock, length]);
      }
      if (!this.#shouldDiscardRecords) {
        deleted.set(
          client,
          ranges.sort((first, second) => first[0] - second[0]),
        );
      }
    }
    return deleted;
  }

  /**
   * Reads one item, its info byte already read.
   *
   * @param info - The info byte.
   * @param client - The item's client.
   * @param clock - The item's first clock.
   * @returns The item when it is kept; its length is in `#extent`.
   */
  #readItem(info: number, client: number, clock: number): ScannedItem | undefined {
    const decoder = this.#decoder;
    const hasOrigin = (info & HAS_ORIGIN) !== 0;
    const hasRightOrigin = (info & HAS_RIGHT_ORIGIN) !== 0;
    const originClient = hasOrigin ? decoding.readVarUint(decoder) : NO_CLIENT;
    const originClock = hasOrigin ? decoding.readVarUint(decoder) : 0;
    const rightOriginClient = hasRightOrigin ? decoding.readVarUint(decoder) : NO_CLIENT;
    const rightOriginClock = hasRightOrigin ? decoding.readVarUint(decoder) : 0;
    let parentName: string | undefined;
    let parentClient = NO_CLIENT;
    let parentClock = 0;
    let parentSub: string | undefined;
    if (!hasOrigin && !hasRightOrigin) {
      if (decoding.readVarUint(decoder) === 1) {
        parentName = readBoundedString(decoder);
      } else {
        parentClient = decoding.readVarUint(decoder);
        parentClock = decoding.readVarUint(decoder);
      }
      if ((info & HAS_PARENT_SUB) !== 0) parentSub = readBoundedString(decoder);
    }
    const kind = info & CONTENT_BITS;
    skipContent(decoder, kind, this.#extent);
    if (this.#shouldDiscardRecords) return undefined;
    const content =
      contentOf(kind) ?? (this.#shouldKeepEveryStruct ? otherContentOf(kind) : undefined);
    if (content === undefined) return undefined;
    // An entry that names another key cannot be, or lead to, an entry of the keys asked for.
    const isKept =
      this.#shouldKeepEveryStruct ||
      content === 'type' ||
      parentSub === undefined ||
      this.#keys.has(parentSub);
    if (!isKept) return undefined;
    return {
      client,
      clock,
      length: this.#extent.length,
      content,
      originClient,
      originClock,
      rightOriginClient,
      rightOriginClock,
      parentName,
      parentClient,
      parentClock,
      parentSub,
      detail: this.#extent.detail,
    };
  }
}

/**
 * Walks a Yjs update (format v1) and returns the items that can be map entries with the
 * delete set, without applying it to a document. Every shared type's item is kept (any can be a
 * parent), and plain or deleted items unless their written key is not in `keys`: a replaced map
 * value inherits its key from the value it replaced, so an item under another key can neither
 * be nor lead to an entry of those keys. Dropping them keeps the scan to the entries asked for.
 *
 * @param update - A Yjs update, typically a whole document's state; not mutated.
 * @param keys - The map keys whose entries the caller will read.
 * @param options - Which other items are kept; none by default.
 * @returns The scanned items and deleted ranges.
 * @throws {RangeError} When the update holds content this reader does not know.
 * @throws {MalformedUpdateError} When a read would pass the end of the bytes or a declared count
 *   is larger than the bytes left; the scan's work is bounded by the update's length.
 * @throws {UpdateDepthError} When a plain value nests deeper than the bound.
 * @throws {Error} When the update ends early (lib0's "Unexpected end of array").
 */
export function scanUpdate(
  update: Uint8Array,
  keys: ReadonlySet<string>,
  options: ScanOptions = {},
): UpdateScan {
  const walker = new StructWalker(update, keys, options);
  const items = walker.readStructs();
  return { items, deleted: walker.readDeleteSet() };
}

/**
 * Checks plain value nesting before Yjs recursively decodes or merges update-v1 bytes.
 * Keeps no struct or deletion records and never applies the update. This is not a stamp or
 * schema check; malformed bytes may still fail later in Yjs's decoder.
 *
 * @param update - Encoded update-v1 bytes; not mutated.
 * @throws {UpdateDepthError} When a plain object/array exceeds the nesting bound.
 * @throws {MalformedUpdateError} When the bytes cannot be read within their length.
 * @throws {Error} When the scanner cannot read the update otherwise.
 */
export function assertUpdateDepth(update: Uint8Array): void {
  readUpdateShape(update);
}

/** Where an update's structs end and its deletions begin. */
export interface UpdateShape {
  /** The offset of the delete set in the bytes: everything before it is the structs. */
  readonly deleteSetStart: number;
  /** Whether the delete set names any range. */
  readonly hasDeletes: boolean;
}

/**
 * Reads where an update's structs end and its delete set begins, with the checks of
 * {@link assertUpdateDepth} (it is the same walk, keeping no records), so the store can apply
 * the deletions apart from the structs (`store/held-deletes.ts`).
 *
 * @param update - Encoded update-v1 bytes; not mutated.
 * @returns The shape.
 * @throws {UpdateDepthError} When a plain object/array exceeds the nesting bound.
 * @throws {MalformedUpdateError} When the bytes cannot be read within their length.
 * @throws {Error} When the scanner cannot read the update otherwise.
 */
export function readUpdateShape(update: Uint8Array): UpdateShape {
  const walker = new StructWalker(update, new Set(), { shouldDiscardRecords: true });
  walker.readStructs();
  walker.readDeleteSet();
  const { deleteSetStart, hasDeletes } = walker;
  return { deleteSetStart, hasDeletes };
}
