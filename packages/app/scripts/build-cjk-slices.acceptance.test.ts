/// <reference types="node" />
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { cjkSlices, parseFont } from '@canvas/text';

const FAMILIES = [
  ['Noto Sans SC', 'notosanssc'],
  ['Noto Sans TC', 'notosanstc'],
  ['Noto Sans HK', 'notosanshk'],
  ['Noto Sans JP', 'notosansjp'],
  ['Noto Sans KR', 'notosanskr'],
] as const;

it('builds every face slice exactly once and skips all unchanged faces on a second run', async () => {
  const script = await vi.importActual<{
    buildCjkSliceFiles(outDir?: string): Promise<{ written: number; skipped: number }>;
  }>('./build-cjk-slices.js');
  const output = mkdtempSync(join(tmpdir(), 'viv-514-s3b-'));
  try {
    let count = 0;
    for (const [family, slug] of FAMILIES) {
      for (const weight of [400, 700] as const) {
        const source = readFileSync(
          new URL(`../assets/fonts/script-coverage/${slug}/${String(weight)}.ttf`, import.meta.url),
        );
        count += cjkSlices(
          family,
          parseFont(source)
            .characterMap()
            .map(([point]) => point),
        ).size;
      }
    }
    expect(await script.buildCjkSliceFiles(output)).toMatchObject({ written: count });
    for (const [family, slug] of FAMILIES) {
      for (const weight of [400, 700] as const) {
        const source = readFileSync(
          new URL(`../assets/fonts/script-coverage/${slug}/${String(weight)}.ttf`, import.meta.url),
        );
        const expected = cjkSlices(
          family,
          parseFont(source)
            .characterMap()
            .map(([point]) => point),
        );
        const actual = new Set<number>();
        for (const [id, points] of expected) {
          // Each face's slices go in a short folder (sc, tc, hk, jp, kr).
          const path = join(output, slug.replace(/^notosans/u, ''), `${String(weight)}-${id}.ttf`);
          expect(existsSync(path), path).toBe(true);
          const mapped = parseFont(readFileSync(path))
            .characterMap()
            .map(([point]) => point);
          expect(mapped, path).toEqual(points);
          for (const point of mapped) actual.add(point);
        }
        expect([...actual].sort((a, b) => a - b)).toEqual(
          [...expected.values()].flat().sort((a, b) => a - b),
        );
      }
    }
    expect(await script.buildCjkSliceFiles(output)).toMatchObject({ written: 0, skipped: 10 });
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}, 60_000);
