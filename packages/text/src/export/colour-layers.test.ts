// colourLayers: every paint op of a colour program, under transforms and clips.
import { describe, expect, it } from 'vitest';

import type { GlyphOutline } from '../font/glyph-outline.js';
import type { ColourGlyphOp, ColourGlyphRgba } from '../shaping/colour-glyph.js';

import { colourLayers } from './colour-layers.js';
import { IDENTITY_AFFINE } from './glyph-path-data.js';

const SQUARE: GlyphOutline = {
  contours: [
    [
      { kind: 'line', x0: 0, y0: 0, x1: 1, y1: 0 },
      { kind: 'line', x0: 1, y0: 0, x1: 1, y1: 1 },
      { kind: 'line', x0: 1, y0: 1, x1: 0, y1: 0 },
    ],
  ],
};
const RED: ColourGlyphRgba = { r: 1, g: 0, b: 0, a: 1 };
const INK: [number, number, number, number] = [0, 0, 1, 1];
const STOPS = [
  { offset: 0, color: RED, isForeground: false },
  { offset: 1, color: RED, isForeground: true },
];

/**
 * Replays ops at the identity placement with the ink colour.
 *
 * @param ops - The program's ops.
 * @returns The layers and image.
 */
function replay(ops: readonly ColourGlyphOp[]) {
  return colourLayers({ ops }, IDENTITY_AFFINE, INK);
}

describe('colourLayers', () => {
  it('paints a solid under a transform, and a foreground solid in the run colour', () => {
    const { layers } = replay([
      { op: 'push-transform', xx: 2, yx: 0, xy: 0, yy: 2, dx: 1, dy: 0 },
      { op: 'push-clip-glyph', outline: SQUARE },
      { op: 'solid', color: RED, isForeground: false },
      { op: 'solid', color: { ...RED, a: 0.5 }, isForeground: true },
      { op: 'pop-clip' },
      { op: 'pop-transform' },
      { op: 'pop-transform' },
    ]);
    const region = { d: 'M 1 0 L 3 0 L 3 2 L 1 0 Z', pdf: '1 0 m 3 0 l 3 2 l 1 0 l h' };
    expect(layers).toEqual([
      { ...region, clips: [], fill: RED, groups: [] },
      { ...region, clips: [], fill: INK, fillAlpha: 0.5, groups: [] },
    ]);
  });

  it('paints nothing without a clip, and cuts an inner glyph clip by an outer rectangle', () => {
    const rect = { d: 'M 0 0 L 2 0 L 2 1 L 0 1 L 0 0 Z', pdf: '0 0 m 2 0 l 2 1 l 0 1 l 0 0 l h' };
    const { layers } = replay([
      { op: 'solid', color: RED, isForeground: false },
      { op: 'push-clip-rect', xMin: 0, yMin: 0, xMax: 2, yMax: 1 },
      { op: 'solid', color: RED, isForeground: false },
      { op: 'push-clip-glyph', outline: SQUARE },
      { op: 'solid', color: RED, isForeground: false },
      { op: 'pop-clip' },
      { op: 'pop-clip' },
    ]);
    expect(layers).toEqual([
      { ...rect, clips: [], fill: RED, groups: [] },
      {
        ...{ d: 'M 0 0 L 1 0 L 1 1 L 0 0 Z', pdf: '0 0 m 1 0 l 1 1 l 0 0 l h' },
        ...{ clips: [rect], fill: RED, groups: [] },
      },
    ]);
  });

  it('keeps the groups a layer is painted in, with each group’s composite mode', () => {
    const { layers, groups } = replay([
      { op: 'push-clip-glyph', outline: SQUARE },
      { op: 'push-group' },
      { op: 'solid', color: RED, isForeground: false },
      { op: 'push-group' },
      { op: 'solid', color: RED, isForeground: false },
      { op: 'pop-group', mode: 'multiply' },
      { op: 'pop-group', mode: 'src-in' },
      { op: 'pop-group', mode: 'xor' },
      { op: 'solid', color: RED, isForeground: false },
    ]);
    expect(groups).toEqual([
      { mode: 'src-in', parent: null },
      { mode: 'multiply', parent: 0 },
    ]);
    expect(layers.map((layer) => layer.groups)).toEqual([[0], [0, 1], []]);
  });

  it('folds the rotation point into a linear end, and keeps p1 when p2 is p0', () => {
    const linear = (x2: number, y2: number): ColourGlyphOp => ({
      op: 'linear',
      ...{ x0: 0, y0: 0, x1: 1, y1: 1, x2, y2, extend: 'pad', stops: STOPS },
    });
    const { layers } = replay([
      { op: 'push-clip-glyph', outline: SQUARE },
      linear(0, 1),
      linear(0, 0),
    ]);
    expect(layers[0]?.gradient).toMatchObject({ kind: 'linear', x0: 0, y0: 0, x1: 1, y1: 0 });
    expect(layers[0]?.gradient?.stops).toEqual([
      { offset: 0, color: RED },
      { offset: 1, color: INK, alpha: 1 },
    ]);
    expect(layers[1]?.gradient).toMatchObject({ kind: 'linear', x1: 1, y1: 1 });
  });

  it('exports radial and sweep gradients with their placement', () => {
    const { layers } = replay([
      { op: 'push-clip-glyph', outline: SQUARE },
      { op: 'push-group' },
      {
        op: 'radial',
        ...{ x0: 0, y0: 0, r0: 0, x1: 1, y1: 1, r1: 2, extend: 'repeat', stops: STOPS },
      },
      {
        op: 'sweep',
        ...{ x0: 0.5, y0: 0.5, startAngle: 0, endAngle: Math.PI, extend: 'reflect', stops: STOPS },
      },
      { op: 'pop-group', mode: 'multiply' },
    ]);
    expect(layers.map(({ gradient }) => gradient?.kind)).toEqual(['radial', 'sweep']);
    expect(layers[0]?.gradient).toMatchObject({
      r1: 2,
      extend: 'repeat',
      transform: IDENTITY_AFFINE,
    });
    expect(layers[1]?.gradient).toMatchObject({ endAngle: Math.PI, extend: 'reflect' });
  });

  it('places the first bitmap under its transform, PNG or BGRA', () => {
    const image = (format: 'png' | 'bgra'): ColourGlyphOp => ({
      op: 'image',
      ...{
        format,
        bytes: Uint8Array.of(1),
        width: 4,
        height: 2,
        xMin: 0,
        yMin: 0,
        xMax: 2,
        yMax: 1,
      },
    });
    const first = replay([
      { op: 'push-transform', xx: 1, yx: 0, xy: 0, yy: -1, dx: 3, dy: 0 },
      image('bgra'),
      image('png'),
    ]);
    expect(first.layers).toEqual([]);
    expect(first.image).toEqual({
      bgra: Uint8Array.of(1),
      ...{ pixelWidth: 4, pixelHeight: 2, x: 3, y: -1, width: 2, height: 1 },
    });
    expect(replay([image('png')]).image).toMatchObject({ png: Uint8Array.of(1), x: 0, y: 0 });
  });
});
