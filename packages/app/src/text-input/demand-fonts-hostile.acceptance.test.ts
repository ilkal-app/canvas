import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { FontLibrary, fontFaceId } from '@canvas/engine';

import { DemandFonts } from './demand-fonts.js';

const source = readFileSync(
  new URL('../../../engine/assets/fonts/LiberationSans-Regular.ttf', import.meta.url),
);
const validBytes = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
const garbageBytes = new Uint8Array([0, 1, 2, 3]).buffer;

describe('installLocal with malformed files', () => {
  it('installs every readable face around bad files and publishes only those faces', () => {
    const fonts = new FontLibrary();
    const demand = new DemandFonts(fonts, []);
    const changed = vi.fn();
    demand.subscribe(changed);
    const first = { family: 'Local', weight: 400, isItalic: false } as const;
    const rejected = { family: 'Local', weight: 500, isItalic: false } as const;
    const last = { family: 'Local', weight: 700, isItalic: false } as const;

    demand.installLocal('Local', [
      { face: first, bytes: validBytes },
      { face: rejected, bytes: garbageBytes },
      { face: last, bytes: validBytes },
    ]);

    expect(fonts.faces.map(fontFaceId)).toEqual([fontFaceId(first), fontFaceId(last)]);
    expect(fonts.get(fontFaceId(first))).toBeDefined();
    expect(fonts.get(fontFaceId(rejected))).toBeUndefined();
    expect(fonts.get(fontFaceId(last))).toBeDefined();
    expect(demand.status('Local')).toBe('ready');
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('throws and leaves the family absent when every local file is malformed', () => {
    const fonts = new FontLibrary();
    const demand = new DemandFonts(fonts, []);
    const changed = vi.fn();
    demand.subscribe(changed);
    const first = { family: 'Broken', weight: 400, isItalic: false } as const;
    const second = { family: 'Broken', weight: 700, isItalic: false } as const;

    expect(() => {
      demand.installLocal('Broken', [
        { face: first, bytes: garbageBytes },
        { face: second, bytes: garbageBytes },
      ]);
    }).toThrow(Error);
    expect(fonts.faces).toEqual([]);
    expect(demand.status('Broken')).toBe('missing');
    expect(changed).not.toHaveBeenCalled();
  });
});
