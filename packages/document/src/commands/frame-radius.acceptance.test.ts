// Radius is part of the frame's whole style group, through commands and history.
import { describe, expect, it } from 'vitest';

import { BOARD_BOUND, type FrameObject, type Rgba } from '@canvas/schema';

import { ADA_ID, createClientPair, Link } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { ORDERS } from '../repair/__fixtures__/repair-fixtures.js';
import { BOB, createFixtureStore, id } from '../store/__fixtures__/store-fixtures.js';

import { applyCommand, expectRejected } from './__fixtures__/command-fixtures.js';
import { createObjectsCommand } from './create-objects.js';
import { setStyleCommand } from './set-style.js';

const FRAME = id('frame-plan');

describe.each(ORDERS)('frame radius style ($name)', (order) => {
  it('sets, changes, removes, undoes and redoes a radius', () => {
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    applyCommand(ada, setStyleCommand, { changes: [{ id: FRAME, style: { cornerRadius: 12 } }] });
    link.deliver();
    expect(bob.get(FRAME)).toMatchObject({ cornerRadius: 12 });
    applyCommand(ada, setStyleCommand, {
      changes: [{ id: FRAME, style: { cornerRadius: [1, 2, 3, 4] } }],
    });
    link.deliver();
    expect(bob.get(FRAME)).toMatchObject({ cornerRadius: [1, 2, 3, 4] });
    expect(history.undo()).toBe(true);
    link.deliver();
    expect(bob.get(FRAME)).toMatchObject({ cornerRadius: 12 });
    expect(history.redo()).toBe(true);
    link.deliver();
    expect(bob.get(FRAME)).toMatchObject({ cornerRadius: [1, 2, 3, 4] });
    applyCommand(ada, setStyleCommand, {
      changes: [{ id: FRAME, style: { cornerRadius: undefined } }],
    });
    link.deliver();
    expect((bob.get(FRAME) as FrameObject).cornerRadius).toBeUndefined();
  });

  it('converges on one whole style against a concurrent background change', () => {
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const original = (ada.get(FRAME) as FrameObject).background;
    applyCommand(ada, setStyleCommand, { changes: [{ id: FRAME, style: { cornerRadius: 18 } }] });
    const green: Rgba = [0, 1, 0, 1];
    applyCommand(
      bob,
      setStyleCommand,
      { changes: [{ id: FRAME, style: { background: green } }] },
      BOB,
    );
    link.deliver();
    const merged = ada.get(FRAME) as FrameObject;
    expect(merged).toEqual(bob.get(FRAME));
    expect([
      { background: original, cornerRadius: 18 },
      { background: green, cornerRadius: undefined },
    ]).toContainEqual({ background: merged.background, cornerRadius: merged.cornerRadius });
  });
});

describe('frame radius commands', () => {
  it('refuses an over-limit radius at the command door for both forms', () => {
    const store = createFixtureStore();
    for (const cornerRadius of [BOARD_BOUND + 1, [0, BOARD_BOUND + 1, 0, 0]]) {
      const errors = expectRejected(store, setStyleCommand, {
        changes: [{ id: FRAME, style: { cornerRadius } }],
      });
      expect(
        errors.some(({ path }) =>
          path.join('.').endsWith(Array.isArray(cornerRadius) ? 'cornerRadius.1' : 'cornerRadius'),
        ),
      ).toBe(true);
    }
    store.destroy();
  });

  it('accepts a rounded frame through createObjects and preserves radius on unrelated writes', () => {
    const store = createFixtureStore();
    const { result } = applyCommand(store, createObjectsCommand, {
      objects: [
        {
          type: 'frame',
          id: 'rounded-copy',
          x: 200,
          y: 100,
          width: 100,
          height: 80,
          name: 'Rounded',
          clip: true,
          background: [1, 1, 1, 1],
          cornerRadius: [2, 4, 6, 8],
        },
      ],
    });
    const created = result.ids[0];
    if (created === undefined) throw new Error('createObjects returned no id');
    expect(store.get(created)).toMatchObject({ cornerRadius: [2, 4, 6, 8] });
    applyCommand(store, setStyleCommand, {
      changes: [{ id: created, style: { background: [1, 0, 0, 1] } }],
    });
    expect(store.get(created)).toMatchObject({ cornerRadius: [2, 4, 6, 8] });
    store.destroy();
  });
});
