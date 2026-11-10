import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { applyCommand, mustGet, NOW } from '../commands/__fixtures__/command-fixtures.js';
import { connectCommand } from '../commands/connect.js';
import { groupCommand } from '../commands/group.js';
import { setTextRunsCommand } from '../commands/set-text-runs.js';
import { ADA, BOB, BODY } from '../store/__fixtures__/store-fixtures.js';

import {
  BOB_ENVIRONMENT,
  create,
  createClients,
  expectConvergedValidBoards,
  expectUsedUpKeeping,
  moveBy,
  NEW_FRAME,
  NEW_TEXT,
  newShape,
  ORDERS,
  refill,
  type,
} from './__fixtures__/creation-fixtures.js';
import { ADA_ID, BOB_ID, createClientPair, Link } from './__fixtures__/history-fixtures.js';
import { createHistory } from './undo-manager.js';

/**
 * A command environment whose clock reads a fixed time.
 *
 * @param time - The time, ms since the epoch.
 * @returns The environment.
 */
function environmentAt(time: number) {
  return { clock: () => time, createId: () => 'unused' as ObjectId };
}

// (protect). Undoing a creation deletes the object's map, and every
// later write inside it went with it: Ada created a shape, Bob recoloured it, Ada's undo deleted
// the shape and Bob's colour, with no notice. Now, when another client has written to the
// object, or made another object refer to it (put an object in it, attached a connector end,
// pinned a comment), since the step, undoing the creation changes nothing: the step is used up
// (`undo()` returns false, which the app turns into its notice) and nothing goes to redo.

describe.each(ORDERS)('undoing a creation ($name)', ({ adaClientId, bobClientId }) => {
  it('still deletes an object nobody else touched', () => {
    const clients = createClients(adaClientId, bobClientId);
    const { ada, bob, link, history } = clients;
    const shape = create(ada, newShape('shape-new'));
    link.deliver();
    refill(bob, 'shape-box', [0, 0, 1, 1]);
    link.deliver();

    expect(history.undo()).toBe(true);
    link.deliver();
    expect(ada.get(shape)).toBeUndefined();
    expect(bob.get(shape)).toBeUndefined();
    expect(history.canRedo()).toBe(true);
    expectConvergedValidBoards(ada, bob);
  });

  it('keeps a shape another client recoloured since', () => {
    const clients = createClients(adaClientId, bobClientId);
    const shape = create(clients.ada, newShape('shape-new'));
    clients.link.deliver();
    refill(clients.bob, shape, [0, 0, 1, 1]);
    clients.link.deliver();

    expectUsedUpKeeping(clients, shape);
    expect(mustGet(clients.ada, shape)).toMatchObject({ fill: [0, 0, 1, 1] });
  });

  it('keeps a shape another client moved since', () => {
    const clients = createClients(adaClientId, bobClientId);
    const shape = create(clients.ada, newShape('shape-new'));
    clients.link.deliver();
    moveBy(clients.bob, shape, 25);
    clients.link.deliver();

    expectUsedUpKeeping(clients, shape);
    expect(mustGet(clients.ada, shape)).toMatchObject({ x: 65 });
  });

  it('keeps a text object another client typed into since', () => {
    const clients = createClients(adaClientId, bobClientId);
    const text = create(clients.ada, NEW_TEXT);
    clients.link.deliver();
    type(clients.bob, text, 'Ada and Bob');
    clients.link.deliver();

    expectUsedUpKeeping(clients, text);
    expect(mustGet(clients.ada, text)).toMatchObject({ text: 'Ada and Bob' });
  });

  it('keeps a shape whose label another client typed since', () => {
    const clients = createClients(adaClientId, bobClientId);
    const shape = create(clients.ada, newShape('shape-new'));
    clients.link.deliver();
    type(clients.bob, shape, 'Bob');
    clients.link.deliver();

    expectUsedUpKeeping(clients, shape);
    expect(mustGet(clients.ada, shape)).toMatchObject({ label: { text: 'Bob' } });
  });

  it('keeps a frame another client put an object into since', () => {
    const clients = createClients(adaClientId, bobClientId);
    const frame = create(clients.ada, NEW_FRAME);
    clients.link.deliver();
    moveBy(clients.bob, 'image-photo', 1_200, frame);
    clients.link.deliver();

    expectUsedUpKeeping(clients, frame);
    expect(mustGet(clients.ada, 'image-photo').parentId).toBe(frame);
  });

  // The group command creates the group and moves its members into it in one step: keeping the
  // group while undoing the rest would empty it, so the whole step is used up.
  it('keeps a group, members and all, another client added a member to since', () => {
    const clients = createClients(adaClientId, bobClientId);
    const { ada, bob, link } = clients;
    const input = { ids: ['image-photo', 'line-divider'], groupId: 'group-new' };
    const group = applyCommand(ada, groupCommand, input).result.groupId;
    link.deliver();
    const member = create(bob, newShape('shape-bob', group), BOB);
    link.deliver();
    const photo = mustGet(ada, 'image-photo');

    expectUsedUpKeeping(clients, group);
    expect(mustGet(ada, 'image-photo')).toEqual(photo);
    expect(mustGet(ada, 'line-divider').parentId).toBe(group);
    expect(mustGet(ada, member).parentId).toBe(group);
  });

  it('keeps a shape another client attached a connector end to since', () => {
    const clients = createClients(adaClientId, bobClientId);
    const shape = create(clients.ada, newShape('shape-new'));
    clients.link.deliver();
    const input = { from: { objectId: shape }, to: { point: { x: 0, y: 0 } } };
    const connector = applyCommand(clients.bob, connectCommand, input, BOB, BOB_ENVIRONMENT);
    clients.link.deliver();

    expectUsedUpKeeping(clients, shape);
    expect(mustGet(clients.ada, connector.result.id)).toMatchObject({
      from: { kind: 'object', objectId: shape },
    });
  });

  // The same person in another tab is another client: their edit is not this history's.
  it('keeps a shape the same user recoloured in another tab since', () => {
    const clients = createClients(adaClientId, bobClientId);
    const shape = create(clients.ada, newShape('shape-new'));
    clients.link.deliver();
    refill(clients.bob, shape, [0, 1, 0, 1], ADA);
    clients.link.deliver();

    expectUsedUpKeeping(clients, shape);
    expect(mustGet(clients.ada, shape)).toMatchObject({ fill: [0, 1, 0, 1] });
  });

  it('does not bring the used-up step back when the other client undoes its change', () => {
    const clients = createClients(adaClientId, bobClientId);
    const { ada, bob, link, history } = clients;
    const bobHistory = createHistory(bob, BOB_ID);
    const shape = create(ada, newShape('shape-new'));
    link.deliver();
    refill(bob, shape, [0, 0, 1, 1]);
    link.deliver();
    expect(history.undo()).toBe(false);
    link.deliver();

    expect(bobHistory.undo()).toBe(true);
    link.deliver();
    expect(history.canUndo()).toBe(false);
    expect(history.undo()).toBe(false);
    expect(mustGet(ada, shape)).toMatchObject({ fill: [1, 0, 0, 1] });
    expectConvergedValidBoards(ada, bob);
  });

  // Review M2: Ada overwrites Bob's colour inside the same step (a capture window), so Bob's
  // value is no longer visible when she undoes; it is still his write to the shape since the
  // step, so the shape stays. The undo reverts Ada's own recolour, which brings Bob's back.
  it('keeps a shape whose other-client colour Ada overwrote within the same step', () => {
    const [ada, bob] = createClientPair(adaClientId, bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID, { captureTimeout: 60_000 });
    const shape = create(ada, newShape('shape-new'));
    link.deliver();
    refill(bob, shape, [0, 0, 1, 1]);
    link.deliver();
    refill(ada, shape, [0, 1, 0, 1], ADA);
    link.deliver();

    expect(history.undo()).toBe(true);
    link.deliver();
    expect(mustGet(ada, shape)).toMatchObject({ fill: [0, 0, 1, 1] });
    expect(history.canUndo()).toBe(false);
    expectConvergedValidBoards(ada, bob);
  });
  // Found by the property test (fix round 1): undoing Ada's label set deleted the label Bob had
  // typed into since, and his typing with it. The label is kept, with his text.
  it('keeps a label another client typed into when undoing its set', () => {
    const clients = createClients(adaClientId, bobClientId);
    const { ada, bob, link, history } = clients;
    const shape = create(ada, newShape('shape-new'));
    const label = { id: shape, text: 'Ada', runs: [{ length: 3, style: BODY }] };
    applyCommand(ada, setTextRunsCommand, label, ADA, environmentAt(NOW + 500));
    link.deliver();
    type(bob, shape, 'Ada and Bob');
    link.deliver();

    expect(history.undo()).toBe(false);
    link.deliver();
    expect(mustGet(ada, shape)).toMatchObject({ label: { text: 'Ada and Bob' } });
    expectConvergedValidBoards(ada, bob);
  });
});
