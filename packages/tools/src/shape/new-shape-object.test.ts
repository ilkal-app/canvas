import { describe, expect, it } from 'vitest';

import { DEFAULT_SHAPE_STYLE, newShapeObject } from './new-shape-object.js';

describe('newShapeObject', () => {
  it('makes an unturned, unlabelled shape on the board in the given box and style', () => {
    const shape = newShapeObject({ x: 10, y: 20, width: 30, height: 40 }, DEFAULT_SHAPE_STYLE);
    expect(shape).toEqual({
      type: 'shape',
      parentId: null,
      x: 10,
      y: 20,
      rotation: 0,
      locked: false,
      width: 30,
      height: 40,
      kind: 'rectangle',
      fill: [0.87, 0.93, 1, 1],
      // `ink` until the shape tool resolves it where the creation starts.
      stroke: { color: 'ink', width: 2 },
      cornerRadius: 0,
      sides: 5,
      label: null,
    });
  });

  it('copies the colours, so the new object shares nothing with the frozen style', () => {
    const style = {
      ...DEFAULT_SHAPE_STYLE,
      stroke: { color: [0, 0, 0, 1] as [number, number, number, number], width: 2 },
    };
    const shape = newShapeObject({ x: 0, y: 0, width: 1, height: 1 }, style);
    expect(Object.isFrozen(DEFAULT_SHAPE_STYLE)).toBe(true);
    expect(shape.fill).not.toBe(DEFAULT_SHAPE_STYLE.fill);
    expect(shape.stroke?.color).not.toBe(style.stroke.color);
    expect(shape.stroke?.color).toEqual([0, 0, 0, 1]);
    const bare = newShapeObject(
      { x: 0, y: 0, width: 1, height: 1 },
      { ...DEFAULT_SHAPE_STYLE, kind: 'star', fill: null, stroke: null, sides: 7 },
    );
    expect(bare).toMatchObject({ kind: 'star', fill: null, stroke: null, sides: 7 });
  });
});
