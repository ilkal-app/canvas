import { readScannedPlainValue } from '../assets/scanned-value.js';
import type { ScannedItem } from '../assets/update-scan.js';
import { isPageIdentity, isPageName, isPageOrder, parsePageKey } from '../pages/page-map.js';

import type { HostileValue } from './field-values.js';

// The relay's door check of writes into the pages map: judged by key
// shape. `<id>.identity` holds a record with that id, `<id>.name` a string of at most 200
// characters, `<id>.order` a valid z key; any other key or value is refused, as a value out of
// range is (4426 `update-malformed`, `hostile-values`). The door never counts pages (the limit is
// a creation limit) and never asks whether a placement's `pageId` names a live page.
// Package-internal: `UpdateStampCheck` reports what it finds.

/** A value an update writes into the pages map. */
export interface PageWrite {
  /** The value's item in the update. */
  readonly item: ScannedItem;
  /** Its key in the pages map. */
  readonly key: string;
}

/**
 * Judges one write into the pages map.
 *
 * @param update - The update's bytes.
 * @param write - The write.
 * @returns Why it is refused, or undefined.
 */
function pageFinding(update: Uint8Array, write: PageWrite): HostileValue['reason'] | undefined {
  const parsed = parsePageKey(write.key);
  if (parsed === undefined) return 'not-a-page-key';
  let read: { readonly value: unknown } | undefined;
  try {
    read = readScannedPlainValue(update, write.item);
  } catch {
    return 'not-a-plain-value';
  }
  if (read === undefined) return 'not-a-plain-value';
  const { value } = read;
  const isValid =
    parsed.field === 'identity'
      ? isPageIdentity(value, parsed.pageId)
      : parsed.field === 'name'
        ? isPageName(value)
        : isPageOrder(value);
  return isValid ? undefined : 'not-a-page-value';
}

/**
 * Judges the values an update writes into the pages map: the first the door refuses, if any.
 * Reads each value once from the update's bytes; never reads the hub.
 *
 * @param update - The update's bytes; not mutated.
 * @param writes - The values it writes into the pages map, where Yjs puts them.
 * @returns The first refused write, or undefined.
 */
export function judgePageWrites(
  update: Uint8Array,
  writes: readonly PageWrite[],
): HostileValue | undefined {
  for (const write of writes) {
    const reason = pageFinding(update, write);
    if (reason !== undefined) {
      return { objectId: '', key: write.key, field: '', reason, pageKey: write.key };
    }
  }
  return undefined;
}
