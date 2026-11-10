import { readScannedPlainValue } from '../assets/scanned-value.js';
import type { ScannedItem } from '../assets/update-scan.js';
import {
  isStyleIdentity,
  isStyleName,
  isStyleValue,
  parseStyleKey,
  type StyleKind,
} from '../styles/style-map.js';

import type { HostileValue } from './field-values.js';

// The relay's door check of writes into the named style maps: judged by
// key shape, as the colour tokens map is (`token-values.ts`). `<id>.identity` holds exactly
// `{ createdBy, createdAt }`, `<id>.name` a style name, `<id>.value` a value of the map's kind (a
// text style's six fields, an effect style's `{ shadows }`); any other key or value is refused
// (4426 `update-malformed`, `hostile-values`). The door never counts styles (the limit is a
// creation limit), and who may write which style is the relay's agent check, not the door's.
// Package-internal.

/** A value an update writes into a style map. */
export interface StyleMapWrite {
  /** The value's item in the update. */
  readonly item: ScannedItem;
  /** Its key in the map. */
  readonly key: string;
  /** Which map. */
  readonly kind: StyleKind;
}

/**
 * Judges one write into a style map.
 *
 * @param update - The update's bytes.
 * @param write - The write.
 * @returns Why it is refused, or undefined.
 */
function styleFinding(
  update: Uint8Array,
  write: StyleMapWrite,
): HostileValue['reason'] | undefined {
  const parsed = parseStyleKey(write.key);
  if (parsed === undefined) return 'not-a-style-key';
  let read: { readonly value: unknown } | undefined;
  try {
    read = readScannedPlainValue(update, write.item);
  } catch {
    return 'not-a-plain-value';
  }
  if (read === undefined) return 'not-a-plain-value';
  const { value } = read;
  switch (parsed.field) {
    case 'identity':
      return isStyleIdentity(value) ? undefined : 'not-a-style-value';
    case 'name':
      return isStyleName(value) ? undefined : 'not-a-style-value';
    default:
      return isStyleValue(write.kind, value) ? undefined : 'not-a-style-value';
  }
}

/**
 * Judges the values an update writes into the named style maps: the first the door refuses, if
 * any. Reads each value once from the update's bytes; never reads the hub.
 *
 * @param update - The update's bytes; not mutated.
 * @param writes - The values it writes into the style maps, where Yjs puts them.
 * @returns The first refused write, or undefined.
 */
export function judgeStyleWrites(
  update: Uint8Array,
  writes: readonly StyleMapWrite[],
): HostileValue | undefined {
  for (const write of writes) {
    const reason = styleFinding(update, write);
    if (reason !== undefined) {
      return { objectId: '', key: write.key, field: '', reason, styleKey: write.key };
    }
  }
  return undefined;
}
