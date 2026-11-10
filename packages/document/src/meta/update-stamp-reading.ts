import type * as Y from 'yjs';

import { isScannedItemWhollyDeleted } from '../assets/scanned-item-lookup.js';
import { readScannedValue } from '../assets/scanned-value.js';
import type { ScannedItem } from '../assets/update-scan.js';
import type { UpdateScan } from '../assets/update-scan.js';
import { FACILITATION_MAP_NAME } from '../facilitation/timer-map.js';
import { PAGES_MAP_NAME } from '../pages/page-map.js';
import { OBJECTS_MAP_NAME } from '../store/yjs-document-store.js';
import { EFFECT_STYLES_MAP_NAME, TEXT_STYLES_MAP_NAME } from '../styles/style-map.js';
import { TOKENS_MAP_NAME } from '../tokens/token-map.js';

import { DOCUMENT_META_KEY, META_MAP_NAME } from './document-meta.js';
import type { FacilitationMapWrite } from './facilitation-values.js';
import { FieldLandings } from './field-landings.js';
import { judgedKindOf, type FieldWrite } from './field-values.js';
import type { Landing } from './held-structs.js';
import { isAcceptableStamp, readBoardLayout, type BoardLayout } from './layout-gate.js';
import { isObjectEntry } from './object-entry.js';
import type { PageWrite } from './page-values.js';
import type { StyleMapWrite } from './style-values.js';
import type { TokenMapWrite } from './token-values.js';
import { undecodablePlacementOf, type UndecodablePlacement } from './undecodable-content.js';
import { replayIntegration, type HoldBackCause } from './update-integration.js';

// What an update would write where it matters to the layout gate: object entries and
// layout stamps, by writer, counted only where Yjs applies them (`replayIntegration`); and, for
// the door check of values (part 1), the values it writes into objects' judged fields,
// from the same replay. Package-internal: `UpdateStampCheck` turns it into a verdict.

/** What one update writes to object entries and to the layout stamp, by writer. */
export interface StampReading {
  /**
   * Writers of object entries Yjs applies now (any item under a key of `objects` that does not
   * arrive deleted, as `isObjectEntry` says), with the lowest clock of each writer's.
   */
  readonly objectClocks: ReadonlyMap<number, number>;
  /**
   * Writers of stamps Yjs adds now, as items under `meta`/`document` (deleted or not, as the
   * guard counts them), at clocks the document did not hold, with the lowest clock of each
   * writer's.
   */
  readonly stampClocks: ReadonlyMap<number, number>;
  /** Writers of a stamp Yjs adds that the relay refuses (`isAcceptableStamp`). */
  readonly invalidStampWriters: ReadonlySet<number>;
  /** Clients some of whose structs Yjs would keep pending, and why. */
  readonly heldBack: ReadonlyMap<number, HoldBackCause>;
  /** Yjs would throw part way through the update. */
  readonly isMalformed: boolean;
  /** Whether the work ceiling was hit, so the rest above may be incomplete. */
  readonly isExhausted: boolean;
  /**
   * The items, of any content but a deletion, Yjs applies now into objects' judged fields
   * (`judgedKindOf`), in the replay's order, leaving out values the update's own delete set removes; empty for a durable
   * history replay, which the door does not judge.
   */
  readonly fieldWrites: readonly FieldWrite[];
  /**
   * Each object's `identity` the update writes, by object id (the last in the replay's order), so
   * the door can judge a style by its object's type; empty for a durable history replay.
   */
  readonly identityWrites: ReadonlyMap<string, ScannedItem>;
  /**
   * The highest layout among the acceptable stamps the update adds, or undefined when it adds
   * none: with the board's layout before it, the layout the board holds after it.
   */
  readonly stampedLayout: number | undefined;
  /**
   * The values, of any content but a deletion, Yjs applies now into the pages map, in
   * the replay's order, leaving out values the update's own delete set removes; empty for a
   * durable history replay.
   */
  readonly pageWrites: readonly PageWrite[];
  /**
   * The values, of any content but a deletion, Yjs applies now into the colour tokens map,
   * in the replay's order, leaving out values the update's own delete set removes;
   * empty for a durable history replay.
   */
  readonly tokenWrites: readonly TokenMapWrite[];
  /**
   * The values, of any content but a deletion, Yjs applies now into the named style maps,
   * in the replay's order, leaving out values the update's own delete set removes;
   * empty for a durable history replay.
   */
  readonly styleWrites: readonly StyleMapWrite[];
  /**
   * The values, of any content but a deletion, Yjs applies now into the facilitation map,
   * in the replay's order, leaving out values the update's own delete set removes;
   * empty for a durable history replay.
   */
  readonly facilitationWrites: readonly FacilitationMapWrite[];
  /** The board's layout before the update (`readBoardLayout`). */
  readonly board: BoardLayout;
  /**
   * Where the update's values Yjs cannot decode would land (`undecodablePlacementOf`):
   * any one makes Yjs throw while reading the update. Always `none` for a durable history replay.
   */
  readonly undecodable: UndecodablePlacement;
}

/**
 * Lowers a writer's recorded clock to `clock` if it is lower.
 *
 * @param clocks - Each writer's lowest clock; changed in place.
 * @param writer - The writer.
 * @param clock - A clock of theirs.
 */
function recordLowest(clocks: Map<number, number>, writer: number, clock: number): void {
  clocks.set(writer, Math.min(clock, clocks.get(writer) ?? clock));
}

/**
 * The key an item writes in the pages map, the colour tokens map, a named
 * style map or the facilitation map, which a
 * live check judges by key shape: undefined for any other item, a deletion, or an item the
 * update itself deletes.
 *
 * @param scan - The update scanned with `shouldKeepEveryStruct`.
 * @param item - The item.
 * @param landing - Where it lands.
 * @returns The key, or undefined.
 */
function keyedMapKeyOf(scan: UpdateScan, item: ScannedItem, landing: Landing): string | undefined {
  const isKeyedMap =
    landing.parentName === PAGES_MAP_NAME ||
    landing.parentName === TOKENS_MAP_NAME ||
    landing.parentName === TEXT_STYLES_MAP_NAME ||
    landing.parentName === EFFECT_STYLES_MAP_NAME ||
    landing.parentName === FACILITATION_MAP_NAME;
  if (!isKeyedMap || item.content === 'deleted' || isScannedItemWhollyDeleted(scan, item)) {
    return undefined;
  }
  return landing.parentSub;
}

/** The values an update writes into the keyed maps, by map. */
interface KeyedMapWrites {
  /** Into the pages map. */
  readonly pageWrites: PageWrite[];
  /** Into the colour tokens map. */
  readonly tokenWrites: TokenMapWrite[];
  /** Into the named style maps. */
  readonly styleWrites: StyleMapWrite[];
  /** Into the facilitation map. */
  readonly facilitationWrites: FacilitationMapWrite[];
}

/**
 * Records a write into a keyed map under its map.
 *
 * @param keyed - The writes so far; appended to.
 * @param item - The written item.
 * @param landing - Where it lands.
 * @param key - Its key in the map.
 */
function recordKeyedWrite(
  keyed: KeyedMapWrites,
  item: ScannedItem,
  landing: Landing,
  key: string,
): void {
  if (landing.parentName === TEXT_STYLES_MAP_NAME) {
    keyed.styleWrites.push({ item, key, kind: 'text' });
  } else if (landing.parentName === EFFECT_STYLES_MAP_NAME) {
    keyed.styleWrites.push({ item, key, kind: 'effect' });
  } else if (landing.parentName === PAGES_MAP_NAME) {
    keyed.pageWrites.push({ item, key });
  } else if (landing.parentName === FACILITATION_MAP_NAME) {
    keyed.facilitationWrites.push({ item, key });
  } else {
    keyed.tokenWrites.push({ item, key });
  }
}

/**
 * Records a value inside a type nested under the facilitation map (one an older relay let in),
 * so the door judges it too, and refuses it: the map holds plain values only.
 *
 * @param keyed - The writes so far; appended to.
 * @param fields - The landings' resolution.
 * @param scan - The update scanned with `shouldKeepEveryStruct`.
 * @param item - A value with a nested parent, of any content but a deletion.
 * @param landing - Where it lands.
 */
function recordNestedFacilitation(
  keyed: KeyedMapWrites,
  fields: FieldLandings,
  scan: UpdateScan,
  item: ScannedItem,
  landing: Landing,
): void {
  if (fields.rootNameOf(landing) !== FACILITATION_MAP_NAME) return;
  if (isScannedItemWhollyDeleted(scan, item)) return;
  keyed.facilitationWrites.push({ item, key: landing.parentSub ?? '', isNested: true });
}

/**
 * Reads what an update writes to object entries and to the layout stamp, by writer, against
 * the document it is bound for: only what Yjs integrates now counts, where Yjs puts
 * it. A stamp at a clock the document already holds, one Yjs keeps pending, and one it collects
 * are not counted; a live stamp is judged by `isAcceptableStamp` whether or not the update's
 * delete set removes it. A live check also lists the values written into objects' judged fields,
 * placed by {@link FieldLandings}.
 *
 * @param doc - The board's document; read, never changed.
 * @param update - The update's bytes; not mutated.
 * @param scan - The update scanned with `shouldKeepEveryStruct`.
 * @param maxSteps - The work ceiling, in structs taken.
 * @param isHistoricalReplay - Whether supported older stamps may replay from durable history.
 * @returns The writers of object entries and stamps, refused stamps, and what Yjs holds back.
 * @throws {Error} When a stamp's value runs past the update, which a scan of the same bytes
 *   has already ruled out.
 */
export function readUpdateStamps(
  doc: Y.Doc,
  update: Uint8Array,
  scan: UpdateScan,
  maxSteps: number,
  isHistoricalReplay = false,
): StampReading {
  const replay = replayIntegration(doc, scan, maxSteps);
  const board = isHistoricalReplay
    ? { isStamped: false, layoutVersion: undefined }
    : readBoardLayout(doc);
  const objectClocks = new Map<number, number>();
  const stampClocks = new Map<number, number>();
  const invalidStampWriters = new Set<number>();
  const fields = isHistoricalReplay ? undefined : new FieldLandings(doc, replay.landings);
  const fieldWrites: FieldWrite[] = [];
  const identityWrites = new Map<string, ScannedItem>();
  let stampedLayout: number | undefined;
  const keyed: KeyedMapWrites = {
    pageWrites: [],
    tokenWrites: [],
    styleWrites: [],
    facilitationWrites: [],
  };
  for (const [item, landing] of replay.landings) {
    if (landing.isCollected) continue;
    const keyedMapKey = fields === undefined ? undefined : keyedMapKeyOf(scan, item, landing);
    if (keyedMapKey !== undefined) recordKeyedWrite(keyed, item, landing, keyedMapKey);
    // Any content but a deletion: JSON and embeds are values `Y.Map#get` returns, and other
    // content under a judged key is refused (fix round 1).
    if (fields !== undefined && item.content !== 'deleted' && landing.parentName === undefined) {
      const field = fields.resolve(landing);
      const kind = field === undefined ? undefined : judgedKindOf(field);
      if (field !== undefined && kind !== undefined && !isScannedItemWhollyDeleted(scan, item)) {
        fieldWrites.push({ item, field, kind });
      }
      if (field?.key === 'identity' && field.memberId === undefined) {
        identityWrites.set(field.objectId, item);
      }
      if (field === undefined) recordNestedFacilitation(keyed, fields, scan, item, landing);
    }
    // Yjs applies the delete set last, so a throw part way would leave it undone: not relied on.
    const isEntry = isObjectEntry({
      isUnderObjects: landing.parentName === OBJECTS_MAP_NAME,
      key: landing.parentSub,
      isDeleted: item.content === 'deleted',
    });
    if (isEntry) recordLowest(objectClocks, item.client, item.clock);
    if (landing.parentName !== META_MAP_NAME || landing.parentSub !== DOCUMENT_META_KEY) continue;
    if (item.clock >= (replay.initialStates.get(item.client) ?? 0)) {
      recordLowest(stampClocks, item.client, item.clock);
    }
    const stamp = item.content === 'any' ? readScannedValue(update, item) : undefined;
    const isAcceptable = item.content === 'any' && isAcceptableStamp(stamp, board);
    if (item.content !== 'deleted' && !isAcceptable) invalidStampWriters.add(item.client);
    if (isAcceptable) {
      const { layoutVersion } = stamp as { readonly layoutVersion: number };
      stampedLayout = Math.max(stampedLayout ?? 0, layoutVersion);
    }
  }
  return {
    objectClocks,
    stampClocks,
    invalidStampWriters,
    heldBack: replay.heldBack,
    isMalformed: replay.isMalformed,
    isExhausted: replay.isExhausted,
    fieldWrites,
    identityWrites,
    stampedLayout,
    ...keyed,
    board,
    undecodable: isHistoricalReplay
      ? 'none'
      : undecodablePlacementOf(update, scan, replay.landings),
  };
}
