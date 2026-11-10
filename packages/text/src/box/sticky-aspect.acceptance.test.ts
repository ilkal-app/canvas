// Wide notes keep a half-width floor and grow with their text.
import { describe, expect, it } from 'vitest';

import { measureObjectText } from '../measure/measure-object.js';
import { measuringFontsFor } from '../measure/measure-text.js';

import { NOTE_PADDING, noteHeightFor } from './text-boxes.js';

const STYLE = {
  fontFamily: 'Liberation Sans',
  fontSize: 20,
  color: 'ink',
  weight: 400,
  italic: false,
} as const;

describe('sticky aspect measurement', () => {
  it('keeps the square floor by default and uses half the width for wide notes', () => {
    expect(noteHeightFor(400, 10)).toBe(400);
    expect(noteHeightFor(400, 10, 'square')).toBe(400);
    expect(noteHeightFor(400, 10, 'wide')).toBe(200);
    expect(noteHeightFor(400, 300, 'wide')).toBe(300 + 2 * NOTE_PADDING);
  });

  it('uses the aspect when measuring a sticky and never shrinks below stored height', () => {
    const runs = [{ length: 0, style: STYLE }];
    const { fonts } = measuringFontsFor([runs]);
    const note = {
      type: 'sticky',
      text: '',
      runs,
      width: 400,
      height: 200,
      aspect: 'wide',
    } as const;
    expect(measureObjectText(note, fonts)?.box).toEqual({ width: 400, height: 200 });
    expect(measureObjectText({ ...note, height: 250 }, fonts)?.box).toEqual({
      width: 400,
      height: 250,
    });
  });
});
