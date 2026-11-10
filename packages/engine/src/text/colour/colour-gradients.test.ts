import { describe, expect, it } from 'vitest';

import type { ColourGlyphStop } from '@canvas/text';

import type { ColourContext2d } from './colour-canvas.js';
import {
  linearEnd,
  linearGradient,
  linearParameter,
  radialGradient,
  radialParameter,
  sweepGradient,
} from './colour-gradients.js';

type Call = readonly [string, ...number[]];

/**
 * A context that records the gradients it makes and their stops.
 *
 * @returns The context and its calls.
 */
function recording(): { readonly context: ColourContext2d; readonly calls: Call[] } {
  const calls: Call[] = [];
  const gradient = (kind: string, args: number[]) => {
    calls.push([kind, ...args]);
    return { addColorStop: (offset: number) => calls.push(['stop', offset]) };
  };
  const context = {
    createLinearGradient: (...args: number[]) => gradient('linear', args),
    createRadialGradient: (...args: number[]) => gradient('radial', args),
    createConicGradient: (...args: number[]) => gradient('conic', args),
  } as unknown as ColourContext2d;
  return { context, calls };
}

const black = { r: 0, g: 0, b: 0, a: 1 };
const stops: readonly ColourGlyphStop[] = [
  { offset: 0, color: black, isForeground: false },
  { offset: 1, color: black, isForeground: false },
];

describe('linearEnd', () => {
  it('projects p1 onto the line through p0 perpendicular to p0p2', () => {
    expect(
      linearEnd({ op: 'linear', x0: 0, y0: 0, x1: 1, y1: 1, x2: 0, y2: 1, extend: 'pad', stops }),
    ).toEqual({ x: 1, y: 0 });
  });

  it('keeps p1 when p2 sits on p0', () => {
    expect(
      linearEnd({ op: 'linear', x0: 0, y0: 0, x1: 1, y1: 1, x2: 0, y2: 0, extend: 'pad', stops }),
    ).toEqual({ x: 1, y: 1 });
  });
});

describe('linearGradient', () => {
  it('stretches a repeating line over its written-out range', () => {
    const { context, calls } = recording();
    linearGradient(context, {
      op: 'linear',
      x0: 0,
      y0: 0,
      x1: 1,
      y1: 0,
      x2: 0,
      y2: 1,
      extend: 'repeat',
      stops,
    });
    expect(calls[0]).toEqual(['linear', -8, 0, 9, 0]);
  });
});

describe('repeating over the parameters needed', () => {
  it('writes a short-period linear line out across the needed range', () => {
    const { context, calls } = recording();
    const op = {
      op: 'linear',
      x0: 0,
      y0: 0,
      x1: 0.01,
      y1: 0,
      x2: 0,
      y2: 1,
      extend: 'repeat',
      stops,
    } as const;
    linearGradient(context, op, [0, 100]);
    const [, x0, , x1] = calls[0] ?? [];
    expect(x0).toBeLessThanOrEqual(0);
    expect(x1).toBeGreaterThanOrEqual(1);
    expect(linearParameter(op)({ x: 0.5, y: 3 })).toBeCloseTo(50);
  });

  it('gives a linear gradient of no length no parameter', () => {
    const op = {
      op: 'linear',
      x0: 0,
      y0: 0,
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 0,
      extend: 'repeat',
      stops,
    } as const;
    expect(linearParameter(op)({ x: 1, y: 1 })).toBeNaN();
  });

  it('writes a radial line out to the parameters needed', () => {
    const { context, calls } = recording();
    radialGradient(
      context,
      { op: 'radial', x0: 0, y0: 0, r0: 0, x1: 0, y1: 0, r1: 0.05, extend: 'reflect', stops },
      [0, 28.3],
    );
    const [, , , , , , r1] = calls[0] ?? [];
    expect(r1).toBeGreaterThanOrEqual(Math.SQRT2);
  });
});

describe('radialParameter', () => {
  it('is the larger root with a non-negative radius', () => {
    const op = {
      op: 'radial',
      x0: 0,
      y0: 0,
      r0: 1,
      x1: 0,
      y1: 0,
      r1: 2,
      extend: 'pad',
      stops,
    } as const;
    expect(radialParameter(op, { x: 3, y: 0 })).toBeCloseTo(2);
  });

  it('solves the one root of a cone whose radius grows as fast as its centre moves', () => {
    const op = {
      op: 'radial',
      x0: 0,
      y0: 0,
      r0: 0,
      x1: 1,
      y1: 0,
      r1: 1,
      extend: 'pad',
      stops,
    } as const;
    expect(radialParameter(op, { x: 2, y: 0 })).toBeCloseTo(1);
    expect(radialParameter(op, { x: 0, y: 1 })).toBeNaN();
  });

  it('is NaN where no circle reaches the point', () => {
    const op = {
      op: 'radial',
      x0: 0,
      y0: 0,
      r0: 0.1,
      x1: 0.2,
      y1: 0,
      r1: 0.1,
      extend: 'pad',
      stops,
    } as const;
    expect(radialParameter(op, { x: 0, y: 5 })).toBeNaN();
  });
});

describe('radialGradient', () => {
  it('keeps a shrinking pair of circles from 0 when the radius never reaches zero going back', () => {
    const { context, calls } = recording();
    radialGradient(context, {
      op: 'radial',
      x0: 0,
      y0: 0,
      r0: 1,
      x1: 1,
      y1: 0,
      r1: 0.5,
      extend: 'pad',
      stops,
    });
    expect(calls[0]).toEqual(['radial', 0, 0, 1, 1, 0, 0.5]);
  });

  it('starts a growing repeating pair where the radius reaches zero', () => {
    const { context, calls } = recording();
    radialGradient(context, {
      op: 'radial',
      x0: 0,
      y0: 0,
      r0: 1,
      x1: 0,
      y1: 0,
      r1: 2,
      extend: 'repeat',
      stops,
    });
    expect(calls[0]).toEqual(['radial', 0, 0, 0, 0, 0, 10]);
  });
});

describe('sweepGradient', () => {
  it('fills a zero-angle sweep with its first colour', () => {
    const { context, calls } = recording();
    sweepGradient(context, {
      op: 'sweep',
      x0: 0,
      y0: 0,
      startAngle: 1,
      endAngle: 1,
      extend: 'pad',
      stops,
    });
    expect(calls).toEqual([
      ['conic', 1, 0, 0],
      ['stop', 0],
      ['stop', 1],
    ]);
  });

  it('fills a zero-angle sweep with no stops transparent', () => {
    const { context, calls } = recording();
    sweepGradient(context, {
      op: 'sweep',
      x0: 0,
      y0: 0,
      startAngle: 1,
      endAngle: 1,
      extend: 'pad',
      stops: [],
    });
    expect(calls).toHaveLength(3);
  });

  it('wraps the angles before the start angle after a full turn, with a hard edge at 0', () => {
    const { context, calls } = recording();
    const line = [
      { offset: 0, color: black, isForeground: false },
      { offset: 1, color: { r: 1, g: 1, b: 1, a: 1 }, isForeground: false },
    ];
    sweepGradient(context, {
      op: 'sweep',
      x0: 0,
      y0: 0,
      startAngle: Math.PI / 2,
      endAngle: Math.PI,
      extend: 'pad',
      stops: line,
    });
    const offsets = calls.filter(([kind]) => kind === 'stop').map(([, offset]) => offset);
    // From the start (share 0) to the end angle (¼ turn), padded white to α = 2π (¾ turn), then
    // α = 0 onwards pads black up to the start again.
    expect(offsets).toEqual([0, 0.25, 0.75, 0.75, 1]);
  });

  it('runs a negative sweep backwards from the start angle', () => {
    const { context, calls } = recording();
    sweepGradient(context, {
      op: 'sweep',
      x0: 0,
      y0: 0,
      startAngle: Math.PI,
      endAngle: Math.PI / 2,
      extend: 'pad',
      stops,
    });
    const offsets = calls.filter(([kind]) => kind === 'stop').map(([, offset]) => offset);
    expect(offsets).toEqual([0, 0.5, 0.5, 0.75, 1]);
  });
});
