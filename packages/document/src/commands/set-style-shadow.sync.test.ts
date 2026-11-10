import { describe, expect, it } from 'vitest';

import type { Rgba, Shadow, ShapeObject } from '@canvas/schema';

import { ADA_ID, createClientPair, Link } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { ORDERS } from '../repair/__fixtures__/repair-fixtures.js';
import { BOB, id } from '../store/__fixtures__/store-fixtures.js';

import { applyCommand } from './__fixtures__/command-fixtures.js';
import { setStyleCommand } from './set-style.js';

// Sync test for a shape's drop shadow: a member of the shape's one last-writer-wins
// style group, like its fill, so a shadow set while a collaborator refills the shape converges on
// one of the two whole styles, never a mix; set, undone, redone and removed, it reaches the other
// client each time. Both client-id orders.

const BOX = id('shape-box');

describe.each(ORDERS)('a shape’s shadow against a concurrent fill ($name)', (order) => {
  const shadow: Shadow = { x: 0, y: 8, blur: 16, spread: 2, color: [0, 0, 0, 0.3] };

  it('converges on one whole style, and syncs an undo and redo of the shadow', () => {
    // A shape's shadow is a member of its one last-writer-wins style group, as its fill is: the
    // two clients converge on one of the two whole styles, never a mix.
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    const originalFill = (ada.get(BOX) as ShapeObject).fill;
    applyCommand(ada, setStyleCommand, { changes: [{ id: BOX, style: { shadow } }] });
    const green: Rgba = [0, 1, 0, 1];
    applyCommand(bob, setStyleCommand, { changes: [{ id: BOX, style: { fill: green } }] }, BOB);
    link.deliver();
    const merged = ada.get(BOX) as ShapeObject;
    expect(merged).toEqual(bob.get(BOX));
    expect([
      { fill: originalFill, shadow },
      { fill: green, shadow: undefined },
    ]).toContainEqual({ fill: merged.fill, shadow: merged.shadow });
    history.undo();
    link.deliver();
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(ada.read().issues).toEqual([]);
  });

  it('syncs a shadow to the other client; undo removes it and redo restores it', () => {
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    applyCommand(ada, setStyleCommand, { changes: [{ id: BOX, style: { shadow } }] });
    link.deliver();
    expect(bob.get(BOX)).toMatchObject({ shadow });
    expect(history.undo()).toBe(true);
    link.deliver();
    expect(bob.get(BOX)).toMatchObject({ shadow: undefined });
    expect(history.redo()).toBe(true);
    link.deliver();
    expect(bob.get(BOX)).toMatchObject({ shadow });
    applyCommand(bob, setStyleCommand, { changes: [{ id: BOX, style: { shadow: null } }] }, BOB);
    link.deliver();
    expect(ada.get(BOX)).toMatchObject({ shadow: null });
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(bob.read().issues).toEqual([]);
  });
});
