/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { bundledFontFile } from '../bundled/bundled-font-file.js';
import { fontFaceId, type FontFaceKey } from '../font/font-face.js';
import { createTextShaping, MissingFontFileError, type SyncFontBytesSource } from '../index.js';
import { loadShaper } from '../shaping/shaper.js';

import { measureText, measuringFontsFor } from './measure-text.js';

const REPO_ROOT = new URL('../../../../', import.meta.url);
const STYLE: TextStyle = {
  fontFamily: 'EB Garamond',
  fontSize: 20,
  color: 'ink',
  weight: 400,
  italic: false,
};
const runsOf = (text: string): StyleRun[] => [{ length: text.length, style: STYLE }];
const fonts = measuringFontsFor([runsOf('office ∮')]).fonts;
const SYMBOL_FACE = fonts.find(({ face }) => face.family === 'Noto Sans Math')?.face;
const EB_FACE = fonts.find(
  ({ face }) => face.family === STYLE.fontFamily && face.weight === 400 && !face.isItalic,
)?.face;

class MutableSource implements SyncFontBytesSource {
  readonly calls = new Map<string, number>();
  readonly missing = new Set<string>();

  bytesOf(face: FontFaceKey): Uint8Array | undefined {
    const id = fontFaceId(face);
    this.calls.set(id, (this.calls.get(id) ?? 0) + 1);
    if (this.missing.has(id)) return undefined;
    const path = bundledFontFile(face);
    return path === undefined ? undefined : readFileSync(new URL(path, REPO_ROOT));
  }
}

function requiredFace(face: FontFaceKey | undefined): FontFaceKey {
  if (face === undefined) throw new Error('Expected bundled test face');
  return face;
}

describe('lazy text shaping', () => {
  it('measures EB Garamond office and a coverage character identically to eager shaping', async () => {
    const shaper = await loadShaper();
    const text = 'office ∮';
    const eager = createTextShaping(shaper, new MutableSource());
    const lazy = createTextShaping(shaper, new MutableSource(), { readFiles: 'when-shaped' });
    expect(measureText(text, runsOf(text), null, fonts, lazy.measurerFor(fonts))).toEqual(
      measureText(text, runsOf(text), null, fonts, eager.measurerFor(fonts)),
    );
  });

  it('does not read an unused missing symbol face when constructing or shaping', async () => {
    const source = new MutableSource();
    const face = requiredFace(SYMBOL_FACE);
    source.missing.add(fontFaceId(face));
    const shaping = createTextShaping(await loadShaper(), source, { readFiles: 'when-shaped' });
    const measurer = shaping.measurerFor(fonts);
    expect(source.calls.get(fontFaceId(face))).toBeUndefined();
    expect(measureText('office', runsOf('office'), null, fonts, measurer).width).toBeGreaterThan(0);
    expect(measureText('office', runsOf('office'), null, fonts, measurer).width).toBeGreaterThan(0);
    expect(source.calls.get(fontFaceId(face))).toBeUndefined();
    expect(source.calls.get(fontFaceId(requiredFace(EB_FACE)))).toBe(1);
  });

  it('reports the missing face and retries it on the same TextShaping after bytes arrive', async () => {
    const source = new MutableSource();
    const face = requiredFace(SYMBOL_FACE);
    source.missing.add(fontFaceId(face));
    const shaping = createTextShaping(await loadShaper(), source, { readFiles: 'when-shaped' });
    const measure = () => measureText('∮', runsOf('∮'), null, fonts, shaping.measurerFor(fonts));
    try {
      measure();
      throw new Error('Expected a missing font file');
    } catch (error) {
      expect(error).toBeInstanceOf(MissingFontFileError);
      expect((error as MissingFontFileError).face).toEqual(face);
      expect((error as Error).message).toContain(face.family);
    }
    source.missing.delete(fontFaceId(face));
    expect(measure().width).toBeGreaterThan(0);
    expect(measure().width).toBeGreaterThan(0);
    expect(source.calls.get(fontFaceId(face))).toBe(2);
  });

  it('still reports an eagerly read missing face as MissingFontFileError', async () => {
    const source = new MutableSource();
    const face = requiredFace(EB_FACE);
    source.missing.add(fontFaceId(face));
    const shaping = createTextShaping(await loadShaper(), source);
    expect(() => shaping.measurerFor(fonts)).toThrow(MissingFontFileError);
    try {
      shaping.measurerFor(fonts);
    } catch (error) {
      expect((error as MissingFontFileError).face).toEqual(face);
      expect((error as Error).message).toContain(face.family);
    }
  });

  it('does not read a missing file for empty variable text', async () => {
    const source = new MutableSource();
    const face = requiredFace(EB_FACE);
    source.missing.add(fontFaceId(face));
    const shaping = createTextShaping(await loadShaper(), source, { readFiles: 'when-shaped' });
    const style = { ...STYLE, fontVariations: { wght: 700 } };
    expect(
      measureText('', [{ length: 0, style }], null, fonts, shaping.measurerFor(fonts)),
    ).toMatchObject({ width: 0, lineCount: 1 });
    expect(source.calls.get(fontFaceId(face))).toBeUndefined();
  });
});
