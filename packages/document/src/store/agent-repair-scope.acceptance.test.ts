// Acceptance: the store-level half of the relay case in
// tooling/e2e-sync/src/sync/components-agent-repair-relay.acceptance.test.ts. An agent's store
// (`agent-write`) never writes a repair to a main's content, whose stored ancestry the relay
// would refuse it for; it shows the repair, as every client does, and leaves the write to a
// person's client. The same orphan outside any main it repairs and writes as before.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { createChild, newFrame, newSticky } from '../commands/__fixtures__/component-boards.js';
import { mustFindCommand } from '../commands/__fixtures__/component-fixtures.js';
import { deleteObjectsCommand } from '../commands/delete-objects.js';
import { BOB_ENVIRONMENT } from '../repair/__fixtures__/repair-fixtures.js';

import { BOB, RELAY } from './__fixtures__/store-fixtures.js';
import type { DocumentUpdate } from './document-store.js';
import { YjsDocumentStore } from './yjs-document-store.js';

/**
 * Ada's frame `home` and sticky `other`, wrapped in her main `main` when `isInMain`; Bob and an
 * agent's store hold the same state. Then, concurrently, Ada deletes `home` while Bob adds
 * `bobs-note` into it, and the agent's store receives both.
 *
 * @param isInMain - Whether `home` lies inside a main.
 * @returns The agent's store and the system updates it wrote itself.
 */
function orphanOnAgent(isInMain: boolean) {
  const ada = new YjsDocumentStore({ clientId: 1 });
  createChild(ada, newFrame('home', null, { x: 0, y: 0, width: 400, height: 400 }));
  createChild(ada, newSticky('other', null, { x: 600, y: 0, width: 100, height: 100 }));
  if (isInMain)
    applyCommand(ada, mustFindCommand('createComponent'), {
      ids: ['home', 'other'],
      name: 'Card',
      componentId: 'main',
    });
  const bob = new YjsDocumentStore({ clientId: 2 });
  const agent = new YjsDocumentStore({ clientId: 3 });
  bob.applyUpdate(ada.encodeState(), RELAY);
  agent.applyUpdate(ada.encodeState(), RELAY);
  // `agent-write` is the repair mode adds for agents' clients.
  (agent as unknown as { setRepairMode(mode: string): void }).setRepairMode('agent-write');
  const written: DocumentUpdate[] = [];
  agent.subscribeUpdates((update) => {
    if (update.isLocal && update.origin.kind === 'system') written.push(update);
  });

  applyCommand(ada, deleteObjectsCommand, { ids: ['home'] });
  const box = { x: 10, y: 10, width: 100, height: 100 };
  createChild(bob, newSticky('bobs-note', 'home', box), BOB, BOB_ENVIRONMENT);
  agent.applyUpdate(ada.encodeState(), RELAY);
  agent.applyUpdate(bob.encodeState(), RELAY);
  return { agent, written };
}

describe("an agent's store repairing an orphan", () => {
  it("shows the orphan re-rooted inside a person's main but writes nothing", () => {
    const { agent, written } = orphanOnAgent(true);
    expect(agent.get('bobs-note' as ObjectId)?.parentId).toBe('main');
    expect(written).toEqual([]);
  });

  it('writes the same repair when the orphan lies outside any main', () => {
    const { agent, written } = orphanOnAgent(false);
    expect(agent.get('bobs-note' as ObjectId)?.parentId).toBeNull();
    expect(written).not.toEqual([]);
  });
});
