import { isScannedItemWhollyDeleted } from '../assets/scanned-item-lookup.js';
import { isDecodableContent } from '../assets/scanned-value.js';
import { scanUpdate, type ScannedItem, type UpdateScan } from '../assets/update-scan.js';

import type { Landing } from './held-structs.js';

// Content Yjs cannot decode: JSON, an embed or a format's value whose text no JSON
// parser takes, which a hostile encoder can write and no Yjs ever does. Yjs reads every struct of
// an update before it applies any of it, so one such value anywhere makes `Y.applyUpdate` throw
// whatever it lands on: the relay must never hand those bytes to Yjs. Where the values would
// land decides how the relay answers (`UpdateGate`): a value that lands nowhere (in an object
// deleted since its writer saw it, so Yjs collects it; at clocks the board already holds; or
// removed by the update's own delete set) is answered as the same value would be in content
// Yjs decodes, which the door takes and Yjs drops; a value that lands on the board is refused.
// `UpdateStampCheck` reports it for a writer's update; `holdsUndecodableContent` is exported for
// a read-only connection's, which the relay checks for nothing else.

/**
 * Where an update's undecodable values would land: `none` when it holds none, `nowhere` when
 * none of them would land on the board, `on-board` when one would.
 */
export type UndecodablePlacement = 'none' | 'nowhere' | 'on-board';

/**
 * Tells whether an item Yjs would integrate lands on the board: integrated (its landing known),
 * not collected, and not removed by the update's own delete set.
 *
 * @param item - The item.
 * @param scan - The update's scan.
 * @param landings - Where the replay put each item it integrates.
 * @returns `true` when its value would be on the board.
 */
function landsOnBoard(
  item: ScannedItem,
  scan: UpdateScan,
  landings: ReadonlyMap<ScannedItem, Landing>,
): boolean {
  const landing = landings.get(item);
  return landing !== undefined && !landing.isCollected && !isScannedItemWhollyDeleted(scan, item);
}

/**
 * Finds where an update's undecodable values would land. Reads only JSON, embed and format
 * items, each once; O(their text).
 *
 * @param update - The update's bytes.
 * @param scan - The update scanned with `shouldKeepEveryStruct`.
 * @param landings - Where the replay put each item it integrates (`replayIntegration`).
 * @returns `none`, `nowhere` or `on-board`.
 */
export function undecodablePlacementOf(
  update: Uint8Array,
  scan: UpdateScan,
  landings: ReadonlyMap<ScannedItem, Landing>,
): UndecodablePlacement {
  let placement: UndecodablePlacement = 'none';
  for (const items of scan.items.values()) {
    for (const item of items) {
      if (isDecodableContent(update, item)) continue;
      if (landsOnBoard(item, scan, landings)) return 'on-board';
      placement = 'nowhere';
    }
  }
  return placement;
}

/**
 * Tells whether an update holds a value Yjs cannot decode, wherever it would land: for an update
 * the relay does not otherwise check, a read-only connection's, which Hocuspocus still decodes to
 * acknowledge a sync step 2. O(the update's length).
 *
 * @param update - The update's bytes, already read within their length (`assertUpdateDepth`).
 * @returns `true` when `Y.applyUpdate` would throw on one.
 * @throws {RangeError} When the bytes cannot be read (`MalformedUpdateError`), which
 *   `assertUpdateDepth` rules out.
 */
export function holdsUndecodableContent(update: Uint8Array): boolean {
  const scan = scanUpdate(update, new Set(), { shouldKeepEveryStruct: true });
  for (const items of scan.items.values()) {
    if (items.some((item) => !isDecodableContent(update, item))) return true;
  }
  return false;
}
