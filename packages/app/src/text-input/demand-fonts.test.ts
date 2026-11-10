import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { FontLibrary } from '@canvas/engine';

import { DemandFonts } from './demand-fonts.js';

const bytes = readFileSync(
  new URL('../../../engine/assets/fonts/LiberationSans-Regular.ttf', import.meta.url),
);
const source = { family: 'Example', weight: 400, isItalic: false, url: '/example.ttf' } as const;
const entry = { family: 'Example', category: 'sans', faces: [source] } as const;

describe('on-demand font loading', () => {
  it('fetches nothing until requested, coalesces concurrent requests, and announces ready faces', async () => {
    const fetchBytes = vi.fn(() => Promise.resolve(new Uint8Array(bytes).buffer));
    const fonts = new FontLibrary();
    const demand = new DemandFonts(fonts, [entry], fetchBytes);
    const changed = vi.fn();
    const stop = demand.subscribe(changed);
    expect(fetchBytes).not.toHaveBeenCalled();
    expect(demand.status('Example')).toBe('idle');
    await Promise.all([demand.ensure('Example'), demand.ensure('Example')]);
    expect(fetchBytes).toHaveBeenCalledTimes(1);
    expect(fonts.resolve(source)?.face.family).toBe('Example');
    expect(demand.status('Example')).toBe('ready');
    expect(changed).toHaveBeenCalled();
    stop();
    changed.mockClear();
    await demand.ensure('Example');
    expect(changed).not.toHaveBeenCalled();
  });

  it('retains fallback after failure, allows explicit retry, and refuses unknown families', async () => {
    const fonts = new FontLibrary();
    fonts.addFace(
      { ...source, family: 'Fallback' },
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const fetchBytes = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const demand = new DemandFonts(fonts, [entry], fetchBytes);
    expect(await demand.ensure('Example')).toBe(false);
    expect(demand.status('Example')).toBe('failed');
    expect(fonts.resolve(source)?.face.family).toBe('Fallback');
    expect(await demand.ensure('Example')).toBe(false);
    expect(fetchBytes).toHaveBeenCalledTimes(1);
    expect(await demand.ensure('Unknown')).toBe(false);
    expect(await demand.ensure('Example', true)).toBe(true);
  });
});
