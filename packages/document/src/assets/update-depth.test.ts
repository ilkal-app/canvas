import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { UpdateStampCheck } from '../meta/update-stamp-check.js';
import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { scanUpdate } from './update-scan.js';

/**
 * Encodes a modest nested plain value, within the encoder's ordinary recursion capacity.
 *
 * @param depth - Number of array/object containers.
 * @param isArray - Whether each container is an array instead of an object.
 * @returns A real Yjs update-v1 frame.
 */
function nestedUpdate(depth: number, isArray: boolean): Uint8Array {
  const doc = new Y.Doc();
  let value: unknown = 'leaf';
  for (let index = 0; index < depth; index += 1) value = isArray ? [value] : { child: value };
  doc.getMap('auxiliary').set('value', value);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

describe('bounded plain-value scanning before recursive decoding', () => {
  it.each([false, true])(
    'accepts 128 levels but rejects 129 before decoding (array=%s)',
    (isArray) => {
      expect(() => scanUpdate(nestedUpdate(128, isArray), new Set())).not.toThrow();
      expect(() => scanUpdate(nestedUpdate(129, isArray), new Set())).toThrow(
        'update value nesting exceeds 128',
      );
    },
  );
});

describe('bounded update admission', () => {
  it('refuses before changing a store or notifying update listeners', () => {
    const store = new YjsDocumentStore();
    const before = store.encodeState();
    const received: Uint8Array[] = [];
    store.subscribeUpdates(({ update }) => received.push(update));
    expect(() => {
      store.applyUpdate(nestedUpdate(129, false), SYSTEM_ORIGIN);
    }).toThrow('update value nesting exceeds 128');
    expect(store.encodeState()).toEqual(before);
    expect(received).toEqual([]);
    store.destroy();
  });

  it('gives relay admission a terminal depth verdict, not a retryable missing dependency', () => {
    const doc = new Y.Doc();
    expect(new UpdateStampCheck(doc).check(nestedUpdate(129, true))).toEqual({
      kind: 'update-depth-exceeded',
      writers: [],
    });
    doc.destroy();
  });
});
