import { describe, expect, it } from 'vitest';

import { clickedShapeBox, DEFAULT_SHAPE_SIZE, MIN_SHAPE_SIZE, shapeDragBox } from './shape-drag.js';

const PLAIN = { isSquare: false, isFromCentre: false };

describe('shapeDragBox', () => {
  it('spans the press and the pointer, dragged in any direction', () => {
    expect(shapeDragBox({ x: 10, y: 20 }, { x: 70, y: 50 }, PLAIN)).toEqual({
      x: 10,
      y: 20,
      width: 60,
      height: 30,
    });
    expect(shapeDragBox({ x: 10, y: 20 }, { x: -50, y: 0 }, PLAIN)).toEqual({
      x: -50,
      y: 0,
      width: 60,
      height: 20,
    });
  });

  it('keeps 1:1 with Shift, the larger side winning toward the pointer', () => {
    const square = { isSquare: true, isFromCentre: false };
    expect(shapeDragBox({ x: 0, y: 0 }, { x: 60, y: -20 }, square)).toEqual({
      x: 0,
      y: -60,
      width: 60,
      height: 60,
    });
  });

  it('keeps 1:1 up and to the left too', () => {
    const square = { isSquare: true, isFromCentre: false };
    expect(shapeDragBox({ x: 100, y: 100 }, { x: 80, y: 50 }, square)).toEqual({
      x: 50,
      y: 50,
      width: 50,
      height: 50,
    });
  });

  it('draws about the press with Alt, and square about it with both', () => {
    const centred = { isSquare: false, isFromCentre: true };
    expect(shapeDragBox({ x: 100, y: 100 }, { x: 130, y: 90 }, centred)).toEqual({
      x: 70,
      y: 90,
      width: 60,
      height: 20,
    });
    const both = { isSquare: true, isFromCentre: true };
    expect(shapeDragBox({ x: 0, y: 0 }, { x: 10, y: 30 }, both)).toEqual({
      x: -30,
      y: -30,
      width: 60,
      height: 60,
    });
  });

  it('never makes a side thinner than the minimum', () => {
    const flat = shapeDragBox({ x: 0, y: 0 }, { x: 50, y: 0 }, PLAIN);
    expect(flat.height).toBe(MIN_SHAPE_SIZE);
  });
});

describe('clickedShapeBox', () => {
  it('is the default size, centred on the click', () => {
    expect(clickedShapeBox({ x: 200, y: 100 })).toEqual({
      x: 200 - DEFAULT_SHAPE_SIZE / 2,
      y: 100 - DEFAULT_SHAPE_SIZE / 2,
      width: DEFAULT_SHAPE_SIZE,
      height: DEFAULT_SHAPE_SIZE,
    });
  });
});
