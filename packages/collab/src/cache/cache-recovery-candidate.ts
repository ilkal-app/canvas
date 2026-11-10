import * as Y from 'yjs';

import { SYSTEM_ORIGIN, UpdateStampCheck, YjsDocumentStore } from '@canvas/document';

import { findUnsentChanges } from './unsent-changes.js';

/** Proven whole records and the candidate they produce; unresolved bytes remain untouched. */
export interface RecoveryCandidate {
  /** Current-layout snapshot, with no pending structs or deletions. */
  readonly snapshot: Uint8Array;
  /** Original records safe to replay, in dependency order. */
  readonly updates: readonly Uint8Array[];
  /** Original records whose entire content could not be proved safe. */
  readonly unresolved: readonly Uint8Array[];
}

/**
 * Tests one already stamp-checked record with the strict store on an isolated document.
 *
 * @param snapshot - The previously accepted candidate.
 * @param update - The whole original record.
 * @returns Whether the record integrates completely without changing layout readability.
 */
function integrates(snapshot: Uint8Array, update: Uint8Array): boolean {
  const trial = new YjsDocumentStore({ repairMode: 'read-only' });
  try {
    trial.applyUpdate(snapshot, SYSTEM_ORIGIN);
    trial.applyUpdate(update, SYSTEM_ORIGIN);
    const vector = Y.decodeStateVector(trial.encodeStateVector());
    const deletions = Y.decodeUpdate(trial.encodeState(trial.encodeStateVector())).ds;
    return (
      !trial.hasPendingStructs &&
      [...deletions.clients].every(([client, ranges]) =>
        ranges.every((range) => range.clock + range.len <= (vector.get(client) ?? 0)),
      )
    );
  } catch {
    return false;
  } finally {
    trial.destroy();
  }
}

/**
 * Stages whole records against authenticated current state without modifying their bytes.
 * No stamps are invented, no malformed/mixed record is split, and no source is retired.
 *
 * @param confirmed - The fresh authenticated board snapshot.
 * @param records - Original retained records in persistence order.
 * @returns A safe candidate and the records that remain unresolved.
 */
export function buildRecoveryCandidate(
  confirmed: Uint8Array,
  records: readonly Uint8Array[],
): RecoveryCandidate {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, confirmed);
    const check = new UpdateStampCheck(doc);
    const updates: Uint8Array[] = [];
    let unresolved = [...records];
    let snapshot = confirmed;
    let passes = 0;
    while (passes++ < records.length) {
      const remaining: Uint8Array[] = [];
      for (const record of unresolved) {
        const verdict = check.check(record);
        const isSafe =
          verdict.kind === 'accepted' &&
          verdict.hostileValue === undefined &&
          verdict.undecodable === undefined &&
          (verdict.layoutShapedWrites ?? 0) === 0;
        if (!isSafe || !integrates(snapshot, record)) {
          remaining.push(record);
          continue;
        }
        const unsent = findUnsentChanges(
          { snapshot: record, updates: [] },
          {
            encodeStateVector: () => Y.encodeStateVector(doc),
            encodeState: (vector) => Y.encodeStateAsUpdate(doc, vector),
          },
        );
        if (unsent.update === undefined) continue;
        Y.applyUpdate(doc, record);
        snapshot = Y.encodeStateAsUpdate(doc);
        updates.push(record);
      }
      if (remaining.length === unresolved.length) break;
      unresolved = remaining;
      if (remaining.length === 0) break;
    }
    return { snapshot, updates, unresolved };
  } finally {
    doc.destroy();
  }
}
