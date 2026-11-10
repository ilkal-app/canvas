// The style context cache and a run's link: a link chosen, no link (spelt out) and a
// mixed link (absent) are three contexts, so linking a range re-renders the popover's Link.
import { describe, expect, it } from 'vitest';

import { isSameStyleContext } from './text-style-context.js';
import type { TextStyleContext } from './text-style-types.js';

const PLAIN: TextStyleContext = {
  style: { fontFamily: 'Inter', link: undefined },
  align: 'left',
  isEditing: true,
};

describe('isSameStyleContext and a link', () => {
  it('tells a chosen link, no link and a mixed link apart', () => {
    expect(isSameStyleContext(PLAIN, { ...PLAIN, style: { ...PLAIN.style } })).toBe(true);
    const linked = { ...PLAIN, style: { ...PLAIN.style, link: 'https://example.com/a' } };
    expect(isSameStyleContext(PLAIN, linked)).toBe(false);
    expect(
      isSameStyleContext(linked, {
        ...PLAIN,
        style: { ...PLAIN.style, link: 'https://example.com/b' },
      }),
    ).toBe(false);
    expect(isSameStyleContext(PLAIN, { ...PLAIN, style: { fontFamily: 'Inter' } })).toBe(false);
  });
});
