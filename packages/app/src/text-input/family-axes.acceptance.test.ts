// Family axes come from the loaded upright 400 face and follow font revisions.
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { familyAxesOf } from './family-axes.js';

const variable = new Uint8Array(
  readFileSync(new URL('../../assets/fonts/library/intervariable/400.ttf', import.meta.url)),
);
const staticallySized = new Uint8Array(
  readFileSync(new URL('../../assets/fonts/library/inter/400.ttf', import.meta.url)),
);

/**
 * A copy of Inter Variable with its first fvar axis marked hidden.
 *
 * @returns The modified font bytes.
 * @throws {Error} When the bundled font has no fvar table.
 */
function withHiddenFirstAxis(): Uint8Array {
  const bytes = variable.slice();
  const view = new DataView(bytes.buffer);
  const tableCount = view.getUint16(4);
  for (let index = 0; index < tableCount; index += 1) {
    const entry = 12 + index * 16;
    if (String.fromCharCode(...bytes.subarray(entry, entry + 4)) !== 'fvar') continue;
    const table = view.getUint32(entry + 8);
    const firstAxis = table + view.getUint16(table + 4);
    view.setUint16(firstAxis + 16, view.getUint16(firstAxis + 16) | 1);
    return bytes;
  }
  throw new Error('Bundled Inter Variable has no fvar table');
}

describe('familyAxesOf', () => {
  it('is unavailable before face bytes load, then reads them after the revision changes', () => {
    let revision = 0;
    let isLoaded = false;
    const bytesOf = vi.fn(() => (isLoaded ? variable : undefined));
    const source = { bytesOf, revision: () => revision };
    expect(familyAxesOf('Loading family', source)).toBeUndefined();
    isLoaded = true;
    revision = 1;
    expect(familyAxesOf('Loading family', source)?.axes.map(({ tag }) => tag)).toEqual([
      'opsz',
      'wght',
    ]);
    expect(bytesOf).toHaveBeenCalledTimes(2);
  });

  it('reads the bundled variable face axes and its nine named instances', () => {
    const axes = familyAxesOf('Inter Variable', {
      bytesOf: () => variable,
      revision: () => 1,
    });
    expect(axes?.axes).toMatchObject([
      { tag: 'opsz', minimum: 14, default: 14, maximum: 32, isHidden: false },
      { tag: 'wght', minimum: 100, default: 400, maximum: 900, isHidden: false },
    ]);
    expect(axes?.instances).toHaveLength(9);
    expect(axes?.instances.map(({ name }) => name)).toContain('Regular');
    expect(axes?.instances.find(({ name }) => name === 'Bold')?.coordinates).toMatchObject({
      wght: 700,
    });
  });

  it('returns empty axes and instances for a loaded static family', () => {
    expect(
      familyAxesOf('Inter static', {
        bytesOf: () => staticallySized,
        revision: () => 1,
      }),
    ).toEqual({ axes: [], instances: [] });
  });

  it('retains a hidden axis and its fvar flag', () => {
    const axes = familyAxesOf('Inter with hidden opsz', {
      bytesOf: () => withHiddenFirstAxis(),
      revision: () => 1,
    });
    expect(axes?.axes).toHaveLength(2);
    expect(axes?.axes[0]).toMatchObject({ tag: 'opsz', isHidden: true });
    expect(axes?.axes[1]).toMatchObject({ tag: 'wght', isHidden: false });
  });

  it('caches each family at a revision and reads its face again when the revision changes', () => {
    let revision = 1;
    const bytesOf = vi.fn((family: string) =>
      family === 'Cached variable' ? variable : staticallySized,
    );
    const source = { bytesOf, revision: () => revision };
    const first = familyAxesOf('Cached variable', source);
    expect(familyAxesOf('Cached variable', source)).toBe(first);
    expect(bytesOf).toHaveBeenCalledTimes(1);
    expect(familyAxesOf('Cached static', source)).toEqual({ axes: [], instances: [] });
    expect(bytesOf).toHaveBeenCalledTimes(2);
    revision = 2;
    expect(familyAxesOf('Cached variable', source)).toEqual(first);
    expect(bytesOf).toHaveBeenCalledTimes(3);
  });
});
