/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { parseFont } from '../font/parse-font.js';
import { SfntFile } from '../font/sfnt-file.js';
import { loadShaper, shapeText } from '../shaping/shaper.js';

import { bundledFontFile, bundledFontFilePaths } from './bundled-font-file.js';

const REPO_ROOT = new URL('../../../../', import.meta.url);
const COVERAGE = 'packages/app/assets/fonts/script-coverage/';
const COLOR_PATH = `${COVERAGE}notocoloremoji/400.ttf`;
const METRICS_PATH = `${COVERAGE}notocoloremoji/400-metrics.ttf`;
const FACE = { family: 'Noto Color Emoji', weight: 400, isItalic: false } as const;
const colorBytes = readFileSync(new URL(COLOR_PATH, REPO_ROOT));
const metricsBytes = readFileSync(new URL(METRICS_PATH, REPO_ROOT));
const colorFont = parseFont(colorBytes);
const metricsFont = parseFont(metricsBytes);

/**
 * The Unicode 17 RGI sequences named by both checked-in emoji files.
 *
 * @returns Every expanded sequence.
 */
function rgiSequences(): string[] {
  const folder = new URL('../unicode/__fixtures__/ucd-17.0.0/', import.meta.url);
  const sequences: string[] = [];
  for (const name of ['emoji-sequences', 'emoji-zwj-sequences']) {
    const source = gunzipSync(readFileSync(new URL(`${name}.txt.gz`, folder))).toString('utf8');
    for (const line of source.split(/\r?\n/u)) {
      const [data = ''] = line.split('#', 1);
      const [field = '', type = ''] = data.split(';').map((part) => part.trim());
      if (!field || !type) continue;
      const [first = '', last] = field.split('..');
      if (last !== undefined) {
        for (let point = Number.parseInt(first, 16); point <= Number.parseInt(last, 16); point += 1)
          sequences.push(String.fromCodePoint(point));
      } else {
        sequences.push(
          field
            .split(/\s+/u)
            .map((point) => String.fromCodePoint(Number.parseInt(point, 16)))
            .join(''),
        );
      }
    }
  }
  return sequences;
}

describe('Noto Color Emoji measuring face', () => {
  it('deploys only the metrics file for shaping', () => {
    const catalogue = JSON.parse(
      readFileSync(new URL(`${COVERAGE}catalogue.json`, REPO_ROOT), 'utf8'),
    ) as { entries: { family: string; faces: { url: string; metricsUrl?: string }[] }[] };
    const entry = catalogue.entries.find(({ family }) => family === FACE.family);
    expect(entry?.faces).toEqual([
      expect.objectContaining({
        url: 'notocoloremoji/400.ttf',
        metricsUrl: 'notocoloremoji/400-metrics.ttf',
      }),
    ]);
    expect(catalogue.entries.map(({ family }) => family)).not.toContain('Noto Emoji');
    for (const family of ['Noto Sans Math', 'Noto Sans Symbols 2']) {
      const face = catalogue.entries.find((candidate) => candidate.family === family)?.faces[0];
      expect(face, family).toBeDefined();
      if (face === undefined) throw new Error(`missing ${family} catalogue face`);
      expect(
        bundledFontFile({ family, weight: 400, isItalic: false }),
        `${family} defaults to url`,
      ).toBe(`${COVERAGE}${face.metricsUrl ?? face.url}`);
    }
    expect(bundledFontFile(FACE)).toBe(METRICS_PATH);
    expect(bundledFontFilePaths()).toContain(METRICS_PATH);
    expect(bundledFontFilePaths()).not.toContain(COLOR_PATH);
    expect(bundledFontFile({ ...FACE, weight: 700 })).toBeUndefined();
    expect(bundledFontFile({ family: 'Noto Emoji', weight: 400, isItalic: false })).toBeUndefined();
    expect(bundledFontFile({ family: 'Noto Emoji', weight: 700, isItalic: false })).toBeUndefined();
  });

  it('preserves normalized vertical metrics, the complete cmap, and every mapped advance', () => {
    const colorHhea = new SfntFile(
      colorBytes.buffer.slice(colorBytes.byteOffset, colorBytes.byteOffset + colorBytes.byteLength),
    ).table('hhea');
    const metricsHhea = new SfntFile(
      metricsBytes.buffer.slice(
        metricsBytes.byteOffset,
        metricsBytes.byteOffset + metricsBytes.byteLength,
      ),
    ).table('hhea');
    expect([
      metricsFont.ascent,
      metricsFont.descent,
      metricsHhea.getInt16(8) / metricsFont.unitsPerEm,
    ]).toEqual([colorFont.ascent, colorFont.descent, colorHhea.getInt16(8) / colorFont.unitsPerEm]);
    expect(metricsFont.characterMap()).toEqual(colorFont.characterMap());
    for (const [point, glyph] of colorFont.characterMap()) {
      expect(metricsFont.advanceOf(glyph), `U+${point.toString(16)}`).toBe(
        colorFont.advanceOf(glyph),
      );
    }
  });

  it('shapes every covered Unicode 17 RGI sequence with equal glyph counts, advances, and clusters', async () => {
    const shaper = await loadShaper();
    const color = shaper.face('viv-513-color', colorBytes);
    const metrics = shaper.face('viv-513-metrics', metricsBytes);
    let covered = 0;
    for (const sequence of rgiSequences()) {
      const drawn = shapeText(shaper, color, sequence, 0, sequence.length).glyphs;
      if (drawn.some(({ glyphId }) => glyphId === 0)) continue;
      covered += 1;
      const measured = shapeText(shaper, metrics, sequence, 0, sequence.length).glyphs;
      expect(
        measured.map(({ advance, cluster }) => [advance, cluster]),
        sequence,
      ).toEqual(drawn.map(({ advance, cluster }) => [advance, cluster]));
    }
    expect(covered).toBeGreaterThan(1000);
  });

  it('keeps COLRv1 paint only in the drawing face', async () => {
    const shaper = await loadShaper();
    const color = shaper.face('viv-513-color', colorBytes);
    const metrics = shaper.face('viv-513-metrics', metricsBytes);
    const thumb = shapeText(shaper, color, '👍', 0, 2).glyphs[0];
    expect(thumb).toBeDefined();
    expect(shaper.hasColourGlyphs(color)).toBe(true);
    expect(shaper.colourGlyph(color, thumb?.glyphId ?? 0)?.ops.length).toBeGreaterThan(0);
    expect(shaper.hasColourGlyphs(metrics)).toBe(false);
    expect(shaper.colourGlyph(metrics, thumb?.glyphId ?? 0)).toBeUndefined();
  });
});
