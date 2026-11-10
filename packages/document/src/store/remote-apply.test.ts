import { describe, expect, it } from 'vitest';

import { ADA, fixtureObject, id, RELAY } from './__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from './yjs-document-store.js';

/**
 * A sticky whose parent is missing, which the store's reference repair moves to the root.
 *
 * @returns The update.
 */
function orphanUpdate(): Uint8Array {
  const source = new YjsDocumentStore();
  source.transact(ADA, (transaction) => {
    transaction.setObject({ ...fixtureObject('sticky-idea', 'sticky'), parentId: id('gone') });
  });
  const bytes = source.encodeState();
  source.destroy();
  return bytes;
}

describe('applyUpdateInSteps', () => {
  it('repairs an applied update before rejecting with a failed second yield', async () => {
    const store = new YjsDocumentStore();
    const failure = new Error('yield failed');
    let calls = 0;
    const yieldToBrowser = (): Promise<void> => {
      calls += 1;
      return calls === 2 ? Promise.reject(failure) : Promise.resolve();
    };
    await expect(store.applyUpdateInSteps(orphanUpdate(), RELAY, { yieldToBrowser })).rejects.toBe(
      failure,
    );
    expect(store.get(id('sticky-idea'))?.parentId).toBeNull();
    store.transact(ADA, (transaction) => {
      transaction.deleteObject(id('sticky-idea'));
    });
    store.destroy();
  });

  it('changes nothing when the first yield rejects, and is writable again', async () => {
    const store = new YjsDocumentStore();
    const failure = new Error('yield failed');
    await expect(
      store.applyUpdateInSteps(orphanUpdate(), RELAY, {
        yieldToBrowser: () => Promise.reject(failure),
      }),
    ).rejects.toBe(failure);
    expect(store.read().objects.size).toBe(0);
    store.applyUpdate(orphanUpdate(), RELAY);
    expect(store.read().objects.size).toBe(1);
    store.destroy();
  });
});
