import { boardTimerSchema } from '@canvas/schema';

import { readScannedPlainValue } from '../assets/scanned-value.js';
import type { ScannedItem } from '../assets/update-scan.js';
import { STICKY_AUTHORS_KEY } from '../facilitation/sticky-authors-map.js';
import { BOARD_TIMER_KEY } from '../facilitation/timer-map.js';

import type { HostileValue } from './field-values.js';

// The relay's door check of writes into the facilitation map: the keys are
// `timer` and `stickyAuthors`, nothing may be written inside a type nested under them (an older
// relay may have let one in), the timer must be a board timer as `boardTimerSchema` reads it (a
// strict record: status, duration, time left and start within range) and the sticky author
// setting a plain boolean. Any other key or value is refused (4426
// `update-malformed`, `hostile-values`), so a hostile writer cannot leave a value every reader
// would read as no timer. Who may write is the relay's role check: viewers and commenters write
// nothing. Package-internal.

/** A value an update writes into the facilitation map. */
export interface FacilitationMapWrite {
  /** The value's item in the update. */
  readonly item: ScannedItem;
  /** Its key: in the facilitation map, or in the nested type it lands in. */
  readonly key: string;
  /** Set when it lands inside a type nested under the map, never a plain value of it. */
  readonly isNested?: true;
}

/**
 * Judges one write into the facilitation map.
 *
 * @param update - The update's bytes.
 * @param write - The write.
 * @returns Why it is refused, or undefined.
 */
function facilitationFinding(
  update: Uint8Array,
  write: FacilitationMapWrite,
): HostileValue['reason'] | undefined {
  if (write.isNested === true) return 'not-a-facilitation-value';
  if (write.key !== BOARD_TIMER_KEY && write.key !== STICKY_AUTHORS_KEY) {
    return 'not-a-facilitation-key';
  }
  let read: { readonly value: unknown } | undefined;
  try {
    read = readScannedPlainValue(update, write.item);
  } catch {
    return 'not-a-plain-value';
  }
  if (read === undefined) return 'not-a-plain-value';
  const isValid =
    write.key === STICKY_AUTHORS_KEY
      ? typeof read.value === 'boolean'
      : boardTimerSchema.safeParse(read.value).success;
  return isValid ? undefined : 'not-a-facilitation-value';
}

/**
 * Judges the values an update writes into the facilitation map: the first the door refuses, if
 * any, with `objectId` empty and `key` the map key. Reads each value once from the update's
 * bytes; never reads the hub.
 *
 * @param update - The update's bytes; not mutated.
 * @param writes - The values it writes into the facilitation map, where Yjs puts them.
 * @returns The first refused write, or undefined.
 */
export function judgeFacilitationWrites(
  update: Uint8Array,
  writes: readonly FacilitationMapWrite[],
): HostileValue | undefined {
  for (const write of writes) {
    const reason = facilitationFinding(update, write);
    if (reason !== undefined) {
      return { objectId: '', key: write.key, field: '', reason };
    }
  }
  return undefined;
}
