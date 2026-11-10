// Agents measure text (MCP `create_objects` and `measure_text`) with @canvas/text's
// generated tables of the bundled fonts, and, since, shape it with HarfBuzz from the
// bundled files (`createTextShaping`, as MCP's sessions do). This holds that measurement to the
// app's own: the page's layout service (`createFontLayoutService`, shaped with the page's
// shaper) over a font library loaded from the bundled files, and the text tool's box sizing
// (`measuredSize`). The two agree to within half a pixel for a fixed set of families, strings,
// sizes and wrap widths.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { FontLibrary } from '@canvas/engine';
import type { StyleRun, TextStyle } from '@canvas/schema';
import {
  bundledFontFile,
  createTextShaping,
  loadShaper,
  measuringFontsFor,
  measureObjectText,
} from '@canvas/text';
import { layoutContent, measuredSize } from '@canvas/tools';

import { COVERAGE_FONT_FAMILIES } from './coverage-fonts.js';
import { FONT_FAMILIES } from './font-catalogue.js';
import { createFontLayoutService } from './page-fonts.js';
import { coverageFamilies } from './script-coverage.js';

/** The most an agent's measurement may differ from the app's, world units. */
const TOLERANCE = 0.5;

const REPO_ROOT = new URL('../../../../', import.meta.url);
/** One shaper for both sides, as one process has one. */
const SHAPER = await loadShaper();
/** The agent's shaping, over the bundled files as MCP's sessions read them. */
const AGENT_SHAPING = createTextShaping(SHAPER, {
  bytesOf: (face) => {
    const path = bundledFontFile(face);
    return path === undefined ? undefined : readFileSync(new URL(path, REPO_ROOT));
  },
});

const LIBRARY = new URL('../../assets/fonts/library/', import.meta.url);
const COVERAGE = new URL('../../assets/fonts/script-coverage/', import.meta.url);
const ENGINE_FONTS = new URL('../../../engine/assets/fonts/', import.meta.url);

/**
 * Reads a bundled face's file from its catalogue URL (the dev server's file URL, or its
 * library path).
 *
 * @param url - The face's URL in the font catalogue.
 * @returns A fresh copy of the bytes.
 */
function bytesOf(url: string): ArrayBuffer {
  const path = new URL(url).pathname;
  const name = path.slice(path.lastIndexOf('/') + 1).replace(/\?.*$/, '');
  const folderIn = (marker: string, root: URL): URL =>
    new URL(`${path.split(marker)[1]?.split('/')[0] ?? ''}/`, root);
  const directory = path.includes('/library/')
    ? folderIn('/library/', LIBRARY)
    : path.includes('/script-coverage/')
      ? folderIn('/script-coverage/', COVERAGE)
      : ENGINE_FONTS;
  const file = readFileSync(new URL(name, directory));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

/**
 * The page's font library with the default family and one other loaded, as a page has them once
 * a text in that family is on screen, with the symbol faces the strings' symbols load
 * (`coverageFamilies`: ⟁ loads Noto Sans Math).
 *
 * @param family - The other family.
 * @returns The library.
 */
function pageLibraryWith(family: string): FontLibrary {
  const fonts = new FontLibrary();
  for (const entry of FONT_FAMILIES) {
    if (entry.family !== 'Liberation Sans' && entry.family !== family) continue;
    for (const source of entry.faces) fonts.addFace(source, bytesOf(source.url));
  }
  const symbols = new Set(STRINGS.flatMap((text) => coverageFamilies(text)));
  for (const entry of COVERAGE_FONT_FAMILIES) {
    if (!symbols.has(entry.family)) continue;
    for (const source of entry.faces) fonts.addFace(source, bytesOf(source.url));
  }
  return fonts;
}

const FAMILIES = ['Liberation Sans', 'Inter', 'Lora', 'JetBrains Mono', 'Caveat', 'Oswald'];
const STRINGS = [
  'W',
  'AVATAR Typography',
  'Width, height and line count, measured the way the app lays text out.',
  'Café — naïve façade',
  'Line one\nLine two is longer\n',
  'Emoji 😀 and a missing glyph ⟁',
];
const SIZES = [12, 16, 24, 48];
const WIDTHS = [null, 80, 200, 333];

/** How a parity case styles its text. */
type Styling = 'plain' | 'mixed' | 'spaced';

/**
 * A text's runs: one style; (`mixed`) a bold, larger first word and an italic rest; or
 * (`spaced`) a tracked first word with a px line-height and a rest with percent
 * spacing and line-height.
 *
 * @param text - The text.
 * @param style - The base style.
 * @param styling - How to style it.
 * @returns The runs.
 */
function runsOf(text: string, style: TextStyle, styling: Styling): StyleRun[] {
  const split = text.indexOf(' ');
  if (styling === 'plain') return [{ length: text.length, style }];
  if (styling === 'spaced') {
    const rest: TextStyle = {
      ...style,
      letterSpacing: { value: 8, unit: 'percent' },
      lineHeight: { value: 140, unit: 'percent' },
    };
    if (split <= 0) return [{ length: text.length, style: rest }];
    return [
      {
        length: split,
        style: {
          ...style,
          letterSpacing: { value: 2, unit: 'px' },
          lineHeight: { value: style.fontSize * 2, unit: 'px' },
        },
      },
      { length: text.length - split, style: rest },
    ];
  }
  if (split <= 0) return [{ length: text.length, style }];
  return [
    { length: split, style: { ...style, weight: 700, fontSize: style.fontSize * 1.5 } },
    { length: text.length - split, style: { ...style, italic: true } },
  ];
}

const expectClose = (actual: number, expected: number): void => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOLERANCE);
};

describe.each(FAMILIES)('measuring %s for agents', (family) => {
  const service = createFontLayoutService(pageLibraryWith(family), SHAPER);
  const context = { layout: service };

  it.each<Styling>(['plain', 'mixed', 'spaced'])(
    'agrees with the app for text boxes and notes (%s styles)',
    (styling) => {
      for (const text of STRINGS) {
        for (const fontSize of SIZES) {
          const style: TextStyle = {
            fontFamily: family,
            fontSize,
            color: 'ink',
            weight: 400,
            italic: false,
          };
          const runs = runsOf(text, style, styling);
          const { fonts, unknownFamilies } = measuringFontsFor([runs]);
          expect(unknownFamilies).toEqual([]);
          for (const width of WIDTHS) {
            const base = { text, runs, align: 'left', verticalAlign: 'top' } as const;
            const textBox =
              width === null
                ? ({ ...base, type: 'text', autoWidth: true, width: 1, height: 1 } as const)
                : ({ ...base, type: 'text', autoWidth: false, width, height: 1 } as const);
            const note = {
              ...base,
              type: 'sticky',
              autoWidth: false,
              width: width ?? 200,
              height: width ?? 200,
              color: [1, 1, 0, 1],
            } as const;
            for (const object of [textBox, note]) {
              const layout = layoutContent(context, object as never, { text, runs });
              if (layout === undefined) throw new Error('The page library has no face.');
              const app = measuredSize(object as never, layout);
              const agent = measureObjectText(object, fonts, AGENT_SHAPING.measurerFor(fonts));
              expectClose(agent?.text.width ?? Number.NaN, layout.width);
              expectClose(agent?.text.height ?? Number.NaN, layout.height);
              expect(agent?.text.lineCount).toBe(layout.lines.length);
              expectClose(agent?.box?.width ?? Number.NaN, app.width);
              expectClose(agent?.box?.height ?? Number.NaN, app.height);
            }
          }
        }
      }
    },
  );

  it('agrees with the app for shape labels of every kind and a connector label', () => {
    const text = 'A label long enough to wrap inside the shape it sits in';
    const style: TextStyle = {
      fontFamily: family,
      fontSize: 16,
      color: 'ink',
      weight: 400,
      italic: false,
    };
    const runs = runsOf(text, style, 'plain');
    const { fonts } = measuringFontsFor([runs]);
    const kinds = ['rectangle', 'ellipse', 'diamond', 'polygon', 'star'] as const;
    for (const kind of kinds) {
      const shape = {
        type: 'shape',
        kind,
        width: 180,
        height: 120,
        cornerRadius: 24,
        sides: 6,
        label: { text, runs },
      } as const;
      const app = layoutContent(context, shape as never, { text, runs });
      const agent = measureObjectText(shape, fonts, AGENT_SHAPING.measurerFor(fonts));
      expectClose(agent?.text.width ?? Number.NaN, app?.width ?? Number.NaN);
      expectClose(agent?.text.height ?? Number.NaN, app?.height ?? Number.NaN);
      expect(agent?.text.lineCount).toBe(app?.lines.length);
    }
    const app = service.layout({ text, runs, wrapWidth: 200, align: 'center' });
    const agent = measureObjectText(
      { type: 'connector', label: { text, runs } },
      fonts,
      AGENT_SHAPING.measurerFor(fonts),
    );
    expectClose(agent?.text.width ?? Number.NaN, app?.width ?? Number.NaN);
    expectClose(agent?.text.height ?? Number.NaN, app?.height ?? Number.NaN);
    expect(agent?.text.lineCount).toBe(app?.lines.length);
  });
});
