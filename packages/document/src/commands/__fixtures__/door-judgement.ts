import * as Y from 'yjs';

import { scanUpdate } from '../../assets/update-scan.js';
import { judgeFieldWrites, type HostileValue } from '../../meta/field-values.js';
import { MAX_STAMP_CHECK_STEPS } from '../../meta/update-stamp-check.js';
import { readUpdateStamps } from '../../meta/update-stamp-reading.js';
import type { DocumentStore } from '../../store/document-store.js';

/**
 * What the relay's door finds in one update (part 1), judged directly: the update is
 * read as live admission reads it (`readUpdateStamps`) and its values judged by
 * `judgeFieldWrites` against the hub's document as it was before the update.
 *
 * @param hub - The hub's document before the update; not changed.
 * @param update - The update.
 * @returns The first value the door refuses, or `undefined`.
 */
export function doorFindingOf(hub: Y.Doc, update: Uint8Array): HostileValue | undefined {
  const scan = scanUpdate(update, new Set(), { shouldKeepEveryStruct: true });
  const reading = readUpdateStamps(hub, update, scan, MAX_STAMP_CHECK_STEPS);
  if (reading.fieldWrites.length === 0) return undefined;
  return judgeFieldWrites(hub, update, reading.fieldWrites, reading.board).hostileValue;
}

/**
 * Runs writes on a store and judges every update they send as the relay's door would, each
 * against a hub that holds what the store held before it, as a relay in sync with the store does.
 *
 * @param store - The store.
 * @param write - The writes (commands, usually).
 * @returns What `write` returned, the door's findings (one per update that had one) and how many
 *   updates were judged.
 */
export function judgedAtDoor<Result>(
  store: DocumentStore,
  write: () => Result,
): {
  readonly result: Result;
  readonly findings: readonly HostileValue[];
  readonly updateCount: number;
} {
  const hub = new Y.Doc();
  Y.applyUpdate(hub, store.encodeState());
  const findings: HostileValue[] = [];
  let updateCount = 0;
  const stop = store.subscribeUpdates(({ update }) => {
    updateCount += 1;
    const finding = doorFindingOf(hub, update);
    if (finding !== undefined) findings.push(finding);
    Y.applyUpdate(hub, update);
  });
  try {
    const result = write();
    return { result, findings, updateCount };
  } finally {
    stop();
    hub.destroy();
  }
}
