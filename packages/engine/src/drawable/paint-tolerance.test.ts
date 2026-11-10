// Reader tolerance: paints and inkable colours never make an object undrawable; the passes draw a
// refused gradient as no fill and an unreadable colour as the base.
import { describe, expect, it } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import { frameObject, shapeObject } from '../scene/__fixtures__/scene-objects.js';
import { stickyObject } from '../scene/segments/__fixtures__/note-and-text-passes.js';
import {
  connectorObject,
  lineObject,
  pathObject,
} from '../spatial/__fixtures__/spatial-objects.js';

import { ownUndrawableReason } from './drawable-fields.js';

const GRADIENT = {
  type: 'linear',
  angle: 1,
  stops: [
    { offset: 0, color: [1, 0, 0, 1] },
    { offset: 1, color: [0, 0, 1, 0] },
  ],
};

const as = (object: unknown) => object as BoardObject;

describe('paint and ink tolerance', () => {
  it('draws objects with valid gradients and ink', () => {
    const drawable = [
      shapeObject('s', { fill: GRADIENT as never, stroke: { color: 'ink', width: 2 } }),
      frameObject('f', { background: GRADIENT as never }),
      as({
        ...pathObject('p', [
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ]),
        fill: GRADIENT,
      }),
      as({ ...lineObject('l'), stroke: { color: 'ink', width: 2 } }),
      as({ ...connectorObject('c'), stroke: { color: 'ink', width: 2 } }),
    ];
    for (const object of drawable) expect(ownUndrawableReason(object), object.id).toBeUndefined();
  });

  it('keeps an object whose gradient or colour the schema refuses', () => {
    const sticky = stickyObject('n');
    const [run] = sticky.runs;
    if (run === undefined) throw new Error('the fixture sticky has a run');
    const tolerated = [
      shapeObject('s', { fill: { ...GRADIENT, stops: [] } as never }),
      shapeObject('s', { fill: { type: 'conic' } as never }),
      frameObject('f', { background: 'ink' as never }),
      shapeObject('s', { stroke: { color: 'Ink' as never, width: 2 } }),
      as({ ...lineObject('l'), stroke: { color: { r: 1 }, width: 2 } }),
      as({ ...sticky, runs: [{ ...run, style: { ...run.style, color: 'INK' } }] }),
    ];
    for (const object of tolerated) expect(ownUndrawableReason(object), object.id).toBeUndefined();
  });

  it('still judges tuple channels, and every other number of a run', () => {
    const sticky = stickyObject('n');
    const [run] = sticky.runs;
    if (run === undefined) throw new Error('the fixture sticky has a run');
    const refused = [
      shapeObject('s', { stroke: { color: [2, 0, 0, 1], width: 2 } }),
      frameObject('f', { background: [0, Number.NaN, 0, 1] }),
      as({ ...sticky, runs: [{ ...run, style: { ...run.style, color: 'x', fontSize: 1e9 } }] }),
    ];
    for (const object of refused) expect(ownUndrawableReason(object), object.id).toBeDefined();
  });
});
