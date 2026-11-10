// The style context cache and a face name: a face chosen, no
// face (spelt out) and a mixed face (absent) are three contexts, so choosing a face re-renders.
import { describe, expect, it } from 'vitest';

import { isSameStyleContext } from './text-style-context.js';
import type { TextStyleContext } from './text-style-types.js';

const PLAIN: TextStyleContext = {
  style: { fontFamily: 'Private Sans', postScriptName: undefined },
  align: 'left',
  isEditing: false,
};

describe('isSameStyleContext and a face name', () => {
  it('tells a chosen face, no face and a mixed face apart', () => {
    expect(isSameStyleContext(PLAIN, { ...PLAIN, style: { ...PLAIN.style } })).toBe(true);
    const named = { ...PLAIN, style: { ...PLAIN.style, postScriptName: 'PrivateSans-Condensed' } };
    expect(isSameStyleContext(PLAIN, named)).toBe(false);
    expect(isSameStyleContext(PLAIN, { ...PLAIN, style: { fontFamily: 'Private Sans' } })).toBe(
      false,
    );
  });
});
