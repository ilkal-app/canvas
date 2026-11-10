/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';
import { bundledFontFile, createTextShaping, loadShaper, measuringFontsFor } from '@canvas/text';

const ROOT = new URL('../../../../', import.meta.url);
const STYLE: TextStyle = {
  fontFamily: 'Liberation Sans',
  fontSize: 20,
  color: 'ink',
  weight: 400,
  italic: false,
  lang: 'ja',
};

describe('lazy shaping language', () => {
  it('passes a run language to the shaper as its seventh shape argument', async () => {
    const shaper = await loadShaper();
    const spy = vi.spyOn(shaper as unknown as { shape: (...args: unknown[]) => unknown }, 'shape');
    const runs: StyleRun[] = [{ length: 1, style: STYLE }];
    const { fonts } = measuringFontsFor([runs]);
    const source = {
      bytesOf: (face: Parameters<typeof bundledFontFile>[0]) => {
        const path = bundledFontFile(face);
        return path === undefined ? undefined : readFileSync(new URL(path, ROOT));
      },
    };
    const measurer = createTextShaping(shaper, source, { readFiles: 'when-shaped' }).measurerFor(
      fonts,
    );
    const faceId = measurer.faceIdOf(STYLE);
    measurer.shape?.(faceId, '漢', 0, 1, 'ltr', undefined, 'ja');
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.lastCall?.[5]).toBe('ja');
    spy.mockRestore();
  });
});
