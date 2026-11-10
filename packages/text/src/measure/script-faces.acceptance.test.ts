/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';
import {
  bundledFontFile,
  COVERAGE_FONT_FILES,
  coverageFontFile,
  coverageMeasureRuns,
  createFontMetrics,
  createTextShaping,
  layoutText,
  loadShaper,
  measureText,
  measuringFontsFor,
  missingGlyphs,
  parseFont,
  scriptCoverageFamilies,
  SCRIPT_COVERAGE_FAMILIES,
  serverCoverageFamilies,
  serverCoverageFontFilePaths,
  type FontFaceKey,
  type SyncFontBytesSource,
} from '@canvas/text';

import { SCRIPT_FALLBACKS } from '../script/fallback-families.js';
import { scriptOf } from '../script/script-table.js';

const ROOT = new URL('../../../../', import.meta.url);
const CATALOGUE = JSON.parse(
  readFileSync(new URL('packages/app/assets/fonts/script-coverage/catalogue.json', ROOT), 'utf8'),
) as {
  entries: readonly {
    family: string;
    faces: readonly { weight: 400 | 700; isItalic: boolean; url: string }[];
  }[];
};
const STYLE: TextStyle = {
  fontFamily: 'Liberation Sans',
  fontSize: 20,
  color: 'ink',
  weight: 400,
  italic: false,
};
const runsOf = (text: string): StyleRun[] => [{ length: text.length, style: STYLE }];
const source: SyncFontBytesSource = {
  bytesOf: (face) => {
    const path = coverageFontFile(face) ?? bundledFontFile(face);
    return path === undefined ? undefined : readFileSync(new URL(path, ROOT));
  },
};
const samples = ['مرحبا بالعالم', 'नमस्ते दुनिया', 'สวัสดีชาวโลก'];

describe('server script faces', () => {
  it('indexes every catalogue face by its repo path and excludes only Han folders from the server', () => {
    const expected = CATALOGUE.entries.flatMap(({ family, faces }) =>
      faces.map(
        ({ weight, isItalic, url }) =>
          [family, weight, isItalic, `packages/app/assets/fonts/script-coverage/${url}`] as const,
      ),
    );
    expect([...COVERAGE_FONT_FILES].sort()).toEqual([...expected].sort());
    for (const [family, weight, isItalic, path] of expected) {
      const face: FontFaceKey = { family, weight, isItalic };
      expect(coverageFontFile(face)).toBe(path);
    }
    expect(
      coverageFontFile({ family: 'No such face', weight: 400, isItalic: false }),
    ).toBeUndefined();
    const han = new Set([
      'Noto Sans SC',
      'Noto Sans TC',
      'Noto Sans HK',
      'Noto Sans JP',
      'Noto Sans KR',
    ]);
    expect([...serverCoverageFamilies()].sort()).toEqual(
      SCRIPT_COVERAGE_FAMILIES.filter((family) => !han.has(family)).sort(),
    );
    expect([...serverCoverageFontFilePaths()].sort()).toEqual(
      expected
        .filter(([family]) => SCRIPT_COVERAGE_FAMILIES.includes(family) && !han.has(family))
        .map(([, , , path]) => path)
        .sort(),
    );
  });

  it.each(samples)('measures %s at the app layout size with real shaped faces', async (text) => {
    const runs = runsOf(text);
    const { fonts, unmeasuredFamilies } = measuringFontsFor([runs], {
      texts: [text],
      coverage: source,
    });
    expect(unmeasuredFamilies).toEqual([]);
    const family = scriptCoverageFamilies(text, runs)[0];
    expect(fonts.some(({ face }) => face.family === family)).toBe(true);
    const shaping = createTextShaping(await loadShaper(), source).measurerFor(fonts);
    const actual = measureText(text, runs, null, fonts, shaping);
    const selected = fonts.filter(
      ({ face }) => face.family === 'Liberation Sans' || face.family === family,
    );
    const handBuilt = selected.map(({ face }) => {
      const path = coverageFontFile(face) ?? bundledFontFile(face);
      if (path === undefined) throw new Error(`No file for ${face.family}`);
      const bytes = readFileSync(new URL(path, ROOT));
      return { metrics: createFontMetrics(face, parseFont(bytes)), bytes };
    });
    const appMeasurer = createTextShaping(await loadShaper(), {
      bytesOf: (face) =>
        handBuilt.find(
          ({ metrics }) =>
            metrics.face.family === face.family &&
            metrics.face.weight === face.weight &&
            metrics.face.isItalic === face.isItalic,
        )?.bytes,
    }).measurerFor(handBuilt.map(({ metrics }) => metrics));
    const expected = layoutText(
      text,
      coverageMeasureRuns(
        text,
        runs,
        handBuilt.map(({ metrics }) => metrics),
      ),
      null,
      appMeasurer,
    );
    expect(actual).toEqual({
      width: expected.width,
      height: expected.height,
      lineCount: expected.lines.length,
    });
    expect(actual.width).not.toBeCloseTo(
      measureText(text, runs, null, measuringFontsFor([runs]).fonts).width,
      6,
    );
  });

  it('has a drawn sample for each deployed script family', () => {
    const byFamily = new Map<string, string>();
    const parsed = new Map<string, ReturnType<typeof parseFont>>();
    for (
      let point = 0;
      point < 0x40000 && byFamily.size < serverCoverageFamilies().length;
      point += 1
    ) {
      const family = SCRIPT_FALLBACKS.find(([script]) => script === scriptOf(point))?.[1];
      if (
        family !== undefined &&
        serverCoverageFamilies().includes(family) &&
        !byFamily.has(family)
      ) {
        const path = CATALOGUE.entries.find((entry) => entry.family === family)?.faces[0]?.url;
        if (path !== undefined && !parsed.has(family)) {
          parsed.set(
            family,
            parseFont(
              readFileSync(new URL(`packages/app/assets/fonts/script-coverage/${path}`, ROOT)),
            ),
          );
        }
        if ((parsed.get(family)?.glyphIdOf(point) ?? 0) !== 0) {
          byFamily.set(family, String.fromCodePoint(point));
        }
      }
    }
    expect([...byFamily.keys()].sort()).toEqual([...serverCoverageFamilies()].sort());
    for (const [family, text] of byFamily) {
      const runs = runsOf(text);
      const { fonts, unmeasuredFamilies } = measuringFontsFor([runs], {
        texts: [text],
        coverage: source,
      });
      expect(unmeasuredFamilies, family).toEqual([]);
      expect(missingGlyphs(text, runs, fonts), family).toEqual([]);
    }
  }, 60_000);

  it('reports an unavailable family once, and keeps the no-options report empty', () => {
    const text = 'مرحبا بالعالم';
    const runs = runsOf(text);
    const withoutArabic: SyncFontBytesSource = {
      bytesOf: (face) => (face.family === 'Noto Sans Arabic' ? undefined : source.bytesOf(face)),
    };
    const result = measuringFontsFor([runs, runs], {
      texts: [text, text],
      coverage: withoutArabic,
    });
    expect(result.unmeasuredFamilies).toEqual(['Noto Sans Arabic']);
    expect(result.fonts.some(({ face }) => face.family === 'Noto Sans Arabic')).toBe(false);
    expect(measuringFontsFor([runs]).unmeasuredFamilies).toEqual([]);
  });
});
