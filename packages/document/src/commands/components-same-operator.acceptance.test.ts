import { describe, expect, it } from 'vitest';

import type { PrincipalId } from '@canvas/schema';

import { parseTransactionOrigin } from '../origin/transaction-origin.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { mustGet, testEnvironment } from './__fixtures__/command-fixtures.js';
import { createChild, newFrame, newSticky } from './__fixtures__/component-boards.js';
import { createComponentCommand } from './create-component.js';
import { createObjectCommand } from './create-object.js';
import { deleteObjectsCommand } from './delete-objects.js';
import { moveObjectsCommand } from './move-objects.js';
import { runCommand } from './run-command.js';
import { setStyleCommand } from './set-style.js';

const A1 = parseTransactionOrigin({ kind: 'agent', principalId: 'agent:a1' });
const A2 = parseTransactionOrigin({ kind: 'agent', principalId: 'agent:a2' });
const PEERS = { removableUnder: new Set<PrincipalId>(['agent:a1' as PrincipalId]) };
const ENVIRONMENT = testEnvironment(461);

function board() {
  const store = new YjsDocumentStore();
  const childId = createChild(
    store,
    newFrame('a1-frame', null, { x: 0, y: 0, width: 160, height: 160 }),
    A1,
  );
  const wrapped = runCommand(
    store,
    A1,
    createComponentCommand,
    { ids: [childId], name: 'Main', componentId: 'main-a1' },
    ENVIRONMENT,
  );
  expect(wrapped.status).toBe('applied');
  const descendantId = createChild(
    store,
    newSticky('grandchild', childId, { x: 10, y: 10, width: 50, height: 50 }),
    A1,
  );
  const outsideId = createChild(
    store,
    newSticky('outside', null, { x: 500, y: 0, width: 100, height: 100 }),
    A2,
  );
  return { store, mainId: 'main-a1', childId, descendantId, outsideId };
}

describe('same-operator removal inside another agent’s main', () => {
  it('keeps other writes refused and permits only child removal with removableUnder', () => {
    const { store, mainId, childId, descendantId, outsideId } = board();
    const main = mustGet(store, mainId);
    const without = runCommand(store, A2, deleteObjectsCommand, { ids: [childId] }, ENVIRONMENT);
    expect(without).toMatchObject({ status: 'rejected', errors: [{ code: 'not-own-main' }] });
    const wrongPeer = runCommand(store, A2, deleteObjectsCommand, { ids: [childId] }, ENVIRONMENT, {
      removableUnder: new Set<PrincipalId>(['agent:b1' as PrincipalId]),
    });
    expect(wrongPeer).toMatchObject({ status: 'rejected', errors: [{ code: 'not-own-main' }] });
    const retirement = runCommand(
      store,
      A2,
      deleteObjectsCommand,
      { ids: [mainId] },
      ENVIRONMENT,
      PEERS,
    );
    expect(retirement).toMatchObject({ status: 'rejected', errors: [{ code: 'not-own-main' }] });
    expect(mustGet(store, mainId)).toMatchObject({ retired: false });
    const forbidden = [
      () =>
        runCommand(
          store,
          A2,
          moveObjectsCommand,
          { moves: [{ id: childId, by: { x: 5, y: 0 } }] },
          ENVIRONMENT,
          PEERS,
        ),
      () =>
        runCommand(
          store,
          A2,
          setStyleCommand,
          { changes: [{ id: descendantId, style: { color: [0, 1, 0, 1] } }] },
          ENVIRONMENT,
          PEERS,
        ),
      () =>
        runCommand(
          store,
          A2,
          moveObjectsCommand,
          { moves: [{ id: outsideId, to: { x: 10, y: 10 }, parentId: mainId }] },
          ENVIRONMENT,
          PEERS,
        ),
      () =>
        runCommand(
          store,
          A2,
          createObjectCommand,
          { object: newSticky('new-child', mainId, { x: 10, y: 10, width: 50, height: 50 }) },
          ENVIRONMENT,
          PEERS,
        ),
    ];
    for (const runForbidden of forbidden) {
      expect(runForbidden()).toMatchObject({
        status: 'rejected',
        errors: [{ code: 'not-own-main' }],
      });
    }
    const removal = runCommand(
      store,
      A2,
      deleteObjectsCommand,
      { ids: [childId] },
      ENVIRONMENT,
      PEERS,
    );
    expect(removal).toMatchObject({ status: 'applied' });
    expect(store.get(childId)).toBeUndefined();
    expect(store.get(descendantId)).toBeUndefined();
    expect(mustGet(store, mainId)).toBe(main);
  });
});
