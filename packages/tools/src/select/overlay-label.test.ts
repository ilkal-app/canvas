import { describe, expect, it } from 'vitest';

import {
  CONNECT_LABEL_TEXT,
  connectLabelOf,
  extentLabelOf,
  gapLabelsOf,
  LOCKED_LABEL_TEXT,
  lockedLabelOf,
  sizeLabelOf,
} from './overlay-label.js';

describe('overlay labels', () => {
  it('reads a resized frame’s size in whole units, at its bounds’ bottom-right', () => {
    const frame = { x: 428, y: 128, width: 176.4, height: 129.6, rotation: 0 };
    expect(sizeLabelOf(frame)).toEqual({
      kind: 'size',
      text: '176 × 130',
      at: { x: 604.4, y: 257.6 },
    });
    // A turned frame keeps its own size; the anchor is its bounds' corner.
    const turned = sizeLabelOf({ x: 0, y: 0, width: 100, height: 50, rotation: Math.PI / 2 });
    expect(turned.text).toBe('100 × 50');
    expect(turned.at.x).toBeCloseTo(0, 9);
    expect(turned.at.y).toBeCloseTo(100, 9);
  });

  it('labels each gap run with its length at its middle, with its axis', () => {
    expect(
      gapLabelsOf([
        { axis: 'x', from: 404, to: 428, position: 184 },
        { axis: 'y', from: 10, to: 40, position: 7 },
      ]),
    ).toEqual([
      { kind: 'gap', text: '24', at: { x: 416, y: 184 }, axis: 'x' },
      { kind: 'gap', text: '30', at: { x: 7, y: 25 }, axis: 'y' },
    ]);
  });

  it('puts the locked notice under the frame’s bottom-left corner', () => {
    const frame = { x: 428, y: 256, width: 176, height: 112, rotation: 0 };
    expect(lockedLabelOf(frame)).toEqual({
      kind: 'locked',
      text: LOCKED_LABEL_TEXT,
      at: { x: 428, y: 368 },
    });
    expect(LOCKED_LABEL_TEXT).toBe('Locked · can’t move or resize');
  });

  it('reads a shape being drawn below its box, and says release to connect at an end', () => {
    expect(extentLabelOf({ x: 220, y: 620, width: 168, height: 100 })).toEqual({
      kind: 'extent',
      text: '168 × 100',
      at: { x: 304, y: 720 },
    });
    expect(connectLabelOf({ x: 676, y: 518 })).toEqual({
      kind: 'connect',
      text: CONNECT_LABEL_TEXT,
      at: { x: 676, y: 518 },
    });
    expect(CONNECT_LABEL_TEXT).toBe('Release to connect');
  });
});
