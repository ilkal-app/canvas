/// <reference types="node" />
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import type { FontFaceKey } from '../font/font-face.js';
import { fontFaceId } from '../font/font-face.js';
import { createFontMetrics } from '../font/font-metrics.js';
import { parseFont } from '../font/parse-font.js';
import * as textApi from '../index.js';
import { createMetricsMeasurer } from '../layout/glyph-measurer.js';
import { layoutText } from '../layout/layout-text.js';
import { loadShaper } from '../shaping/shaper.js';
import { createShapingMeasurer } from '../shaping/shaping-measurer.js';

import { coverageMeasureRuns } from './glyph-coverage.js';
import { measuringFontsFor, measureText } from './measure-text.js';

const REPO_ROOT = new URL('../../../../', import.meta.url);
const SIZE = 20;
const EB_GARAMOND: TextStyle = {
  fontFamily: 'EB Garamond',
  fontSize: SIZE,
  color: 'ink',
  weight: 400,
  italic: false,
};
const LIBERATION: TextStyle = { ...EB_GARAMOND, fontFamily: 'Liberation Sans' };

/** Reads bundled face files through the agent's injected source contract. */
class NodeFontBytesSource implements textApi.FontBytesSource {
  readonly calls = new Map<string, number>();

  async bytesOf(face: FontFaceKey): Promise<Uint8Array | undefined> {
    const id = fontFaceId(face);
    this.calls.set(id, (this.calls.get(id) ?? 0) + 1);
    const path = textApi.bundledFontFile(face);
    return path === undefined ? undefined : readFile(new URL(path, REPO_ROOT));
  }
}

/**
 * A single style run covering its text.
 *
 * @param text - The text.
 * @param style - Its style.
 * @returns The runs.
 */
function runsOf(text: string, style: TextStyle): StyleRun[] {
  return [{ length: text.length, style }];
}

/**
 * The measurement fields of a hand-built layout.
 *
 * @param layout - The layout.
 * @returns Its width, height and line count.
 */
function sizeOf(layout: ReturnType<typeof layoutText>) {
  return { width: layout.width, height: layout.height, lineCount: layout.lines.length };
}

/**
 * Builds a shaping measurer directly from known checked-in font files.
 *
 * @param files - The faces and their paths from the repository root.
 * @returns The measurer.
 */
async function handBuiltMeasurer(files: readonly { face: FontFaceKey; path: string }[]) {
  const fonts = await Promise.all(
    files.map(async ({ face, path }) => {
      const bytes = await readFile(new URL(path, REPO_ROOT));
      return { metrics: createFontMetrics(face, parseFont(bytes)), bytes };
    }),
  );
  return createShapingMeasurer(await loadShaper(), fonts);
}

describe('agent-side shaped text measurement', () => {
  it('maps every measuring face to an existing font file with exactly its bundled metrics', async () => {
    const runs = textApi.BUNDLED_FONT_FAMILIES.map((fontFamily) =>
      runsOf('a', { ...EB_GARAMOND, fontFamily }),
    );
    const source = new NodeFontBytesSource();
    for (const metrics of measuringFontsFor([runs.flat()]).fonts) {
      expect(textApi.bundledFontFile(metrics.face)).toBeDefined();
      const bytes = await source.bytesOf(metrics.face);
      expect(bytes).toBeDefined();
      if (bytes === undefined)
        throw new Error(`Missing bundled font file for ${metrics.face.family}`);
      expect(createFontMetrics(metrics.face, parseFont(bytes))).toEqual(metrics);
    }
    expect(
      textApi.bundledFontFile({ family: 'Unbundled Face', weight: 400, isItalic: false }),
    ).toBeUndefined();
  });

  it('prepares the same fonts and reports as measuringFontsFor, with a shaping measurer', async () => {
    const runSets = [
      runsOf('a', EB_GARAMOND),
      runsOf('b', { ...EB_GARAMOND, fontFamily: 'Comic Sans MS', weight: 500 }),
    ];
    const prepared = await textApi.prepareMeasuringFonts(runSets, new NodeFontBytesSource());
    const expected = measuringFontsFor(runSets);
    expect(prepared.fonts).toEqual(expected.fonts);
    expect(prepared.unknownFamilies).toEqual(expected.unknownFamilies);
    expect(prepared.weightFallbacks).toEqual(expected.weightFallbacks);
    expect(prepared.measurer.shape).toBeTypeOf('function');
  });

  it('shapes the ffi in EB Garamond office at 20 px instead of measuring codepoints', async () => {
    const text = 'office';
    const runs = runsOf(text, EB_GARAMOND);
    const handBuilt = await handBuiltMeasurer([
      {
        face: { family: 'EB Garamond', weight: 400, isItalic: false },
        path: 'packages/app/assets/fonts/library/ebgaramond/400.ttf',
      },
    ]);
    const expected = sizeOf(layoutText(text, runs, null, handBuilt, 'left'));
    const metricsOnly = measureText(text, runs, null, measuringFontsFor([runs]).fonts);
    expect(expected.width).not.toBeCloseTo(metricsOnly.width, 8);
    const prepared = await textApi.prepareMeasuringFonts([runs], new NodeFontBytesSource());
    const shaped = measureText(text, runs, null, prepared.fonts, prepared.measurer);
    expect(shaped).toEqual(expected);
    expect(shaped.width).not.toBeCloseTo(measureText(text, runs, null, prepared.fonts).width, 8);
  });

  it('shapes a math symbol in the coverage face when Liberation Sans lacks it', async () => {
    const text = 'a⋯b';
    const runs = runsOf(text, LIBERATION);
    const adjusted = coverageMeasureRuns(text, runs, measuringFontsFor([runs]).fonts);
    expect(adjusted.map(({ style }) => style.fontFamily)).toEqual([
      'Liberation Sans',
      'Noto Sans Math',
      'Liberation Sans',
    ]);
    const prepared = await textApi.prepareMeasuringFonts([runs], new NodeFontBytesSource());
    const handBuilt = await handBuiltMeasurer([
      {
        face: { family: 'Liberation Sans', weight: 400, isItalic: false },
        path: 'packages/engine/assets/fonts/LiberationSans-Regular.ttf',
      },
      {
        face: { family: 'Noto Sans Math', weight: 400, isItalic: false },
        path: 'packages/app/assets/fonts/script-coverage/notosansmath/400.ttf',
      },
    ]);
    expect(measureText(text, runs, null, prepared.fonts, prepared.measurer)).toEqual(
      sizeOf(layoutText(text, adjusted, null, handBuilt, 'left')),
    );
  });

  it('wraps two EB Garamond words at the same shaped width as layoutText', async () => {
    const text = 'office office';
    const runs = runsOf(text, EB_GARAMOND);
    const handBuilt = await handBuiltMeasurer([
      {
        face: { family: 'EB Garamond', weight: 400, isItalic: false },
        path: 'packages/app/assets/fonts/library/ebgaramond/400.ttf',
      },
    ]);
    const oneWordWidth = layoutText(
      'office',
      runsOf('office', EB_GARAMOND),
      null,
      handBuilt,
      'left',
    ).width;
    const twoWordWidth = layoutText(text, runs, null, handBuilt, 'left').width;
    const wrapWidth = (oneWordWidth + twoWordWidth) / 2;
    const expected = sizeOf(layoutText(text, runs, wrapWidth, handBuilt, 'left'));
    expect(expected.lineCount).toBe(2);
    const prepared = await textApi.prepareMeasuringFonts([runs], new NodeFontBytesSource());
    expect(measureText(text, runs, wrapWidth, prepared.fonts, prepared.measurer)).toEqual(expected);
  });

  it('reads each face once per source object across repeated preparations', async () => {
    const runs = runsOf('office', EB_GARAMOND);
    const source = new NodeFontBytesSource();
    await textApi.prepareMeasuringFonts([runs], source);
    const firstCalls = new Map(source.calls);
    expect(firstCalls.size).toBe(measuringFontsFor([runs]).fonts.length);
    expect([...firstCalls.values()].every((count) => count === 1)).toBe(true);
    await textApi.prepareMeasuringFonts([runs], source);
    expect(source.calls).toEqual(firstCalls);
    const secondSource = new NodeFontBytesSource();
    await textApi.prepareMeasuringFonts([runs], secondSource);
    expect(secondSource.calls).toEqual(firstCalls);
  });

  it('rejects with the family name when the source lacks a required face', async () => {
    const runs = runsOf('office', EB_GARAMOND);
    const source = new NodeFontBytesSource();
    const missing: textApi.FontBytesSource = {
      bytesOf: (face) =>
        face.family === 'EB Garamond' ? Promise.resolve(undefined) : source.bytesOf(face),
    };
    await expect(textApi.prepareMeasuringFonts([runs], missing)).rejects.toThrow(/EB Garamond/);
  });

  it('keeps the existing metrics result when no measurer is supplied', () => {
    const text = 'office office';
    const runs = runsOf(text, EB_GARAMOND);
    const { fonts } = measuringFontsFor([runs]);
    const wrapWidth = 75;
    const adjusted = coverageMeasureRuns(text, runs, fonts);
    expect(measureText(text, runs, wrapWidth, fonts)).toEqual(
      sizeOf(layoutText(text, adjusted, wrapWidth, createMetricsMeasurer(fonts), 'left')),
    );
  });
});
