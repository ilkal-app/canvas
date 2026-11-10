import { describe, expect, it } from 'vitest';

import {
  applyCommand,
  mustGet,
  NOW,
  testEnvironment,
} from '../commands/__fixtures__/command-fixtures.js';
import { connectCommand } from '../commands/connect.js';
import { groupCommand } from '../commands/group.js';
import { setStyleCommand } from '../commands/set-style.js';
import { setTextRunsCommand } from '../commands/set-text-runs.js';
import { ADA, BOB, BODY } from '../store/__fixtures__/store-fixtures.js';

import {
  BOB_ENVIRONMENT,
  create,
  createClients,
  expectConvergedValidBoards,
  newShape,
  ORDERS,
  refill,
  remove,
  type,
  type Clients,
} from './__fixtures__/creation-fixtures.js';
import {
  deleteMember,
  memberValues,
  writeMember,
} from './__fixtures__/member-property-fixtures.js';
import { PATH_ID } from './__fixtures__/network-member-fixtures.js';

// Fix round 1 (C1). When Ada deletes an object and undoes the delete, Yjs re-creates the
// object's map and every value in it, the other client's included, as new items of Ada's
// client. Undoing the creation after that must still see the other client's writes: they stay
// readable in the original map, which the undo manager keeps alive.

/** What Bob does to Ada's new shape, each a write the guard must see through a re-creation. */
const EDITS = [
  {
    name: 'recolours it',
    edit: (clients: Clients, shapeId: string) => {
      refill(clients.bob, shapeId, [0, 0, 1, 1]);
    },
  },
  {
    name: 'types its label',
    edit: (clients: Clients, shapeId: string) => {
      type(clients.bob, shapeId, 'Bob');
    },
  },
  {
    name: 'attaches a connector to it',
    edit: (clients: Clients, shapeId: string) => {
      const input = { from: { objectId: shapeId }, to: { point: { x: 0, y: 0 } } };
      applyCommand(clients.bob, connectCommand, input, BOB, BOB_ENVIRONMENT);
    },
  },
] as const;

/**
 * Checks Ada's next undo is used up and leaves the shape on both boards.
 *
 * @param clients - The clients.
 * @param shapeId - Ada's shape.
 */
function expectCreationKept(clients: Clients, shapeId: string): void {
  const { ada, bob, link, history } = clients;
  const before = mustGet(ada, shapeId);
  expect(history.undo()).toBe(false);
  link.deliver();
  expect(mustGet(ada, shapeId)).toEqual(before);
  expect(mustGet(bob, shapeId)).toEqual(before);
  expectConvergedValidBoards(ada, bob);
}

describe.each(ORDERS)('undoing a creation after a delete was undone ($name)', (order) => {
  describe.each(EDITS)('when Bob $name', ({ edit }) => {
    it('keeps the shape: delete, undo, undo', () => {
      const clients = createClients(order.adaClientId, order.bobClientId);
      const shape = create(clients.ada, newShape('shape-new'));
      clients.link.deliver();
      edit(clients, shape);
      clients.link.deliver();
      remove(clients.ada, [shape]);
      clients.link.deliver();
      expect(clients.history.undo()).toBe(true);
      clients.link.deliver();

      expectCreationKept(clients, shape);
    });

    it('keeps the shape: delete, undo, redo, undo, undo', () => {
      const clients = createClients(order.adaClientId, order.bobClientId);
      const shape = create(clients.ada, newShape('shape-new'));
      clients.link.deliver();
      edit(clients, shape);
      clients.link.deliver();
      remove(clients.ada, [shape]);
      clients.link.deliver();
      expect(clients.history.undo()).toBe(true);
      expect(clients.history.redo()).toBe(true);
      expect(clients.history.undo()).toBe(true);
      clients.link.deliver();

      expectCreationKept(clients, shape);
    });
  });
  // An edit racing the delete lands in the deleted map; a connector attached meanwhile is
  // detached by the reference repair, which removes the reference, so it is not raced here.
  it.each(EDITS.slice(0, 2))('keeps the shape when Bob $name while Ada deletes it', ({ edit }) => {
    const clients = createClients(order.adaClientId, order.bobClientId);
    const shape = create(clients.ada, newShape('shape-new'));
    clients.link.deliver();
    clients.link.disconnect();
    remove(clients.ada, [shape]);
    edit(clients, shape);
    clients.link.reconnect();
    expect(clients.history.undo()).toBe(true);
    clients.link.deliver();

    expectCreationKept(clients, shape);
  });
});

// Fix round 2 (N1, property seed 1185): the kept-label rule read only the live label. Ada sets a
// label, Bob types into it, Ada deletes the shape and undoes the delete (the label and Bob's
// characters come back as Ada's copies), then undoes the label set: Bob's text must stay.
describe.each(ORDERS)('undoing a label set after a delete was undone ($name)', (order) => {
  it.each([
    { name: 'delete, undo, undo', isRedoneFirst: false },
    { name: 'delete, undo, redo, undo, undo', isRedoneFirst: true },
  ])('keeps the label Bob typed into: $name', ({ isRedoneFirst }) => {
    const clients = createClients(order.adaClientId, order.bobClientId);
    const { ada, bob, link, history } = clients;
    const shape = create(ada, newShape('shape-new'));
    const label = { id: shape, text: 'Ada', runs: [{ length: 3, style: BODY }] };
    applyCommand(ada, setTextRunsCommand, label, ADA, {
      ...testEnvironment(),
      clock: () => NOW + 500,
    });
    link.deliver();
    type(bob, shape, 'Ada and Bob');
    link.deliver();
    remove(ada, [shape]);
    link.deliver();
    expect(history.undo()).toBe(true);
    if (isRedoneFirst) {
      expect(history.redo()).toBe(true);
      expect(history.undo()).toBe(true);
    }
    link.deliver();

    expect(history.undo()).toBe(false);
    link.deliver();
    expect(mustGet(ada, shape)).toMatchObject({ label: { text: 'Ada and Bob' } });
    expectConvergedValidBoards(ada, bob);
  });
});

// Fix round 2, found while listing what reads only the live item: the split check (a step that
// also moved existing objects into the group it created) looked only at each member's live
// placement, which an undone delete of the members had re-created as copies. Undoing the group
// then kept the group Bob had touched and moved its members out of it.
describe.each(ORDERS)(
  'undoing a group whose members were deleted and restored ($name)',
  (order) => {
    it('keeps the group whole when Bob has touched it since', () => {
      const clients = createClients(order.adaClientId, order.bobClientId);
      const { ada, bob, link, history } = clients;
      const members = ['image-photo', 'line-divider'];
      const group = applyCommand(ada, groupCommand, { ids: members, groupId: 'group-new' }).result
        .groupId;
      link.deliver();
      remove(ada, members);
      expect(history.undo()).toBe(true);
      link.deliver();
      const style = { changes: [{ id: 'image-photo', style: { opacity: 0.3 } }] };
      applyCommand(bob, setStyleCommand, style, BOB, BOB_ENVIRONMENT);
      link.deliver();

      expect(history.undo()).toBe(false);
      link.deliver();
      for (const member of members) expect(mustGet(ada, member).parentId).toBe(group);
      expectConvergedValidBoards(ada, bob);
    });
  },
);

// Fix round 3 (review M3): Yjs writes a restore into the live map of an object an undone delete
// re-created, and checks conflicts only along the restored value's own, earlier map: a value with
// no later value there is written over whatever the live map holds. Ada deletes a vertex, deletes
// the path and undoes that; Bob adds a vertex under the same id; Ada's undo of her vertex delete
// must not write her old vertex over Bob's (`isLiveKeyWrittenByOthers`).
describe.each(ORDERS)(
  'undoing a member delete after the object was re-created ($name)',
  (order) => {
    it('keeps the member another client added under the id since', () => {
      const { ada, bob, link, history } = createClients(order.adaClientId, order.bobClientId);
      writeMember(ada, ADA, 'p0', 1, 0);
      deleteMember(ada, ADA, 'p0');
      remove(ada, [PATH_ID]);
      expect(history.undo()).toBe(true);
      link.deliver();
      writeMember(bob, BOB, 'p0', 7, 1);
      link.deliver();

      expect(history.undo()).toBe(false);
      link.deliver();
      expect(memberValues(ada)).toEqual(['p0@7,1']);
      expect(memberValues(bob)).toEqual(memberValues(ada));
      expectConvergedValidBoards(ada, bob);
    });
  },
);
