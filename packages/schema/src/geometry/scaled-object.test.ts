import { describe, expect, it } from 'vitest';

import { connector, line } from '../instances/__fixtures__/component-board.js';
import type { BoardObject } from '../objects/board-object.js';
import { deepFreeze } from '../rules/__fixtures__/deep-freeze.js';

import { scaledObject } from './scaled-object.js';

describe('scaledObject', () => {
  it("scales a dash pattern and its offset, and a connector's free ends but not its anchors", () => {
    const dashed = deepFreeze(line('l', null, { strokeDash: { pattern: [4, 2], offset: 1 } }));
    expect(scaledObject(dashed, 3)).toMatchObject({
      strokeDash: { pattern: [12, 6], offset: 3 },
    });
    const undashedOffset = deepFreeze(line('l', null, { strokeDash: { pattern: [5] } }));
    expect(scaledObject(undashedOffset, 2)).toMatchObject({ strokeDash: { pattern: [10] } });
    const link = deepFreeze(
      connector('k', null, 'a', 'b', { to: { kind: 'point', x: 30, y: -12 } }),
    );
    expect(scaledObject(link, 2)).toMatchObject({
      from: { kind: 'object', anchor: { x: 1, y: 0.5 } },
      to: { kind: 'point', x: 60, y: -24 },
    });
    const freeStart = deepFreeze(
      connector('k', null, 'a', 'b', { from: { kind: 'point', x: -4, y: 8 } }),
    );
    expect(scaledObject(freeStart, 0.5)).toMatchObject({
      from: { kind: 'point', x: -2, y: 4 },
      to: { kind: 'object', anchor: null },
    });
  });

  it('leaves values it cannot read as they are, as a raw stored object may hold them', () => {
    const malformed = deepFreeze({
      id: 'odd',
      type: 'instance',
      x: 1,
      y: 2,
      width: 3,
      height: 'tall',
      runs: 'not runs',
      label: 'not a label',
      autoLayout: 7,
      overrides: 'none',
      shadow: [null, { x: 1, y: 1, blur: 2, spread: 0 }],
      segments: [null],
      stroke: 'thin',
      strokeDash: 'dotted',
    }) as unknown as BoardObject;
    expect(scaledObject(malformed, 2)).toEqual({
      ...malformed,
      x: 2,
      y: 4,
      width: 6,
      shadow: [null, { x: 2, y: 2, blur: 4, spread: 0 }],
      scale: 2,
    });
    const oddRuns = deepFreeze({
      id: 't',
      type: 'text',
      x: 0,
      y: 0,
      runs: [null, { length: 1 }, { length: 1, style: { fontSize: 'big' } }],
      label: { runs: [{ length: 1, style: { fontSize: 10 } }] },
      overrides: { a: null, b: { fill: [1, 0, 0, 1] } },
      autoLayout: { gap: 4 },
    }) as unknown as BoardObject;
    expect(scaledObject(oddRuns, 2)).toEqual({
      ...oddRuns,
      runs: [null, { length: 1 }, { length: 1, style: { fontSize: 'big' } }],
      label: { runs: [{ length: 1, style: { fontSize: 20 } }] },
      autoLayout: { gap: 8 },
    });
  });
});
