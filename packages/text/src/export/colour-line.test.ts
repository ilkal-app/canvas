// colourLineOf: COLRv1 colour lines resolved for writers that spread a line over 0..1.
import { describe, expect, it } from 'vitest';

import type { TextLayout } from '../layout/text-layout.js';

import type { VectorGradient } from './colour-layers.js';
import { colourAtStops, colourLineOf, type Rgba } from './colour-line.js';
import { textSvg } from './text-svg.js';
import type { VectorGlyph } from './text-vectors.js';

const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const BLACK: Rgba = [0, 0, 0, 1];
const WHITE: Rgba = [1, 1, 1, 1];

/**
 * Resolves a test fill: `white` or black.
 *
 * @param fill - The fill.
 * @returns The colour.
 */
function colorOf(fill: unknown): Rgba {
  return fill === 'white' ? WHITE : BLACK;
}

/**
 * A linear gradient from 0 to 4 along x, black stops then a white last stop.
 *
 * @param extend - Past its ends.
 * @param offsets - Its stops' offsets.
 * @returns The gradient.
 */
function linear(extend: 'pad' | 'repeat' | 'reflect', ...offsets: number[]): VectorGradient {
  const stops = offsets.map((offset, index) => ({
    offset,
    color: index === offsets.length - 1 ? 'white' : 'black',
  }));
  return {
    ...{ kind: 'linear', x0: 0, y0: 0, x1: 4, y1: 0, extend, transform: IDENTITY },
    stops,
  } as unknown as VectorGradient;
}

/**
 * A radial gradient between two circles, black at 0 and white at 1.
 *
 * @param r0 - The start radius.
 * @param r1 - The end radius.
 * @param extend - Past its ends.
 * @returns The gradient.
 */
function radial(
  r0: number,
  r1: number,
  extend: 'pad' | 'repeat' | 'reflect' = 'pad',
): VectorGradient {
  return {
    ...{ kind: 'radial', x0: 0, y0: 0, r0, x1: 0, y1: 0, r1, extend, transform: IDENTITY },
    stops: [
      { offset: 0, color: 'black' },
      { offset: 1, color: 'white' },
    ],
  } as unknown as VectorGradient;
}

describe('colourLineOf', () => {
  it('moves a linear gradient’s ends to its first and last stops and remaps them onto 0..1', () => {
    const line = colourLineOf(linear('repeat', 0.25, 0.5, 0.75), colorOf);
    expect(line?.gradient).toMatchObject({ x0: 1, x1: 3 });
    expect(line?.stops.map(({ offset }) => offset)).toEqual([0, 0.5, 1]);
  });

  it('interpolates a radial gradient’s circles and a sweep’s angles', () => {
    const shifted = {
      ...radial(0, 8),
      x1: 4,
      y1: 4,
      stops: [
        { offset: 0.5, color: 'black' },
        { offset: 1, color: 'white' },
      ],
    };
    expect(colourLineOf(shifted as unknown as VectorGradient, colorOf)?.gradient).toMatchObject({
      x0: 2,
      y0: 2,
      r0: 4,
      r1: 8,
    });
    const sweep = {
      ...{
        kind: 'sweep',
        x0: 0,
        y0: 0,
        startAngle: 0,
        endAngle: 4,
        extend: 'repeat',
        transform: IDENTITY,
      },
      stops: [
        { offset: 0.25, color: 'black' },
        { offset: 0.5, color: 'white' },
      ],
    } as unknown as VectorGradient;
    expect(colourLineOf(sweep, colorOf)?.gradient).toMatchObject({ startAngle: 1, endAngle: 2 });
  });

  // A concentric example: r runs from -1 to 3 across the line, so radius 1 is the line's
  // middle, halfway between its stops; cutting at the tip (radius 0, a quarter in) keeps that.
  it('cuts a cone at its zero-radius tip, keeping each radius’s colour', () => {
    const line = colourLineOf(radial(-1, 3), colorOf);
    expect(line?.gradient).toMatchObject({ r0: 0, r1: 3 });
    expect(colourAtStops(line?.stops ?? [], 1 / 3)[0]).toBeCloseTo(0.5);
    expect(line?.stops[0]?.rgba[0]).toBeCloseTo(0.25);
    // A shrinking cone keeps its direction (COLRv1 paints the largest position on top): the
    // window runs from the line's start to the tip, radius 3 down to 0; radius 1 is 2/3 in.
    const shrinking = colourLineOf(radial(3, -1), colorOf);
    expect(shrinking?.gradient).toMatchObject({ r0: 3, r1: 0 });
    expect(colourAtStops(shrinking?.stops ?? [], 2 / 3)[0]).toBeCloseTo(0.5);
    expect(colourLineOf(radial(-1, -1), colorOf)).toBeNull();
  });

  it('paints a padded cone whose tip lies past the stops in its end colour', () => {
    // r from -3 to -1: zero at 1.5 on the line, growing after it, where pad holds white.
    const line = colourLineOf(radial(-3, -1), colorOf);
    expect(line?.gradient).toMatchObject({ r0: 0, r1: 2 });
    expect(line?.stops.map(({ rgba }) => rgba)).toEqual([WHITE, WHITE]);
    // r from -1 to 1, its tip in the middle: the visible half starts grey and ends white.
    const half = colourLineOf(radial(-1, 1), colorOf);
    expect(half?.stops[0]?.rgba[0]).toBeCloseTo(0.5);
    // r from 1 to -1 shrinking: the visible half runs from black at the start to grey at the tip.
    const back = colourLineOf(radial(1, -1), colorOf);
    expect(back?.gradient).toMatchObject({ r0: 1, r1: 0 });
    expect(back?.stops[0]?.rgba).toEqual(BLACK);
    expect(back?.stops.at(-1)?.rgba[0]).toBeCloseTo(0.5);
    // r from -3 to -1 shrinking the other way: the tip lies before the line's start.
    expect(colourLineOf(radial(-1, -3), colorOf)?.stops.map(({ rgba }) => rgba)).toEqual([
      BLACK,
      BLACK,
    ]);
  });

  it('repeats a cut cone’s pattern from its tip, and reflects it over two periods', () => {
    // r from -3 to -1 repeating: the tip at 1.5 is mid-period, grey, then white, black, grey.
    const repeat = colourLineOf(radial(-3, -1, 'repeat'), colorOf);
    expect(repeat?.gradient).toMatchObject({ r0: 0, r1: 2, extend: 'repeat' });
    expect(repeat?.stops.map(({ offset }) => offset)).toEqual([0, 0.5, 0.5, 1]);
    expect(repeat?.stops[0]?.rgba[0]).toBeCloseTo(0.5);
    expect(repeat?.stops.at(-1)?.rgba[0]).toBeCloseTo(0.5);
    const reflect = colourLineOf(radial(-1, 1, 'reflect'), colorOf);
    // A reflecting line's period is two of its lengths: the radius grows 2 a length, to 4.
    expect(reflect?.gradient).toMatchObject({ r0: 0, r1: 4, extend: 'repeat' });
    expect(reflect?.stops.length).toBeGreaterThanOrEqual(4);
    const shrinking = colourLineOf(radial(1, -1, 'repeat'), colorOf);
    expect(shrinking?.stops[0]?.offset).toBe(0);
  });

  // A stop that lands on a repeating window's seam by the period's wrap.
  it('orders seam stops by period, so each window end takes its own side’s colour', () => {
    // r from -1 to 0: the tip is the line's end; past it, repeat starts again with black.
    const growing = colourLineOf(radial(-1, 0, 'repeat'), colorOf);
    const atStart = growing?.stops.filter(({ offset }) => offset === 0) ?? [];
    const atEnd = growing?.stops.filter(({ offset }) => offset === 1) ?? [];
    expect(atStart.at(-1)?.rgba).toEqual(BLACK);
    expect(atEnd[0]?.rgba).toEqual(WHITE);
    // r from 0 to -1: the tip is the line's start; before it, the previous period ends white.
    const shrinking = colourLineOf(radial(0, -1, 'repeat'), colorOf);
    expect(shrinking?.gradient).toMatchObject({ r1: 0 });
    const shrinkingEnd = shrinking?.stops.filter(({ offset }) => offset === 1) ?? [];
    expect(shrinkingEnd[0]?.rgba).toEqual(WHITE);
  });

  it('starts a cut at duplicate tip stops with the visible side’s colour', () => {
    const duplicate = (extend: 'pad' | 'repeat') =>
      ({
        ...{
          kind: 'radial',
          x0: 0,
          y0: 0,
          r0: -1,
          x1: 0,
          y1: 0,
          r1: 1,
          extend,
          transform: IDENTITY,
        },
        stops: [
          { offset: 0, color: 'black' },
          { offset: 0.5, color: 'black' },
          { offset: 0.5, color: 'white' },
          { offset: 1, color: 'white' },
        ],
      }) as unknown as VectorGradient;
    for (const extend of ['pad', 'repeat'] as const) {
      const line = colourLineOf(duplicate(extend), colorOf);
      // At the tip both stops sit at 0: SVG paints just past 0 with the later one, white.
      const atZero = line?.stops.filter(({ offset }) => offset === 0) ?? [];
      expect(atZero.at(-1)?.rgba).toEqual(WHITE);
    }
  });

  it('paints nothing for a gradient without stops', () => {
    for (const extend of ['pad', 'repeat'] as const)
      expect(colourLineOf({ ...radial(-3, -1, extend), stops: [] }, colorOf)).toBeNull();
  });

  it('paints nothing for equal-offset stops that repeat or reflect, and steps there for pad', () => {
    expect(colourLineOf(linear('repeat', 0.5, 0.5), colorOf)).toBeNull();
    expect(colourLineOf(linear('reflect', 0.5, 0.5), colorOf)).toBeNull();
    const step = colourLineOf(linear('pad', 0.5, 0.5), colorOf);
    expect(step?.gradient).toMatchObject({ x0: 2, x1: 6 });
    expect(step?.stops.map(({ offset }) => offset)).toEqual([0, 0]);
  });

  it('keeps a line already over 0..1, multiplies stop alpha, and colours no stops as nothing', () => {
    const plain = linear('pad', 0, 1);
    expect(colourLineOf(plain, colorOf)?.gradient).toEqual(plain);
    const faded = {
      ...plain,
      stops: [{ offset: 0, color: 'black', alpha: 0.5 }],
    } as unknown as VectorGradient;
    expect(colourLineOf(faded, colorOf)?.stops[0]?.rgba[3]).toBe(0.5);
    expect(colourAtStops([], 0.5)).toEqual([0, 0, 0, 0]);
  });

  it('leaves a layer that paints nothing out of the SVG, and draws a cut cone exactly', () => {
    const layout = {
      text: 'a',
      runs: [],
      glyphs: [],
      lines: [],
      width: 0,
      height: 0,
    } as unknown as TextLayout;
    const layer = (gradient: VectorGradient) => ({
      d: 'M 0 0 Z',
      pdf: '',
      clips: [],
      groups: [],
      gradient,
    });
    const vector = {
      kind: 'layers',
      ...{ glyphId: 1, faceId: 'f', cluster: { start: 0, end: 1 }, d: '', pdf: '', fill: 'ink' },
      groups: [],
      layers: [layer(linear('repeat', 0.5, 0.5)), layer(radial(-1, 3, 'repeat'))],
    } as unknown as VectorGlyph;
    const { svg, warnings } = textSvg(layout, [vector], { colorOf, idPrefix: 'n' });
    expect(svg.match(/<path\b/g)).toHaveLength(1);
    expect(svg).toContain('fr="0"');
    expect(warnings).toEqual([]);
  });
});
