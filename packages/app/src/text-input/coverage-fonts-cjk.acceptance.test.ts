/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { expect, it, vi } from 'vitest';

import { cjkSlices, parseFont } from '@canvas/text';

import { COVERAGE_FONT_FAMILIES } from './coverage-fonts.js';
import type { FontFamilyEntry } from './font-catalogue.js';

// In the coverage catalogue's order.
const FAMILIES = [
  ['Noto Sans SC', 'notosanssc'],
  ['Noto Sans JP', 'notosansjp'],
  ['Noto Sans KR', 'notosanskr'],
  ['Noto Sans HK', 'notosanshk'],
  ['Noto Sans TC', 'notosanstc'],
] as const;

it('lists every real CJK cmap slice in order at both weights and replaces whole faces', async () => {
  const module = await vi.importActual<Record<string, unknown>>('./coverage-fonts-cjk.js');
  const generatedFamilies = module.CJK_SLICE_FONT_FAMILIES as readonly FontFamilyEntry[];
  expect(generatedFamilies.map(({ family }) => family)).toEqual(FAMILIES.map(([family]) => family));
  for (const [family, slug] of FAMILIES) {
    const expected = ([400, 700] as const).flatMap((weight) => {
      const bytes = readFileSync(
        new URL(
          `../../assets/fonts/script-coverage/${slug}/${String(weight)}.ttf`,
          import.meta.url,
        ),
      );
      const points = parseFont(bytes)
        .characterMap()
        .map(([point]) => point);
      return [...cjkSlices(family, points).keys()].map((id) => ({
        family,
        weight,
        isItalic: false,
        postScriptName: `cjk-slice:${id}`,
        url: new URL(
          `../../assets/fonts/cjk/${slug.replace(/^notosans/u, '')}/${String(weight)}-${id}.ttf?no-inline`,
          import.meta.url,
        ).href,
      }));
    });
    const entry = generatedFamilies.find((candidate) => candidate.family === family);
    expect(entry).toEqual({ family, category: 'sans', faces: expected });
    expect(COVERAGE_FONT_FAMILIES.filter((candidate) => candidate.family === family)).toEqual([
      entry,
    ]);
  }
}, 60_000);
