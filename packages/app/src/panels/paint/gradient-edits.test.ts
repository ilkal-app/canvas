// The paint control's pure edits: switching kind, adding, removing, moving
// and recolouring stops, and the angle in degrees.
import { describe, expect, it } from 'vitest';

import {
  INK_COLORS,
  isGradient,
  paintSchema,
  type Gradient,
  type LinearGradient,
  type Rgba,
} from '@canvas/schema';

import {
  addStop,
  angleToDegrees,
  clampStopIndex,
  degreesToAngle,
  moveStop,
  NO_FILL_GRADIENT_START,
  paintKindOf,
  recolourStop,
  removeStop,
  switchPaintKind,
  fractionToPercent,
  percentToFraction,
} from './gradient-edits.js';
import { isSamePaint } from './paint-value.js';

const RED: Rgba = [230 / 255, 57 / 255, 70 / 255, 1];
const WHITE: Rgba = [1, 1, 1, 1];
const BLUE: Rgba = [0, 0, 1, 1];

/**
 * A linear gradient over stops.
 *
 * @param stops - Offset and colour pairs.
 * @returns The gradient.
 */
function linear(...stops: (readonly [number, Rgba])[]): LinearGradient {
  return {
    type: 'linear',
    angle: 0,
    stops: stops.map(([offset, color]) => ({ offset, color })),
  };
}

/**
 * Deep-freezes a gradient so an edit that mutates it throws.
 *
 * @param gradient - The gradient.
 * @returns The same gradient, frozen.
 */
function frozen<Value extends Gradient>(gradient: Value): Value {
  for (const stop of gradient.stops) {
    Object.freeze(stop.color);
    Object.freeze(stop);
  }
  Object.freeze(gradient.stops);
  return Object.freeze(gradient);
}

describe('switchPaintKind', () => {
  it('makes a solid a gradient from its colour to white, linear at 0 or radial centred', () => {
    expect(switchPaintKind(RED, 'linear')).toEqual(linear([0, RED], [1, WHITE]));
    expect(switchPaintKind(RED, 'radial')).toEqual({
      type: 'radial',
      center: { x: 0.5, y: 0.5 },
      radius: 0.5,
      stops: [
        { offset: 0, color: RED },
        { offset: 1, color: WHITE },
      ],
    });
  });

  it('keeps the stops between linear and radial, and goes solid in the first stop colour', () => {
    const gradient = frozen(linear([0, BLUE], [0.4, RED], [1, WHITE]));
    const radial = switchPaintKind(gradient, 'radial');
    expect(radial).toMatchObject({ type: 'radial', stops: gradient.stops });
    expect(switchPaintKind(radial, 'linear')).toEqual(gradient);
    expect(switchPaintKind(gradient, 'solid')).toEqual(BLUE);
  });

  it('starts a token at its value: the resolver given, else its light default', () => {
    expect(switchPaintKind({ token: 'brand1' }, 'linear', () => BLUE)).toEqual(
      linear([0, BLUE], [1, WHITE]),
    );
    expect(switchPaintKind({ token: 'ink' }, 'linear')).toEqual(
      linear([0, INK_COLORS.light], [1, WHITE]),
    );
    expect(switchPaintKind({ token: 'brand1' }, 'solid')).toEqual({ token: 'brand1' });
  });

  it('starts a none from opaque black, and leaves a paint of the kind as it is', () => {
    expect(switchPaintKind(null, 'linear')).toEqual(
      linear([0, NO_FILL_GRADIENT_START], [1, WHITE]),
    );
    expect(switchPaintKind(null, 'solid')).toBeNull();
    const gradient = linear([0, RED], [1, WHITE]);
    expect(switchPaintKind(gradient, 'linear')).toBe(gradient);
    expect(switchPaintKind(RED, 'solid')).toBe(RED);
  });

  it('makes paints the schema accepts', () => {
    for (const kind of ['linear', 'radial'] as const) {
      expect(paintSchema.safeParse(switchPaintKind(RED, kind)).success).toBe(true);
    }
  });

  it('names the kind of a paint, none counting as solid', () => {
    expect(paintKindOf(null)).toBe('solid');
    expect(paintKindOf(RED)).toBe('solid');
    expect(paintKindOf(linear([0, RED], [1, WHITE]))).toBe('linear');
  });
});

describe('stop edits', () => {
  it('adds a stop midway to the next one, coloured in premultiplied sRGB, and selects it', () => {
    const clear: Rgba = [1, 0, 0, 0];
    const gradient = frozen(linear([0, BLUE], [1, clear]));
    const edit = addStop(gradient, 0);
    // Premultiplied: the transparent end adds no darkness, so the hue stays blue at half alpha.
    expect(edit?.gradient.stops).toEqual([
      { offset: 0, color: BLUE },
      { offset: 0.5, color: [0, 0, 1, 0.5] },
      { offset: 1, color: clear },
    ]);
    expect(edit?.selected).toBe(1);
  });

  it('adds before the last stop when the last is selected, and refuses a ninth', () => {
    const edit = addStop(linear([0, RED], [1, WHITE]), 1);
    expect(edit?.gradient.stops.map((stop) => stop.offset)).toEqual([0, 0.5, 1]);
    expect(edit?.selected).toBe(1);
    let gradient: Gradient = linear([0, RED], [1, WHITE]);
    for (let added = 0; added < 6; added++) gradient = addStop(gradient, 0)?.gradient ?? gradient;
    expect(gradient.stops).toHaveLength(8);
    expect(addStop(gradient, 0)).toBeUndefined();
    expect(paintSchema.safeParse(gradient).success).toBe(true);
  });

  it('removes the selected stop, selecting the one before, and refuses below two', () => {
    const gradient = frozen(linear([0, RED], [0.5, BLUE], [1, WHITE]));
    const edit = removeStop(gradient, 1);
    expect(edit?.gradient.stops).toEqual([
      { offset: 0, color: RED },
      { offset: 1, color: WHITE },
    ]);
    expect(edit?.selected).toBe(0);
    expect(removeStop(linear([0, RED], [1, WHITE]), 0)).toBeUndefined();
  });

  it('moves a stop past its neighbours, re-sorting and keeping it selected', () => {
    const gradient = frozen(linear([0, RED], [0.5, BLUE], [1, WHITE]));
    const right = moveStop(gradient, 0, 0.75);
    expect(right.gradient.stops.map((stop) => stop.offset)).toEqual([0.5, 0.75, 1]);
    expect(right.gradient.stops[right.selected]?.color).toEqual(RED);
    const left = moveStop(gradient, 2, 0.25);
    expect(left.gradient.stops.map((stop) => stop.offset)).toEqual([0, 0.25, 0.5]);
    expect(left.gradient.stops[left.selected]?.color).toEqual(WHITE);
  });

  it('clamps a moved offset into [0, 1] and places it beside equal offsets in its direction', () => {
    const gradient = linear([0, RED], [0.5, BLUE], [1, WHITE]);
    expect(moveStop(gradient, 1, 2).gradient.stops.map((stop) => stop.offset)).toEqual([0, 1, 1]);
    expect(moveStop(gradient, 1, 2).selected).toBe(2);
    expect(moveStop(gradient, 1, -1).selected).toBe(0);
    expect(moveStop(gradient, 0, 0.25).gradient.stops[0]?.offset).toBe(0.25);
  });

  it('recolours one stop and clamps a stale selection', () => {
    const gradient = frozen(linear([0, RED], [1, WHITE]));
    expect(recolourStop(gradient, 1, BLUE).stops[1]?.color).toEqual(BLUE);
    expect(clampStopIndex(gradient, 5)).toBe(1);
    expect(clampStopIndex(gradient, -1)).toBe(0);
  });
});

describe('angles', () => {
  it('turns degrees into radians in (−π, π], exactly for whole fractions of a turn', () => {
    expect(degreesToAngle(90)).toBe(Math.PI / 2);
    expect(degreesToAngle(180)).toBe(Math.PI);
    expect(degreesToAngle(-180)).toBe(Math.PI);
    expect(degreesToAngle(270)).toBe(-Math.PI / 2);
    expect(degreesToAngle(-90)).toBe(-Math.PI / 2);
    expect(degreesToAngle(360)).toBe(0);
    expect(degreesToAngle(45)).toBe(Math.PI / 4);
  });

  it('shows radians as degrees rounded to hundredths', () => {
    expect(angleToDegrees(Math.PI / 2)).toBe(90);
    expect(angleToDegrees(Math.PI)).toBe(180);
    expect(angleToDegrees(1)).toBe(57.3);
  });
});

describe('isSamePaint', () => {
  it('compares nones, colours and gradients field by field', () => {
    expect(isSamePaint(null, null)).toBe(true);
    expect(isSamePaint(RED, [...RED])).toBe(true);
    expect(isSamePaint(RED, null)).toBe(false);
    const gradient = linear([0, RED], [1, WHITE]);
    expect(isSamePaint(gradient, linear([0, RED], [1, WHITE]))).toBe(true);
    expect(isSamePaint(gradient, { ...gradient, angle: 1 })).toBe(false);
    expect(isSamePaint(gradient, linear([0, RED], [0.5, WHITE]))).toBe(false);
    expect(isSamePaint(gradient, RED)).toBe(false);
    const radial = switchPaintKind(gradient, 'radial');
    expect(isSamePaint(radial, switchPaintKind(gradient, 'radial'))).toBe(true);
    expect(isSamePaint(radial, gradient)).toBe(false);
    if (isGradient(radial) && radial.type === 'radial') {
      expect(isSamePaint(radial, { ...radial, radius: 2 })).toBe(false);
      expect(isSamePaint(radial, { ...radial, center: { x: 0.5, y: 0 } })).toBe(false);
    }
  });
});

describe('percentages of the box', () => {
  it('shows fractions as percentages and stores percentages as fractions', () => {
    expect(fractionToPercent(0.25)).toBe(25);
    expect(fractionToPercent(1 / 3)).toBe(33.33);
    expect(percentToFraction(25)).toBe(0.25);
    expect(percentToFraction(75)).toBe(0.75);
    expect(percentToFraction(200)).toBe(2);
  });
});
