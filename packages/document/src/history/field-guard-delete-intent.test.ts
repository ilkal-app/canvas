// This is a protocol limitation proof, not the acceptance test for the fix. Once a
// conflicting value loses a Y.Map merge, its deleted bit cannot say who wanted it removed.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

/**
 * Builds the two histories the field guard would need to distinguish, without canvas repair
 * or undo code: Ada recreates her addition while Bob moves it, optionally then deleting it.
 *
 * @param didBobDelete - Whether Bob explicitly removes his moved vertex before synchronizing.
 * @param shouldCollect - Whether Yjs collects deleted content.
 * @returns The complete merged document bytes, including the delete set.
 */
function mergedHistory(didBobDelete: boolean, shouldCollect: boolean): Uint8Array {
  const ada = new Y.Doc({ gc: shouldCollect });
  const bob = new Y.Doc({ gc: shouldCollect });
  ada.clientID = 2;
  bob.clientID = 1;
  const adaVertices = ada.getMap('vertices');
  const bobVertices = bob.getMap('vertices');
  adaVertices.set('v4', { x: 300 });
  Y.applyUpdate(bob, Y.encodeStateAsUpdate(ada));
  adaVertices.delete('v4');
  adaVertices.set('v4', { x: 300 });
  bobVertices.set('v4', { x: 310 });
  if (didBobDelete) bobVertices.delete('v4');
  // The two runs really differ before synchronization: Bob either keeps or removes his work.
  expect(bobVertices.has('v4')).toBe(!didBobDelete);
  Y.applyUpdate(ada, Y.encodeStateAsUpdate(bob));
  Y.applyUpdate(bob, Y.encodeStateAsUpdate(ada));
  expect(adaVertices.get('v4')).toEqual({ x: 300 });
  expect(bobVertices.get('v4')).toEqual({ x: 300 });
  const update = Y.encodeStateAsUpdate(ada);
  ada.destroy();
  bob.destroy();
  return update;
}

describe('map history does not preserve explicit deletion intent', () => {
  it.each([false, true])(
    'has identical merged bytes with garbage collection %s',
    (shouldCollect) => {
      expect(mergedHistory(true, shouldCollect)).toEqual(mergedHistory(false, shouldCollect));
    },
  );
});
