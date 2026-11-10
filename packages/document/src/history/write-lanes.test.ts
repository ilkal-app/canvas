import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { keyedLanesOf, recordLane, WriteLanes, writeLanesOf } from './write-lanes.js';

/**
 * Lanes that record from the start, as a document with a keyed history does.
 *
 * @returns The lanes.
 */
function keyed(): WriteLanes {
  const lanes = new WriteLanes();
  lanes.noteHistory('agent-a');
  return lanes;
}

describe('WriteLanes', () => {
  it('records nothing until a keyed history is noted', () => {
    const lanes = new WriteLanes();
    lanes.noteHistory(undefined);
    lanes.record(1, 0, 5, 'agent-a');
    expect(lanes.isKeyed).toBe(false);
    expect(lanes.size).toBe(0);
    expect(lanes.hasOtherLane(1, 0, 5, 'agent-b')).toBe(false);
    lanes.noteHistory('agent-a');
    lanes.record(1, 5, 9, 'agent-a');
    expect(lanes.isKeyed).toBe(true);
    expect(lanes.hasOtherLane(1, 5, 9, 'agent-b')).toBe(true);
  });

  it('merges adjacent ranges of one lane, and only those', () => {
    const lanes = keyed();
    lanes.record(1, 0, 3, 'agent-a');
    lanes.record(1, 3, 7, 'agent-a');
    expect(lanes.size).toBe(1);
    lanes.record(1, 7, 8, undefined);
    lanes.record(1, 8, 9, 'agent-a');
    expect(lanes.size).toBe(3);
    // A gap (a write no history captured) is not bridged.
    lanes.record(1, 12, 14, 'agent-a');
    expect(lanes.size).toBe(4);
    // Empty ranges record nothing.
    lanes.record(1, 20, 20, 'agent-b');
    expect(lanes.size).toBe(4);
  });

  it('looks up the lanes a clock range overlaps', () => {
    const lanes = keyed();
    lanes.record(1, 0, 4, 'agent-a');
    lanes.record(1, 4, 6, 'agent-b');
    lanes.record(1, 6, 10, undefined);
    lanes.record(1, 15, 20, 'agent-a');
    expect(lanes.hasOtherLane(1, 0, 4, 'agent-a')).toBe(false);
    expect(lanes.hasOtherLane(1, 3, 5, 'agent-a')).toBe(true);
    expect(lanes.hasOtherLane(1, 4, 6, 'agent-b')).toBe(false);
    expect(lanes.hasOtherLane(1, 6, 10, undefined)).toBe(false);
    expect(lanes.hasOtherLane(1, 6, 10, 'agent-a')).toBe(true);
    // Unrecorded clocks are in no lane: neutral.
    expect(lanes.hasOtherLane(1, 10, 15, 'agent-b')).toBe(false);
    expect(lanes.hasOtherLane(1, 12, 16, 'agent-b')).toBe(true);
    expect(lanes.hasOtherLane(1, 20, 30, 'agent-b')).toBe(false);
    // Another client id has no ranges.
    expect(lanes.hasOtherLane(2, 0, 20, 'agent-b')).toBe(false);
  });

  it('keeps ranges sorted when one arrives out of order', () => {
    const lanes = keyed();
    lanes.record(1, 10, 12, 'agent-a');
    lanes.record(1, 0, 2, 'agent-b');
    lanes.record(1, 5, 7, 'agent-a');
    expect(lanes.hasOtherLane(1, 0, 2, 'agent-b')).toBe(false);
    expect(lanes.hasOtherLane(1, 1, 6, 'agent-a')).toBe(true);
    expect(lanes.hasOtherLane(1, 5, 12, 'agent-a')).toBe(false);
  });

  it('keeps one table per document, and reports it once keyed', () => {
    const doc = new Y.Doc();
    expect(keyedLanesOf(doc)).toBeUndefined();
    const lanes = writeLanesOf(doc);
    expect(writeLanesOf(doc)).toBe(lanes);
    expect(keyedLanesOf(doc)).toBeUndefined();
    lanes.noteHistory('agent-a');
    expect(keyedLanesOf(doc)).toBe(lanes);
    expect(keyedLanesOf(new Y.Doc())).toBeUndefined();
  });

  it("records a transaction's range on the document's client id", () => {
    const doc = new Y.Doc();
    doc.clientID = 7;
    doc.on('afterTransaction', (transaction: Y.Transaction) => {
      recordLane(transaction, 'agent-a');
    });
    const map = doc.getMap('objects');
    // Not keyed yet: ignored.
    doc.transact(() => map.set('a', 1));
    writeLanesOf(doc).noteHistory('agent-a');
    doc.transact(() => map.set('b', 2));
    const lanes = writeLanesOf(doc);
    expect(lanes.size).toBe(1);
    expect(lanes.hasOtherLane(7, 0, 1, 'agent-b')).toBe(false);
    expect(lanes.hasOtherLane(7, 1, 2, 'agent-b')).toBe(true);
  });
});
