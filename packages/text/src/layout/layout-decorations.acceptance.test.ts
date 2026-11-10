/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { createFontMetrics, parseFont } from '../index.js';

import { FakeGlyphMeasurer } from './__fixtures__/fake-glyph-measurer.js';
import { createMetricsMeasurer } from './glyph-measurer.js';
import { layoutText } from './layout-text.js';

const BASE: TextStyle = {
  fontFamily: 'Fake',
  fontSize: 10,
  color: 'ink',
  weight: 400,
  italic: false,
};
interface Decoration {
  kind: string;
  line: number;
  run: number;
  x: number;
  width: number;
  y: number;
  thickness: number;
}
const decorationsOf = (layout: ReturnType<typeof layoutText>): Decoration[] =>
  Reflect.get(layout, 'decorations') as Decoration[];

describe('layout decorations', () => {
  it('copies run flags and uses fallback font metrics for their line centres', () => {
    const runs: StyleRun[] = [
      { length: 2, style: { ...BASE, underline: true, strikethrough: true } },
    ];
    const layout = layoutText('ab', runs, null, new FakeGlyphMeasurer());
    expect(layout.runs[0]).toMatchObject({ underline: true, strikethrough: true });
    expect(decorationsOf(layout)).toEqual([
      {
        kind: 'underline',
        line: 0,
        run: 0,
        x: 0,
        width: 12,
        y: (layout.lines[0]?.baseline ?? 0) + 1,
        thickness: 0.5,
      },
      {
        kind: 'strikethrough',
        line: 0,
        run: 0,
        x: 0,
        width: 12,
        y: (layout.lines[0]?.baseline ?? 0) - 3,
        thickness: 0.5,
      },
    ]);
  });

  it('splits adjacent differently coloured runs and omits trailing soft-wrap space', () => {
    const runs: StyleRun[] = [
      { length: 2, style: { ...BASE, underline: true } },
      { length: 4, style: { ...BASE, color: [1, 0, 0, 1], underline: true } },
    ];
    const layout = layoutText('ab cd ', runs, 24, new FakeGlyphMeasurer());
    expect(
      decorationsOf(layout)
        .filter(({ kind }) => kind === 'underline')
        .map(({ line, run, width }) => ({ line, run, width })),
    ).toEqual([
      { line: 0, run: 0, width: 12 },
      { line: 1, run: 1, width: 12 },
    ]);

    const adjacentRuns: StyleRun[] = [
      { length: 2, style: { ...BASE, underline: true } },
      { length: 2, style: { ...BASE, color: [1, 0, 0, 1], underline: true } },
    ];
    const adjacentLayout = layoutText('abcd', adjacentRuns, null, new FakeGlyphMeasurer());
    expect(
      decorationsOf(adjacentLayout)
        .filter(({ kind }) => kind === 'underline')
        .map(({ line, run, x, width }) => ({ line, run, x, width })),
    ).toEqual([
      { line: 0, run: 0, x: 0, width: 12 },
      { line: 0, run: 1, x: 12, width: 12 },
    ]);
  });

  it('reads the bundled DM Sans post and OS/2 decoration metrics', () => {
    const bytes = readFileSync(
      new URL('../../../app/assets/fonts/library/dmsans/400.ttf', import.meta.url),
    );
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tables = new Map<string, number>();
    for (let index = 0; index < view.getUint16(4); index += 1) {
      const at = 12 + index * 16;
      const tag = String.fromCharCode(...bytes.subarray(at, at + 4));
      tables.set(tag, view.getUint32(at + 8));
    }
    const units = view.getUint16((tables.get('head') ?? 0) + 18);
    const post = tables.get('post') ?? 0;
    const os2 = tables.get('OS/2') ?? 0;
    const expected = {
      underlinePosition: view.getInt16(post + 8) / units,
      underlineThickness: view.getInt16(post + 10) / units,
      strikeoutPosition: view.getInt16(os2 + 28) / units,
      strikeoutThickness: view.getInt16(os2 + 26) / units,
    };
    const metrics = createFontMetrics(
      { family: 'DM Sans', weight: 400, isItalic: false },
      parseFont(bytes),
    );
    const measurer = createMetricsMeasurer([metrics]);
    expect(
      measurer.lineMetrics(measurer.faceIdOf({ ...BASE, fontFamily: 'DM Sans' })),
    ).toMatchObject(expected);
  });
});
