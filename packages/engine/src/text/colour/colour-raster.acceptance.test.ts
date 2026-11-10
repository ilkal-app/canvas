import { describe, expect, it } from 'vitest';

import type { ColourGlyphProgram } from '@canvas/text';

import { GLYPH_PADDING_PX } from '../atlas/glyph-bitmap.js';
import { BASE_TIER } from '../atlas/glyph-tiers.js';

import type { ColourCanvas, ColourCanvasFactory, ColourContext2d } from './colour-canvas.js';
import { rasterColourGlyph } from './colour-raster.js';

type Call = readonly [string, ...unknown[]];

class RecordingCanvas implements ColourCanvas {
  readonly calls: Call[] = [];
  readonly width: number;
  readonly height: number;
  readonly context: ColourContext2d;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const calls = this.calls;
    let fillStyle: unknown;
    let composite = 'source-over';
    let transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const gradient = (kind: string, args: number[]) => {
      calls.push([kind, ...args]);
      return {
        addColorStop: (offset: number, color: string) => calls.push(['stop', offset, color]),
      };
    };
    this.context = {
      save: () => calls.push(['save']),
      restore: () => calls.push(['restore']),
      transform: (...args: [number, number, number, number, number, number]) =>
        calls.push(['transform', ...args]),
      setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
        transform = { a, b, c, d, e, f };
        calls.push(['setTransform', a, b, c, d, e, f]);
      },
      getTransform: () => transform,
      beginPath: () => calls.push(['beginPath']),
      moveTo: (...args: [number, number]) => calls.push(['moveTo', ...args]),
      lineTo: (...args: [number, number]) => calls.push(['lineTo', ...args]),
      quadraticCurveTo: (...args: [number, number, number, number]) =>
        calls.push(['quadraticCurveTo', ...args]),
      bezierCurveTo: (...args: [number, number, number, number, number, number]) =>
        calls.push(['bezierCurveTo', ...args]),
      closePath: () => calls.push(['closePath']),
      rect: (...args: [number, number, number, number]) => calls.push(['rect', ...args]),
      clip: (rule: 'nonzero') => calls.push(['clip', rule]),
      fillRect: (...args: [number, number, number, number]) => calls.push(['fillRect', ...args]),
      clearRect: (...args: [number, number, number, number]) => calls.push(['clearRect', ...args]),
      get fillStyle() {
        return fillStyle;
      },
      set fillStyle(value) {
        fillStyle = value;
        calls.push(['fillStyle', value]);
      },
      get globalCompositeOperation() {
        return composite;
      },
      set globalCompositeOperation(value) {
        composite = value;
        calls.push(['composite', value]);
      },
      createLinearGradient: (...args: [number, number, number, number]) => gradient('linear', args),
      createRadialGradient: (...args: [number, number, number, number, number, number]) =>
        gradient('radial', args),
      createConicGradient: (...args: [number, number, number]) => gradient('conic', args),
      drawImage: (...args: [unknown, number, number, number?, number?]) =>
        calls.push(['drawImage', ...args]),
      createImageData: (w: number, h: number) => {
        calls.push(['createImageData', w, h]);
        return { data: new Uint8ClampedArray(w * h * 4) };
      },
      putImageData: (image: unknown, dx: number, dy: number) =>
        calls.push(['putImageData', image, dx, dy]),
      getImageData: (x: number, y: number, w: number, h: number) => {
        calls.push(['getImageData', x, y, w, h]);
        const data = new Uint8ClampedArray(w * h * 4);
        data.set([255, 0, 0, 128, 0, 200, 100, 255]);
        return { data };
      },
    };
  }

  getContext(): ColourContext2d | null {
    return this.context;
  }
}

class RecordingFactory implements ColourCanvasFactory {
  readonly canvases: RecordingCanvas[] = [];
  readonly decoded: Uint8Array[] = [];
  readonly image = { decoded: true };

  create(width: number, height: number): ColourCanvas {
    const canvas = new RecordingCanvas(width, height);
    this.canvases.push(canvas);
    return canvas;
  }

  decodePng(bytes: Uint8Array): Promise<unknown> {
    this.decoded.push(bytes);
    return Promise.resolve(this.image);
  }
}

const box = { xMin: -0.25, yMin: -0.5, xMax: 0.75, yMax: 1 };
const red = { r: 1, g: 0, b: 0, a: 0.5 };
const blue = { r: 0, g: 0, b: 1, a: 1 };
const stops = [
  { offset: 0, color: red, isForeground: false },
  { offset: 1, color: blue, isForeground: false },
] as const;

async function raster(ops: ColourGlyphProgram['ops'], canvas = new RecordingFactory()) {
  const bitmap = await rasterColourGlyph({ ops }, { canvas, tier: BASE_TIER, box });
  return { bitmap, canvas };
}

describe('colour glyph canvas raster', () => {
  it('places the em box with padding, flips y, and premultiplies straight canvas pixels', async () => {
    const { bitmap, canvas } = await raster([{ op: 'solid', color: red, isForeground: false }]);
    const width = Math.ceil((box.xMax - box.xMin) * BASE_TIER) + 2 * GLYPH_PADDING_PX;
    const height = Math.ceil((box.yMax - box.yMin) * BASE_TIER) + 2 * GLYPH_PADDING_PX;
    expect(bitmap).toMatchObject({
      field: 'colour',
      width,
      height,
      left: box.xMin * BASE_TIER - GLYPH_PADDING_PX,
      top: box.yMax * BASE_TIER + GLYPH_PADDING_PX,
    });
    expect(bitmap.pixels).toHaveLength(width * height * 4);
    expect([...bitmap.pixels.slice(0, 8)]).toEqual([128, 0, 0, 128, 0, 200, 100, 255]);
    expect(canvas.canvases[0]?.calls).toContainEqual([
      'setTransform',
      BASE_TIER,
      0,
      0,
      -BASE_TIER,
      GLYPH_PADDING_PX - box.xMin * BASE_TIER,
      GLYPH_PADDING_PX + box.yMax * BASE_TIER,
    ]);
    expect(canvas.canvases[0]?.calls).toContainEqual([
      'fillStyle',
      expect.stringMatching(/^rgba\(255,\s*0,\s*0,\s*0\.5\)$/),
    ]);
    expect(canvas.canvases[0]?.calls.some(([name]) => name === 'fillRect')).toBe(true);
  });

  it('replays transforms and nonzero outline and rectangle clips in order', async () => {
    const outline = {
      contours: [
        [
          { kind: 'line', x0: 0, y0: 0, x1: 1, y1: 0 },
          { kind: 'quadratic', x0: 1, y0: 0, cx: 1, cy: 1, x1: 0, y1: 1 },
          { kind: 'cubic', x0: 0, y0: 1, c1x: -1, c1y: 1, c2x: -1, c2y: 0, x1: 0, y1: 0 },
        ],
      ],
    } as const;
    const { canvas } = await raster([
      { op: 'push-transform', xx: 1, yx: 2, xy: 3, yy: 4, dx: 5, dy: 6 },
      { op: 'push-clip-glyph', outline },
      { op: 'push-clip-rect', xMin: 0, yMin: 0, xMax: 1, yMax: 2 },
      { op: 'solid', color: blue, isForeground: false },
      { op: 'pop-clip' },
      { op: 'pop-clip' },
      { op: 'pop-transform' },
    ]);
    const calls = canvas.canvases[0]?.calls ?? [];
    expect(calls).toContainEqual(['transform', 1, 2, 3, 4, 5, 6]);
    for (const call of [
      ['moveTo', 0, 0],
      ['lineTo', 1, 0],
      ['quadraticCurveTo', 1, 1, 0, 1],
      ['bezierCurveTo', -1, 1, -1, 0, 0, 0],
      ['rect', 0, 0, 1, 2],
    ])
      expect(calls).toContainEqual(call);
    expect(calls.filter(([name]) => name === 'save')).toHaveLength(3);
    expect(calls.filter(([name]) => name === 'restore')).toHaveLength(3);
    expect(calls.filter(([name]) => name === 'clip')).toEqual([
      ['clip', 'nonzero'],
      ['clip', 'nonzero'],
    ]);
  });

  it.each([
    [1, 0, 0, 1],
    [1, 1, 0, 1],
  ])(
    'projects a COLRv1 linear gradient onto its perpendicular colour line',
    async (x1, y1, x2, y2) => {
      const { canvas } = await raster([
        { op: 'linear', x0: 0, y0: 0, x1, y1, x2, y2, extend: 'pad', stops },
      ]);
      expect(canvas.canvases[0]?.calls).toContainEqual(['linear', 0, 0, 1, 0]);
      expect(canvas.canvases[0]?.calls.filter(([name]) => name === 'stop')).toHaveLength(2);
    },
  );

  it('paints a repeat linear gradient with too many periods per pixel through an image layer', async () => {
    const { bitmap, canvas } = await raster([
      { op: 'linear', x0: 0, y0: 0, x1: 0.0001, y1: 0, x2: 0, y2: 1, extend: 'repeat', stops },
    ]);
    expect(canvas.canvases).toHaveLength(2);
    const glyph = canvas.canvases[0];
    const layer = canvas.canvases[1];
    expect(layer?.width).toBe(bitmap.width);
    expect(layer?.height).toBe(bitmap.height);
    expect(layer?.calls).toContainEqual(['createImageData', bitmap.width, bitmap.height]);
    expect(
      layer?.calls.some(([name, , dx, dy]) => name === 'putImageData' && dx === 0 && dy === 0),
    ).toBe(true);
    expect(glyph?.calls).toContainEqual(['drawImage', layer, 0, 0]);
    const drawIndex = glyph?.calls.findIndex(([name]) => name === 'drawImage') ?? -1;
    expect(glyph?.calls[drawIndex - 1]).toEqual(['setTransform', 1, 0, 0, 1, 0, 0]);
    expect(glyph?.calls.some(([name]) => name === 'linear')).toBe(false);
  });

  it('creates radial and sweep gradients and tiles repeat and reflect stops', async () => {
    const radialOp = {
      op: 'radial',
      x0: 0,
      y0: 0,
      r0: 0.2,
      x1: 1,
      y1: 1,
      r1: 0.8,
      extend: 'repeat',
      stops,
    } as const;
    const radial = await raster([radialOp]);
    const paddedRadial = await raster([{ ...radialOp, extend: 'pad' }]);
    const sweep = await raster([
      { op: 'sweep', x0: 0.5, y0: 0.25, startAngle: 0.3, endAngle: 2, extend: 'reflect', stops },
    ]);
    const radialCall = radial.canvas.canvases[0]?.calls.find(([name]) => name === 'radial');
    expect(radialCall).toHaveLength(7);
    const [, x0, y0, r0, x1, y1, r1] = radialCall as [
      string,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const t0 = (x0 - radialOp.x0) / (radialOp.x1 - radialOp.x0);
    const t1 = (x1 - radialOp.x0) / (radialOp.x1 - radialOp.x0);
    expect(t0).toBeLessThanOrEqual(0);
    expect(t1).toBeGreaterThanOrEqual(1);
    expect(t1 - t0).toBeGreaterThan(1);
    expect(radialOp.r0 + (radialOp.r1 - radialOp.r0) * t0).toBeGreaterThanOrEqual(0);
    expect(x0).toBeCloseTo(radialOp.x0 + (radialOp.x1 - radialOp.x0) * t0, 9);
    expect(y0).toBeCloseTo(radialOp.y0 + (radialOp.y1 - radialOp.y0) * t0, 9);
    expect(r0).toBeCloseTo(Math.max(0, radialOp.r0 + (radialOp.r1 - radialOp.r0) * t0), 9);
    expect(x1).toBeCloseTo(radialOp.x0 + (radialOp.x1 - radialOp.x0) * t1, 9);
    expect(y1).toBeCloseTo(radialOp.y0 + (radialOp.y1 - radialOp.y0) * t1, 9);
    expect(r1).toBeCloseTo(Math.max(0, radialOp.r0 + (radialOp.r1 - radialOp.r0) * t1), 9);
    expect(paddedRadial.canvas.canvases[0]?.calls).toContainEqual(['radial', 0, 0, 0.2, 1, 1, 0.8]);
    expect(sweep.canvas.canvases[0]?.calls).toContainEqual(['conic', 0.3, 0.5, 0.25]);
    for (const { canvas } of [radial, sweep]) {
      expect(canvas.canvases[0]?.calls.filter(([name]) => name === 'stop').length).toBeGreaterThan(
        2,
      );
    }
  });

  it.each([
    ['src-over', 'source-over'],
    ['dest-over', 'destination-over'],
    ['src-in', 'source-in'],
    ['dest-in', 'destination-in'],
    ['src-out', 'source-out'],
    ['dest-out', 'destination-out'],
    ['src-atop', 'source-atop'],
    ['dest-atop', 'destination-atop'],
    ['xor', 'xor'],
    ['plus', 'lighter'],
    ['src', 'copy'],
    ['multiply', 'multiply'],
    ['screen', 'screen'],
    ['overlay', 'overlay'],
    ['darken', 'darken'],
    ['lighten', 'lighten'],
    ['color-dodge', 'color-dodge'],
    ['color-burn', 'color-burn'],
    ['hard-light', 'hard-light'],
    ['soft-light', 'soft-light'],
    ['difference', 'difference'],
    ['exclusion', 'exclusion'],
    ['hsl-hue', 'hue'],
    ['hsl-saturation', 'saturation'],
    ['hsl-color', 'color'],
    ['hsl-luminosity', 'luminosity'],
  ] as const)('composites a group in %s mode as %s', async (mode, canvasMode) => {
    const { canvas } = await raster([
      { op: 'push-group' },
      { op: 'solid', color: red, isForeground: false },
      { op: 'pop-group', mode },
    ]);
    expect(canvas.canvases).toHaveLength(2);
    expect(canvas.canvases[1]?.calls.some(([name]) => name === 'setTransform')).toBe(true);
    expect(canvas.canvases[0]?.calls).toContainEqual(['composite', canvasMode]);
    expect(canvas.canvases[0]?.calls).toContainEqual(['composite', 'source-over']);
    expect(canvas.canvases[0]?.calls.some(([name]) => name === 'drawImage')).toBe(true);
  });

  it('skips destination-only groups and clears for clear mode', async () => {
    const dest = await raster([
      { op: 'push-group' },
      { op: 'solid', color: red, isForeground: false },
      { op: 'pop-group', mode: 'dest' },
    ]);
    expect(dest.canvas.canvases[0]?.calls.some(([name]) => name === 'drawImage')).toBe(false);
    const clear = await raster([
      { op: 'push-group' },
      { op: 'solid', color: red, isForeground: false },
      { op: 'pop-group', mode: 'clear' },
    ]);
    expect(clear.canvas.canvases[0]?.calls.some(([name]) => name === 'clearRect')).toBe(true);
  });

  it('decodes a PNG once and draws it into its em box', async () => {
    const canvas = new RecordingFactory();
    const bytes = new Uint8Array([137, 80, 78, 71]);
    await raster(
      [
        {
          op: 'image',
          format: 'png',
          bytes,
          width: 2,
          height: 2,
          xMin: 0,
          yMin: -0.2,
          xMax: 0.5,
          yMax: 0.8,
        },
      ],
      canvas,
    );
    expect(canvas.decoded).toEqual([bytes]);
    expect(canvas.canvases[0]?.calls).toContainEqual(['drawImage', canvas.image, 0, -0.2, 0.5, 1]);
  });
});
