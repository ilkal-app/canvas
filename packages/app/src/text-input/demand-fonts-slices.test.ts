/// <reference types="node" />
// Loading a CJK family's slices — weights, failures and retries.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

import { FontLibrary } from '@canvas/engine';
import { cjkSliceFace, createSubsetter } from '@canvas/text';

import { DemandFonts } from './demand-fonts.js';
import type { FontFamilyEntry } from './font-catalogue.js';

const FAMILY = 'Noto Sans JP';

/**
 * A one-character JP font file, cut from the bundled face.
 *
 * @returns Its bytes.
 */
async function tinyFace(): Promise<ArrayBuffer> {
  const wasm = readFileSync(
    createRequire(import.meta.url).resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'),
  );
  const source = readFileSync(
    new URL('../../assets/fonts/script-coverage/notosansjp/400.ttf', import.meta.url),
  );
  return Uint8Array.from((await createSubsetter(wasm)).subset(source, [0x3042])).buffer;
}

const ENTRY: FontFamilyEntry = {
  family: FAMILY,
  category: 'sans',
  faces: ([400, 700] as const).map((weight) => ({
    ...cjkSliceFace({ family: FAMILY, weight, isItalic: false }, 'base'),
    url: `slice-${String(weight)}`,
  })),
};

describe('DemandFonts slices', () => {
  it('loads only the weights asked for', async () => {
    const bytes = await tinyFace();
    const fetchBytes = vi.fn<(url: string) => Promise<ArrayBuffer>>(() => Promise.resolve(bytes));
    const demand = new DemandFonts(new FontLibrary(), [ENTRY], fetchBytes);
    expect(await demand.ensureSlices(FAMILY, ['base'], { weights: [400] })).toBe(true);
    expect(fetchBytes.mock.calls.map(([url]) => url)).toEqual(['slice-400']);
    expect(demand.sliceStatus(FAMILY, ['base'], [400])).toBe('ready');
    expect(demand.sliceStatus(FAMILY, ['base'])).toBe('idle');
  });

  it('reports a failure, and loads again only when asked to retry', async () => {
    const bytes = await tinyFace();
    const fetchBytes = vi
      .fn<(url: string) => Promise<ArrayBuffer>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(bytes);
    const demand = new DemandFonts(new FontLibrary(), [ENTRY], fetchBytes);
    expect(await demand.ensureSlices(FAMILY, ['base'], { weights: [400] })).toBe(false);
    expect(demand.sliceStatus(FAMILY, ['base'], [400])).toBe('failed');
    expect(await demand.ensureSlices(FAMILY, ['base'], { weights: [400] })).toBe(false);
    expect(fetchBytes).toHaveBeenCalledTimes(1);
    expect(await demand.ensureSlices(FAMILY, ['base'], { weights: [400], shouldRetry: true })).toBe(
      true,
    );
    expect(demand.sliceStatus(FAMILY, ['base'], [400])).toBe('ready');
  });

  it('knows no slices of a family it lacks', () => {
    const demand = new DemandFonts(new FontLibrary(), [], vi.fn());
    expect(demand.sliceStatus('Noto Sans KR', ['base'])).toBe('missing');
  });

  it('loads only the base slice when the family is asked for as a whole', async () => {
    const bytes = await tinyFace();
    const entry: FontFamilyEntry = {
      ...ENTRY,
      faces: [
        ...ENTRY.faces,
        {
          ...cjkSliceFace({ family: FAMILY, weight: 400, isItalic: false }, 'han-0'),
          url: 'han-0-400',
        },
      ],
    };
    const fetchBytes = vi.fn<(url: string) => Promise<ArrayBuffer>>(() => Promise.resolve(bytes));
    const demand = new DemandFonts(new FontLibrary(), [entry], fetchBytes);
    expect(demand.status(FAMILY)).toBe('idle');
    expect(await demand.ensure(FAMILY)).toBe(true);
    expect(fetchBytes.mock.calls.map(([url]) => url).sort()).toEqual(['slice-400', 'slice-700']);
    expect(demand.status(FAMILY)).toBe('ready');
  });

  it('reads a family by the slices and weights asked for, not every weight', async () => {
    // The IME scenario waits on Noto Sans SC: typing asks for the regular slices only,
    // so the family must read ready once those land, not idle for want of its bold.
    const bytes = await tinyFace();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchBytes = vi.fn(async (url: string) => {
      if (url === 'slice-400') await gate;
      return bytes;
    });
    const demand = new DemandFonts(new FontLibrary(), [ENTRY], fetchBytes);
    expect(demand.status(FAMILY)).toBe('idle');
    const loading = demand.ensureSlices(FAMILY, ['base'], { weights: [400] });
    expect(demand.status(FAMILY)).toBe('loading');
    release();
    expect(await loading).toBe(true);
    expect(demand.status(FAMILY)).toBe('ready');
    expect(demand.sliceStatus(FAMILY, ['base'])).toBe('idle');
  });

  it('reads a family failed when a slice asked for failed', async () => {
    const demand = new DemandFonts(new FontLibrary(), [ENTRY], () =>
      Promise.reject(new Error('offline')),
    );
    expect(await demand.ensureSlices(FAMILY, ['base'], { weights: [700] })).toBe(false);
    expect(demand.status(FAMILY)).toBe('failed');
  });

  it('announces no change for slices already loaded', async () => {
    const bytes = await tinyFace();
    const demand = new DemandFonts(new FontLibrary(), [ENTRY], () => Promise.resolve(bytes));
    await demand.ensureSlices(FAMILY, ['base']);
    const listener = vi.fn();
    demand.subscribe(listener);
    expect(await demand.ensureSlices(FAMILY, ['base'])).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });
});
