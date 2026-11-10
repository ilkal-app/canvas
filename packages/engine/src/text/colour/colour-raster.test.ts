import { describe, expect, it } from 'vitest';

import type { ColourGlyphProgram } from '@canvas/text';

import { BASE_TIER } from '../atlas/glyph-tiers.js';

import type { ColourCanvasFactory, ColourContext2d } from './colour-canvas.js';
import { rasterColourGlyph } from './colour-raster.js';

const box = { xMin: 0, yMin: 0, xMax: 1, yMax: 1 };

/**
 * A factory whose contexts record the names of the methods called on them.
 *
 * @returns The factory and its calls.
 */
function recording(): { readonly canvas: ColourCanvasFactory; readonly calls: string[] } {
  const calls: string[] = [];
  const context = new Proxy({} as ColourContext2d, {
    get: (target, name) => {
      if (name === 'getImageData') {
        return (x: number, y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
        });
      }
      if (name === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (name === 'createImageData') {
        return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
      }
      return () => {
        calls.push(String(name));
        return { addColorStop: () => undefined };
      };
    },
    set: () => true,
  });
  const canvas: ColourCanvasFactory = {
    create: (width, height) => ({ width, height, getContext: () => context }),
    decodePng: () => Promise.resolve({}),
  };
  return { canvas, calls };
}

async function raster(ops: ColourGlyphProgram['ops'], canvas: ColourCanvasFactory) {
  return rasterColourGlyph({ ops }, { canvas, tier: BASE_TIER, box });
}

describe('rasterColourGlyph edge cases', () => {
  it('refuses a canvas without a 2D context', async () => {
    const canvas: ColourCanvasFactory = {
      create: (width, height) => ({ width, height, getContext: () => null }),
      decodePng: () => Promise.resolve({}),
    };
    await expect(raster([], canvas)).rejects.toThrow(/2D canvas/);
  });

  it('skips an empty contour of a clip outline', async () => {
    const { canvas, calls } = recording();
    await raster(
      [{ op: 'push-clip-glyph', outline: { contours: [[]] } }, { op: 'pop-clip' }],
      canvas,
    );
    expect(calls).not.toContain('moveTo');
    expect(calls).toContain('clip');
  });

  it('draws nothing for raw BGRA strike pixels, which it cannot decode', async () => {
    const { canvas, calls } = recording();
    await raster(
      [
        {
          op: 'image',
          format: 'bgra',
          bytes: new Uint8Array(4),
          width: 1,
          height: 1,
          xMin: 0,
          yMin: 0,
          xMax: 1,
          yMax: 1,
        },
      ],
      canvas,
    );
    expect(calls).not.toContain('drawImage');
  });

  it('pads with a canvas gradient, and paints a period too short for one pixel by pixel', async () => {
    const { canvas, calls } = recording();
    const line = [
      { offset: 0, color: { r: 1, g: 0, b: 0, a: 1 }, isForeground: false },
      { offset: 1, color: { r: 0, g: 0, b: 1, a: 1 }, isForeground: false },
    ];
    const short = { x0: 0, y0: 0, x1: 1e-4, y1: 0, x2: 0, y2: 1, stops: line } as const;
    await raster(
      [
        { op: 'linear', ...short, extend: 'pad' },
        { op: 'linear', ...short, extend: 'repeat' },
      ],
      canvas,
    );
    expect(calls.filter((name) => name === 'createLinearGradient')).toHaveLength(1);
    expect(calls).toContain('putImageData');
  });

  it('paints nothing for a radial gradient whose circles reach no pixel', async () => {
    const { canvas, calls } = recording();
    await raster(
      [
        {
          op: 'radial',
          x0: 50,
          y0: 50,
          r0: 0.1,
          x1: 50.5,
          y1: 50,
          r1: 0.1,
          extend: 'repeat',
          stops: [],
        },
      ],
      canvas,
    );
    expect(calls).not.toContain('createRadialGradient');
    expect(calls).not.toContain('fillRect');
  });

  it('ignores a group pop without its push', async () => {
    const { canvas, calls } = recording();
    await raster([{ op: 'pop-group', mode: 'src-over' }], canvas);
    expect(calls).not.toContain('drawImage');
  });
});
