import { expect, it } from 'vitest';
import * as Y from 'yjs';

import { hasReleasedClocks } from './released-clocks.js';

it('distinguishes supplied incremental clocks, repeated updates, and retained skip ranges', () => {
  const writer = new Y.Doc();
  const vectors = [Y.encodeStateVector(writer)];
  const updates: Uint8Array[] = [];
  for (const character of ['a', 'b', 'c']) {
    writer.getText('note').insert(writer.getText('note').length, character);
    updates.push(Y.encodeStateAsUpdate(writer, vectors.at(-1)));
    vectors.push(Y.encodeStateVector(writer));
  }
  const [a, b, c] = updates as [Uint8Array, Uint8Array, Uint8Array];
  const [empty, first, second, third] = vectors as [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
  expect(hasReleasedClocks(first, second, b)).toBe(false);
  expect(hasReleasedClocks(second, second, a)).toBe(false);
  expect(hasReleasedClocks(empty, third, Y.mergeUpdates([a, b, c]))).toBe(false);
  expect(hasReleasedClocks(empty, third, Y.mergeUpdates([a, c]))).toBe(true);
  expect(hasReleasedClocks(empty, third, a)).toBe(true);
  const peer = new Y.Doc();
  peer.getText('other').insert(0, 'peer');
  expect(hasReleasedClocks(empty, third, Y.encodeStateAsUpdate(peer))).toBe(true);
  expect(hasReleasedClocks(empty, empty, Y.encodeStateAsUpdate(peer))).toBe(false);
  writer.destroy();
  peer.destroy();
});

it('covers multiple distinct ranges per client and multiple supplied clients', () => {
  const first = new Y.Doc();
  const second = new Y.Doc();
  const empty = Y.encodeStateVector(first);
  first.getMap('values').set('first', 1);
  first.getMap('values').set('second', 2);
  second.getMap('values').set('third', 3);
  const update = Y.mergeUpdates([Y.encodeStateAsUpdate(first), Y.encodeStateAsUpdate(second)]);
  expect(Y.decodeUpdate(update).structs).toHaveLength(3);
  const integrated = new Y.Doc();
  Y.applyUpdate(integrated, update);
  expect(hasReleasedClocks(empty, Y.encodeStateVector(integrated), update)).toBe(false);
  for (const doc of [first, second, integrated]) doc.destroy();
});
