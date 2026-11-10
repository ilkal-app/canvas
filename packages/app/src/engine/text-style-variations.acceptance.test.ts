// Style-context reuse must account for font variation coordinates.
import { describe, expect, it } from 'vitest';

import { MIXED } from '../panels/controls/mixed-value.js';

import { isSameStyleContext, patchOf } from './text-style-context.js';
import type { TextStyleContext } from './text-style-types.js';

const BASE: TextStyleContext = { style: {}, align: 'start', isEditing: false };

describe('font variations in style contexts', () => {
  it('distinguishes contexts that differ only in coordinates', () => {
    expect(
      isSameStyleContext(
        { ...BASE, style: { fontVariations: { wght: 700 } } },
        { ...BASE, style: { fontVariations: { wght: 600 } } },
      ),
    ).toBe(false);
    expect(isSameStyleContext(BASE, { ...BASE, style: { fontVariations: { wght: 700 } } })).toBe(
      false,
    );
  });

  it('keeps contexts equal when coordinates match in any key order or both are absent', () => {
    expect(
      isSameStyleContext(
        { ...BASE, style: { fontVariations: { opsz: 18, wght: 700 } } },
        { ...BASE, style: { fontVariations: { wght: 700, opsz: 18 } } },
      ),
    ).toBe(true);
    expect(isSameStyleContext(BASE, { ...BASE, style: {} })).toBe(true);
  });

  it('makes mod+b clear an explicit weight axis on a bundled variable family', () => {
    expect(
      patchOf(
        { kind: 'toggleBold' },
        { fontFamily: 'Inter Variable', weight: 400, fontVariations: { wght: 650 } },
      ),
    ).toEqual({ weight: 700, fontVariationsAxes: { wght: null } });
    expect(patchOf({ kind: 'toggleBold' }, { fontFamily: 'Inter', weight: 400 })).toEqual({
      weight: 700,
    });
  });

  it('distinguishes style contexts whose per-axis common values differ', () => {
    const first = { ...BASE, axisValues: { opsz: MIXED, wght: 650 } as const };
    const second = { ...BASE, axisValues: { opsz: 18, wght: 650 } };
    expect(isSameStyleContext(first, second)).toBe(false);
  });
});
