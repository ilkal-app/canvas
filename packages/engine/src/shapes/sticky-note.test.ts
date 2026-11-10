import { describe, expect, it } from 'vitest';

import type { ShapeColor } from './shape-instance.js';
import { NOTE_CORNER_RADIUS, NOTE_SHADOW, noteInstances } from './sticky-note.js';

const YELLOW: ShapeColor = [1, 0.92, 0.55, 1];

describe('noteInstances', () => {
  it('returns the shadow first, then the fill, so the fill is drawn over its shadow', () => {
    const [shadow, fill] = noteInstances({ x: 100, y: 50, width: 200, height: 200 }, YELLOW);
    expect(shadow.color).toEqual(NOTE_SHADOW.color);
    expect(fill.color).toEqual(YELLOW);
  });

  it('fills the note bounds exactly, with the note corner radius and a crisp edge', () => {
    const [, fill] = noteInstances({ x: 100, y: 50, width: 200, height: 160 }, YELLOW);
    expect(fill).toEqual({
      kind: 'rounded-box',
      x: 100,
      y: 50,
      width: 200,
      height: 160,
      color: YELLOW,
      radius: NOTE_CORNER_RADIUS,
      softness: 0,
    });
  });

  it('insets the shadow at the sides and drops it below the note (the lifted-paper look)', () => {
    const [shadow] = noteInstances({ x: 100, y: 50, width: 200, height: 160 }, YELLOW);
    expect(shadow).toEqual({
      kind: 'rounded-box',
      x: 104,
      y: 60,
      width: 192,
      height: 158,
      color: [0, 0, 0, 0.28],
      radius: 6,
      softness: 14,
    });
  });

  it("keeps the prototype's tuned shadow constants", () => {
    expect(NOTE_CORNER_RADIUS).toBe(3);
    expect(NOTE_SHADOW).toEqual({
      color: [0, 0, 0, 0.28],
      insetX: 4,
      offsetTop: 10,
      offsetBottom: 8,
      radius: 6,
      softness: 14,
    });
  });

  it('never gives the shadow a negative size, even for a note narrower than its insets', () => {
    const [shadow] = noteInstances({ x: 0, y: 0, width: 6, height: 1 }, YELLOW);
    expect(shadow.width).toBe(0);
    expect(shadow.height).toBe(0);
  });

  it('does not mutate the rect or the colour it is given', () => {
    const rect = Object.freeze({ x: 1, y: 2, width: 3, height: 4 });
    const color = Object.freeze([...YELLOW]) as unknown as ShapeColor;
    expect(() => noteInstances(rect, color)).not.toThrow();
    expect(rect).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(color).toEqual(YELLOW);
  });
});
