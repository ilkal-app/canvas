import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { meshJob } from '../paths/mesh-job.js';
import { BASE_TIER } from '../text/atlas/glyph-tiers.js';
import type { ColourCanvasFactory, ColourContext2d } from '../text/colour/colour-canvas.js';
import { layoutJob } from '../text/layout/layout-job.js';

import { createDefaultJobHandlers } from './default-job-handlers.js';
import { echoJob } from './echo-job.js';
import { framesJob } from './frames-job.js';
import { resourceContext } from './job-handlers.js';
import { createProductionJobHandlers } from './production-job-handlers.js';

describe('the job handler sets', () => {
  it('ships every real job kind and no echo; the default set adds echo for tests', () => {
    const shipped = createProductionJobHandlers();
    expect(Object.keys(shipped).sort()).toEqual([
      'decode',
      'frames',
      'glyphGeometry',
      'layout',
      'mesh',
      'msdf',
    ]);
    expect(shipped.layout).toBe(layoutJob);
    expect(shipped.mesh).toBe(meshJob);
    expect(shipped.frames).toBe(framesJob);
    const all = createDefaultJobHandlers();
    expect(Object.keys(all).sort()).toEqual([
      'decode',
      'echo',
      'frames',
      'glyphGeometry',
      'layout',
      'mesh',
      'msdf',
    ]);
    expect(all.echo).toBe(echoJob);
  });
});

it('gives the msdf job the colour canvas, on which a colour glyph is drawn', async () => {
  const sizes: number[][] = [];
  const context = new Proxy({} as ColourContext2d, {
    get: (target, name) => {
      if (name === 'getImageData') {
        return (x: number, y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
        });
      }
      if (name === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      return () => ({ addColorStop: () => undefined });
    },
    set: () => true,
  });
  const colourCanvas: ColourCanvasFactory = {
    create: (width, height) => {
      sizes.push([width, height]);
      return { width, height, getContext: () => context };
    },
    decodePng: () => Promise.resolve({}),
  };
  const font = new URL(
    '../../../text/src/shaping/__fixtures__/color-fonts/test_glyphs-glyf_colr_1.ttf',
    import.meta.url,
  );
  const msdf = createProductionJobHandlers({ colourCanvas }).msdf;
  if (msdf === undefined) throw new Error('no msdf handler');
  const outcome = await msdf(
    {
      faceId: 'test-glyphs',
      fontKey: 'test-glyphs',
      fontBytes: new Uint8Array(readFileSync(font)).buffer,
      keys: [0xf0e01],
      tier: BASE_TIER,
      field: 'sdf',
    },
    resourceContext(new Map()),
  );
  expect(sizes.length).toBeGreaterThan(0);
  expect(outcome.response.glyphs.map(({ bitmap }) => bitmap.field)).toEqual(['colour']);
});
