import { describe, expect, it } from 'vitest';

import type { Stroke } from '@canvas/schema';

import { ADA_ID, createClientPair, Link } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { ORDERS } from '../repair/__fixtures__/repair-fixtures.js';
import { BOB, id } from '../store/__fixtures__/store-fixtures.js';

import { applyCommand } from './__fixtures__/command-fixtures.js';
import { setStyleCommand } from './set-style.js';
import type { StylePatch } from './style-fields.js';

// Sync test for a line's stroke style: its dash, join, miter limit and cap are new
// fields of the shared style group, siblings of its stroke. Two clients writing the group at once
// converge on one whole style, in either client-id order, and undo and redo travel to the peer.
const DIVIDER = id('line-divider');

describe.each(ORDERS)('a line’s stroke style against a concurrent recolour ($name)', (order) => {
  it('converges on one whole style, before and after an undo of the stroke style', () => {
    // A line's stroke and its stroke style fields are siblings in one last-writer-wins style
    // group: the two clients converge on one of the two whole styles, never a mix.
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    const before = ada.get(DIVIDER);
    const ownStroke = before?.type === 'line' ? before.stroke : undefined;
    const dash = { pattern: [8, 4] };
    applyCommand(ada, setStyleCommand, {
      changes: [{ id: DIVIDER, style: { strokeDash: dash, strokeCap: 'butt' } }],
    });
    const red: Stroke = { color: [1, 0, 0, 1], width: 1 };
    applyCommand(bob, setStyleCommand, { changes: [{ id: DIVIDER, style: { stroke: red } }] }, BOB);
    link.deliver();
    const merged = ada.get(DIVIDER);
    expect(merged).toEqual(bob.get(DIVIDER));
    const line = merged?.type === 'line' ? merged : undefined;
    expect([
      { stroke: ownStroke, strokeDash: dash, strokeCap: 'butt' },
      { stroke: red, strokeDash: undefined, strokeCap: undefined },
    ]).toContainEqual({
      stroke: line?.stroke,
      strokeDash: line?.strokeDash,
      strokeCap: line?.strokeCap,
    });
    history.undo();
    link.deliver();
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(ada.read().issues).toEqual([]);
  });

  it('syncs a stroke style to the other client; undo removes it and redo restores it', () => {
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    const style: StylePatch = {
      strokeDash: { pattern: [0, 3], offset: 1 },
      strokeJoin: 'bevel',
      strokeMiterLimit: 2,
      strokeCap: 'round',
    };
    applyCommand(ada, setStyleCommand, { changes: [{ id: DIVIDER, style }] });
    link.deliver();
    expect(bob.get(DIVIDER)).toMatchObject(style);
    expect(history.undo()).toBe(true);
    link.deliver();
    expect(bob.get(DIVIDER)).toMatchObject({
      strokeDash: undefined,
      strokeJoin: undefined,
      strokeMiterLimit: undefined,
      strokeCap: undefined,
    });
    expect(history.redo()).toBe(true);
    link.deliver();
    expect(bob.get(DIVIDER)).toMatchObject(style);
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(bob.read().issues).toEqual([]);
  });
});
