import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { poisonedHistory } from '../client/__fixtures__/poisoned-device.js';

import { ADA, sticky } from './__fixtures__/sticky-board.js';
import { buildRecoveryCandidate } from './cache-recovery-candidate.js';

describe('whole-record poisoned-cache recovery', () => {
  it('retains a deletion until its missing target clocks are known', () => {
    const doc = new Y.Doc();
    doc.getText('text').insert(0, 'missing');
    const vector = Y.encodeStateVector(doc);
    doc.getText('text').delete(0, 7);
    const deletion = Y.encodeStateAsUpdate(doc, vector);
    const result = buildRecoveryCandidate(new Uint8Array([0, 0]), [deletion]);
    expect(result.updates).toEqual([]);
    expect(result.unresolved).toEqual([deletion]);
    doc.destroy();
  });

  it('recovers independently stamped edits and deletions without releasing the ghost', () => {
    const peer = new YjsDocumentStore();
    peer.transact(ADA, (tx) => {
      tx.setObject(sticky('shared'));
    });
    const confirmed = peer.encodeState();
    const local = new YjsDocumentStore();
    local.applyUpdate(confirmed, SYSTEM_ORIGIN);
    const records: Uint8Array[] = [];
    local.subscribeUpdates(({ update }) => records.push(update));
    local.transact(ADA, (tx) => {
      tx.setObject(sticky('offline'));
    });
    local.transact(ADA, (tx) => tx.deleteObject('shared' as ObjectId));
    const poison = poisonedHistory();
    const candidate = buildRecoveryCandidate(confirmed, [
      poison.fragment,
      ...records,
      poison.filler,
    ]);
    const clean = new YjsDocumentStore();
    clean.applyUpdate(candidate.snapshot, SYSTEM_ORIGIN);
    expect([...clean.read().objects.keys()]).toEqual(['offline']);
    expect(candidate.unresolved).toEqual([poison.fragment]);
    expect(clean.hasPendingStructs).toBe(false);
    clean.destroy();
    local.destroy();
    peer.destroy();
  });

  it('retains indivisible mixed records and malformed bytes unchanged', () => {
    const local = new YjsDocumentStore();
    local.transact(ADA, (tx) => {
      tx.setObject(sticky('honest'));
    });
    const poison = poisonedHistory();
    const mixed = Y.mergeUpdates([local.encodeState(), poison.fragment, poison.filler]);
    const malformed = new Uint8Array([255]);
    const result = buildRecoveryCandidate(new Uint8Array([0, 0]), [mixed, malformed]);
    expect(result.unresolved).toEqual([mixed, malformed]);
    expect(result.updates).toEqual([]);
    local.destroy();
  });

  it('retries dependency-ordered whole records without rewriting their original bytes', () => {
    const local = new YjsDocumentStore();
    const records: Uint8Array[] = [];
    local.subscribeUpdates(({ update }) => records.push(update));
    local.transact(ADA, (tx) => {
      tx.setObject(sticky('first'));
    });
    local.transact(ADA, (tx) => {
      tx.setObject(sticky('second'));
    });
    const result = buildRecoveryCandidate(new Uint8Array([0, 0]), [...records].reverse());
    expect(result.updates).toEqual(records);
    expect(result.unresolved).toEqual([]);
    local.destroy();
  });
});
