import { describe, expect, it } from 'vitest';

import {
  boxAround,
  boxCentreOf,
  boxCornersOf,
  boxPointToWorld,
  isInsideBox,
  normalizeAngle,
  rotateBoxAbout,
  rotatePointAbout,
  translateBox,
  worldPointToBox,
  type OrientedBox,
} from './oriented-box.js';

/** A 100 × 50 box turned a quarter turn clockwise about its corner at (10, 20). */
const TURNED: OrientedBox = { x: 10, y: 20, width: 100, height: 50, rotation: Math.PI / 2 };

function expectPoint(actual: { x: number; y: number }, x: number, y: number): void {
  expect(actual.x).toBeCloseTo(x, 9);
  expect(actual.y).toBeCloseTo(y, 9);
}

describe('oriented boxes', () => {
  it('maps a point of the box to the world and back', () => {
    // A quarter turn clockwise on a y-down screen sends local +x to world +y.
    expectPoint(boxPointToWorld(TURNED, { x: 100, y: 0 }), 10, 120);
    expectPoint(boxPointToWorld(TURNED, { x: 0, y: 50 }), -40, 20);
    expectPoint(worldPointToBox(TURNED, { x: -40, y: 120 }), 100, 50);
  });

  it('lists the corners clockwise from the top-left and finds the centre', () => {
    const corners = boxCornersOf(TURNED);
    expectPoint(corners[0], 10, 20);
    expectPoint(corners[1], 10, 120);
    expectPoint(corners[2], -40, 120);
    expectPoint(corners[3], -40, 20);
    expectPoint(boxCentreOf(TURNED), -15, 70);
  });

  it('tells whether a world point lies inside the turned box, edges included', () => {
    expect(isInsideBox(TURNED, { x: -15, y: 70 })).toBe(true);
    expect(isInsideBox(TURNED, { x: 10, y: 120 })).toBe(true);
    expect(isInsideBox(TURNED, { x: 20, y: 70 })).toBe(false);
  });

  it('wraps a set of points in an axis-aligned box, or none for no points', () => {
    expect(
      boxAround([
        { x: 5, y: -2 },
        { x: -3, y: 8 },
      ]),
    ).toEqual({ x: -3, y: -2, width: 8, height: 10, rotation: 0 });
    expect(boxAround([])).toBeUndefined();
  });

  it('turns a box and its corner about a pivot, and moves it by a delta', () => {
    const box: OrientedBox = { x: 0, y: 0, width: 20, height: 10, rotation: 0 };
    const turned = rotateBoxAbout(box, { x: 10, y: 5 }, Math.PI);
    expect(turned.x).toBeCloseTo(20, 9);
    expect(turned.y).toBeCloseTo(10, 9);
    expect(turned.rotation).toBeCloseTo(Math.PI, 12);
    expect(translateBox(box, { x: 3, y: -4 })).toEqual({ ...box, x: 3, y: -4 });
    expectPoint(rotatePointAbout({ x: 1, y: 0 }, { x: 0, y: 0 }, Math.PI / 2), 0, 1);
  });

  it('keeps an angle within a half turn either way', () => {
    expect(normalizeAngle(3 * Math.PI + 0.5)).toBeCloseTo(-Math.PI + 0.5, 12);
    expect(normalizeAngle(-Math.PI)).toBe(Math.PI);
    expect(normalizeAngle(0.25)).toBe(0.25);
  });

  it('never changes the box it is given', () => {
    const box = Object.freeze({ ...TURNED });
    rotateBoxAbout(box, { x: 0, y: 0 }, 1);
    translateBox(box, { x: 1, y: 1 });
    expect(box).toEqual(TURNED);
  });
});
