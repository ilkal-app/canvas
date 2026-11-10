// The sticky tool creates centred wide notes and retains their text height.
import { describe, expect, it } from 'vitest';

import type { Color, TextStyle } from '@canvas/schema';

import { tenPointNote } from '../text/__fixtures__/text-mode-context.js';
import { measuredSize } from '../text/text-content-writer.js';

import { newStickyObject } from './new-sticky-object.js';
import * as sticky from './new-sticky-object.js';

const STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 16,
  color: 'ink',
  weight: 400,
  italic: false,
};

describe('wide sticky creation and text fitting', () => {
  it('creates a centred 400 by 200 wide note and retains square creation by default', () => {
    expect(Reflect.get(sticky, 'WIDE_NOTE_WIDTH')).toBe(400);
    const centre = { x: 500, y: 300 };
    const color: Color = [1, 1, 0, 1];
    expect(newStickyObject(centre, STYLE, color, 'center', 'wide')).toMatchObject({
      x: 300,
      y: 200,
      width: 400,
      height: 200,
      aspect: 'wide',
    });
    const square = newStickyObject(centre, STYLE, color);
    expect(square).toMatchObject({ x: 400, y: 200, width: 200, height: 200 });
    expect(square).not.toHaveProperty('aspect');
  });

  it('keeps a wide note at least half as tall as its width and never below stored height', () => {
    const wide = { ...tenPointNote('wide', ''), width: 400, height: 100, aspect: 'wide' } as const;
    const short = { width: 10, height: 10 } as Parameters<typeof measuredSize>[1];
    expect(measuredSize(wide, short)).toEqual({ width: 400, height: 200 });
    expect(measuredSize({ ...wide, height: 260 }, short)).toEqual({ width: 400, height: 260 });
    const long = { width: 10, height: 300 } as Parameters<typeof measuredSize>[1];
    expect(measuredSize(wide, long)).toEqual({ width: 400, height: 332 });
  });
});
