/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type {
  Board,
  BoardObject,
  InstanceObject,
  ObjectId,
  PrincipalId,
  StyleRun,
  TextStyle,
} from '@canvas/schema';

import { noteWrapWidth } from '../box/text-boxes.js';
import { bundledFontFile } from '../bundled/bundled-font-file.js';
import { fontFaceId, type FontFaceKey } from '../font/font-face.js';
import { createTextShaping, type SyncFontBytesSource } from '../index.js';
import { loadShaper } from '../shaping/shaper.js';

import { measureObjectText } from './measure-object.js';
import { measureOverrideText } from './measure-override.js';
import { measureText, measuringFontsFor } from './measure-text.js';
import { prepareMeasuringFonts } from './prepare-measuring-fonts.js';

const REPO_ROOT = new URL('../../../../', import.meta.url);
const STYLE: TextStyle = {
  fontFamily: 'EB Garamond',
  fontSize: 20,
  color: 'ink',
  weight: 400,
  italic: false,
};
const TEXT = 'office';
const runsOf = (text: string): StyleRun[] => [{ length: text.length, style: STYLE }];
const RUNS = runsOf(TEXT);
const { fonts } = measuringFontsFor([RUNS]);

class FileSource implements SyncFontBytesSource {
  readonly calls = new Map<string, number>();

  bytesOf(face: FontFaceKey): Uint8Array | undefined {
    const id = fontFaceId(face);
    this.calls.set(id, (this.calls.get(id) ?? 0) + 1);
    const path = bundledFontFile(face);
    return path === undefined ? undefined : readFileSync(new URL(path, REPO_ROOT));
  }
}

const SHARED = {
  rotation: 0,
  locked: false,
  createdBy: 'user:ada' as PrincipalId,
  createdAt: 1,
  updatedAt: 1,
  z: 'a0',
} as const;

describe('synchronous text shaping', () => {
  it('measures EB Garamond office with the prepared HarfBuzz result instead of metrics', async () => {
    const source = new FileSource();
    const shaping = createTextShaping(await loadShaper(), source);
    const measurer = shaping.measurerFor(fonts);
    expect(measurer.shape).toBeTypeOf('function');
    const actual = measureText(TEXT, RUNS, null, fonts, measurer);
    const prepared = await prepareMeasuringFonts([RUNS], {
      bytesOf: (face) => Promise.resolve(source.bytesOf(face)),
    });
    expect(actual).toEqual(measureText(TEXT, RUNS, null, prepared.fonts, prepared.measurer));
    expect(actual.width).not.toBeCloseTo(measureText(TEXT, RUNS, null, fonts).width, 8);
  });

  it('reads each face once across repeated measurerFor calls', async () => {
    const source = new FileSource();
    const shaping = createTextShaping(await loadShaper(), source);
    for (let i = 0; i < 3; i += 1) {
      measureText(TEXT, RUNS, null, fonts, shaping.measurerFor(fonts));
    }
    expect(source.calls.size).toBe(fonts.length);
    expect([...source.calls.values()]).toEqual(fonts.map(() => 1));
  });

  it('names the family when a face has no bytes', async () => {
    const source = new FileSource();
    const shaping = createTextShaping(await loadShaper(), {
      bytesOf: (face) => (face.family === STYLE.fontFamily ? undefined : source.bytesOf(face)),
    });
    expect(() => shaping.measurerFor(fonts)).toThrow(/EB Garamond/);
  });

  it('passes the measurer to text and sticky object layout at their wrap widths', async () => {
    const measurer = createTextShaping(await loadShaper(), new FileSource()).measurerFor(fonts);
    const text = {
      type: 'text',
      text: TEXT,
      runs: RUNS,
      width: 70,
      height: 1,
      autoWidth: false,
    } as const;
    // Tall enough for its text at the stored size, so the fit keeps the stored runs.
    const sticky = { type: 'sticky', text: TEXT, runs: RUNS, width: 70, height: 400 } as const;
    expect(measureObjectText(text, fonts, measurer)?.text).toEqual(
      measureText(TEXT, RUNS, 70, fonts, measurer),
    );
    expect(measureObjectText(sticky, fonts, measurer)?.text).toEqual(
      measureText(TEXT, RUNS, noteWrapWidth(70), fonts, measurer),
    );
  });

  it('stores a shaped override size for an EB Garamond auto-width text child', async () => {
    const child = {
      ...SHARED,
      id: 'label' as ObjectId,
      type: 'text' as const,
      parentId: 'main' as ObjectId,
      x: 5,
      y: 5,
      width: 40,
      height: 20,
      text: 'ab',
      runs: runsOf('ab'),
      align: 'left' as const,
      autoWidth: true,
      verticalAlign: 'top' as const,
    };
    const main = {
      ...SHARED,
      id: 'main' as ObjectId,
      type: 'component' as const,
      parentId: null,
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      name: 'Chip',
      retired: false,
    };
    const instance: InstanceObject = {
      ...SHARED,
      id: 'inst' as ObjectId,
      type: 'instance',
      parentId: null,
      x: 200,
      y: 0,
      width: 100,
      height: 40,
      mainId: main.id,
      overrides: {},
    };
    const board: Board = {
      objects: new Map<ObjectId, BoardObject>([
        [main.id, main],
        [child.id, child],
        [instance.id, instance],
      ]),
    };
    const shaping = createTextShaping(await loadShaper(), new FileSource());
    const shaped = measureOverrideText(board, instance, 'label', { text: TEXT }, shaping);
    const metrics = measureOverrideText(board, instance, 'label', { text: TEXT });
    const expected = measureText(TEXT, RUNS, null, fonts, shaping.measurerFor(fonts));
    expect(shaped?.measuredSize).toMatchObject({ width: expected.width, height: expected.height });
    expect(shaped?.measuredSize.width).not.toBeCloseTo(metrics?.measuredSize.width ?? 0, 8);
  });
});
