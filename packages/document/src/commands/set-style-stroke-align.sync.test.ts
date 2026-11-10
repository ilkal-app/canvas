import { describe, expect, it } from 'vitest';

import type { FrameObject, Rgba, ShapeObject } from '@canvas/schema';

import { ADA_ID, createClientPair, Link } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { ORDERS } from '../repair/__fixtures__/repair-fixtures.js';
import { BOB, id } from '../store/__fixtures__/store-fixtures.js';

import { applyCommand } from './__fixtures__/command-fixtures.js';
import { setStyleCommand } from './set-style.js';

// Sync test for stroke alignment and a frame's outline: members of the object's one
// last-writer-wins style group, like its fill or background, so an outline set while a
// collaborator recolours the object converges on one of the two whole styles, never a mix; set,
// undone, redone and removed, it reaches the other client each time. Both client-id orders.

const BOX = id('shape-box');
const PLAN = id('frame-plan');

describe.each(ORDERS)('stroke alignment and a frame outline ($name)', (order) => {
  const stroke = { color: 'ink' as const, width: 2 };

  it('converge on one whole frame style against a concurrent background', () => {
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    const original = (ada.get(PLAN) as FrameObject).background;
    applyCommand(ada, setStyleCommand, {
      changes: [{ id: PLAN, style: { stroke, strokeAlign: 'outside' } }],
    });
    const green: Rgba = [0, 1, 0, 1];
    applyCommand(
      bob,
      setStyleCommand,
      { changes: [{ id: PLAN, style: { background: green } }] },
      BOB,
    );
    link.deliver();
    const merged = ada.get(PLAN) as FrameObject;
    expect(merged).toEqual(bob.get(PLAN));
    expect([
      { background: original, stroke, strokeAlign: 'outside' },
      { background: green, stroke: undefined, strokeAlign: undefined },
    ]).toContainEqual({
      background: merged.background,
      stroke: merged.stroke,
      strokeAlign: merged.strokeAlign,
    });
    history.undo();
    link.deliver();
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(ada.read().issues).toEqual([]);
  });

  it('sync a shape’s alignment and a frame’s outline; undo and redo reach the other client', () => {
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    applyCommand(ada, setStyleCommand, {
      changes: [
        { id: BOX, style: { strokeAlign: 'center' } },
        { id: PLAN, style: { stroke, strokeAlign: 'inside' } },
      ],
    });
    link.deliver();
    expect(bob.get(BOX)).toMatchObject({ strokeAlign: 'center' });
    expect(bob.get(PLAN)).toMatchObject({ stroke, strokeAlign: 'inside' });
    expect(history.undo()).toBe(true);
    link.deliver();
    expect(bob.get(BOX)).toMatchObject({ strokeAlign: undefined });
    expect(bob.get(PLAN)).toMatchObject({ stroke: undefined, strokeAlign: undefined });
    expect(history.redo()).toBe(true);
    link.deliver();
    expect((bob.get(BOX) as ShapeObject).strokeAlign).toBe('center');
    applyCommand(bob, setStyleCommand, { changes: [{ id: PLAN, style: { stroke: null } }] }, BOB);
    link.deliver();
    expect(ada.get(PLAN)).toMatchObject({ stroke: null, strokeAlign: 'inside' });
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(bob.read().issues).toEqual([]);
  });
});
