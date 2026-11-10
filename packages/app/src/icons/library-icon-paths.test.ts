// The design Library's icons under the floating whiteboard chrome (the owner's design-fidelity
// rule): every entry is the Library's own vector (Icon draws them under the floating chrome:
// icon.test.tsx).
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ICON_PATHS, type IconName } from './icon-paths.js';
import { LIBRARY_ICON_PATHS } from './library-icon-paths.js';

/** One path of a Library drawing: its origin in the 20-unit box and its data as exported. */
interface LibraryPath {
  readonly at: readonly [number, number];
  readonly d: string;
}

/** The Library's export: each drawing's paths, and the app names each one stands for. */
interface LibraryExport {
  readonly mapping: Readonly<Record<string, readonly IconName[]>>;
  readonly drawings: Readonly<Record<string, readonly LibraryPath[]>>;
}

const LIBRARY = JSON.parse(
  readFileSync(new URL('__fixtures__/library-icons.json', import.meta.url), 'utf8'),
) as LibraryExport;

/**
 * A coordinate in the 16-unit box, two decimals at most, no trailing zeros.
 *
 * @param value - The coordinate.
 * @returns Its text.
 */
function coordinate(value: number): string {
  const text = String(Math.round(value * 100) / 100);
  return text === '-0' ? '0' : text;
}

/**
 * A Library drawing as one path in the icons' 16-unit box: each point moved by its path's origin
 * and scaled by 0.8. The export uses only M, L, C and Z, all absolute.
 *
 * @param paths - The drawing's paths.
 * @returns The path data.
 */
function toIconPath(paths: readonly LibraryPath[]): string {
  return paths
    .map(({ at, d }) =>
      (d.match(/[MLCZ][^MLCZ]*/g) ?? [])
        .map((segment) => {
          const numbers = segment.slice(1).match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
          const points = numbers.map((value, index) =>
            coordinate((Number(value) + (index % 2 === 0 ? at[0] : at[1])) * 0.8),
          );
          return segment.charAt(0) + points.join(' ');
        })
        .join(''),
    )
    .join('');
}

describe('LIBRARY_ICON_PATHS', () => {
  it('is the Library’s vector for every name the Library draws, and nothing else', () => {
    const expected: Partial<Record<IconName, string>> = {};
    for (const [drawing, names] of Object.entries(LIBRARY.mapping)) {
      const paths = LIBRARY.drawings[drawing];
      expect(paths, drawing).toBeDefined();
      for (const name of names) expected[name] = toIconPath(paths ?? []);
    }
    expect(LIBRARY_ICON_PATHS).toEqual(expected);
  });

  it('names only icons the app has', () => {
    for (const name of Object.keys(LIBRARY_ICON_PATHS)) expect(ICON_PATHS).toHaveProperty(name);
  });
});
