import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { createMetricsMeasurer } from '../layout/glyph-measurer.js';
import * as layoutModule from '../layout/layout-text.js';

const { layoutText } = layoutModule;

import { measureObjectText } from './measure-object.js';
import { measuringFontsFor } from './measure-text.js';

const TEXT = 'Latin words wrap here';
const STYLE: TextStyle = {
  fontFamily: 'Liberation Sans',
  fontSize: 20,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};
const RUNS: StyleRun[] = [{ length: TEXT.length, style: STYLE }];
const { fonts } = measuringFontsFor([RUNS]);

afterEach(() => vi.restoreAllMocks());

describe('object text measurement direction', () => {
  it("passes an object's rtl direction and end alignment to layout", () => {
    const layout = vi.spyOn(layoutModule, 'layoutText');
    measureObjectText(
      {
        type: 'text',
        text: TEXT,
        runs: RUNS,
        width: 120,
        height: 0,
        autoWidth: false,
        align: 'end',
        direction: 'rtl',
      },
      fonts,
    );
    expect(layout).toHaveBeenCalledWith(
      TEXT,
      expect.any(Array),
      120,
      expect.any(Object),
      'end',
      'rtl',
    );
  });
  for (const type of ['text', 'sticky'] as const) {
    it(`${type} matches layoutText for rtl/end and takes its object's direction`, () => {
      const object = {
        type,
        text: TEXT,
        runs: RUNS,
        width: 120,
        // A note tall enough for its text at the stored size, so the fit keeps it.
        height: type === 'sticky' ? 400 : 120,
        align: 'end',
        direction: 'rtl',
        autoWidth: false,
      } as const;
      const measured = measureObjectText(object, fonts);
      const wrapWidth = type === 'sticky' ? 88 : 120;
      const layout = layoutText(TEXT, RUNS, wrapWidth, createMetricsMeasurer(fonts), 'end', 'rtl');
      expect(measured?.text).toEqual({
        width: layout.width,
        height: layout.height,
        lineCount: layout.lines.length,
      });
      expect(measured?.box?.width).toBe(120);
      if (type === 'text') expect(measured?.box?.height).toBe(layout.height);
    });
  }
});
