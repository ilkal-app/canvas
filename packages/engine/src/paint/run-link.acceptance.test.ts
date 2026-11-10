// Written before the code; (): a link draws in its own colour,
// ink included. CONTRACT: linked ink is ink for theme rewrites, and explicit colours remain
// theirs. Deliberately not asserted: unrelated object paints.
import { describe, expect, it } from 'vitest';

import { STYLE, textObject } from '../text/scene/__fixtures__/text-objects.js';

import { colorTokensOf, usesInk } from './paint-reading.js';

const LINK = 'https://example.com/guide';

describe('linked text paint reading', () => {
  it('reports linked ink as ink, as unlinked ink, for theme rewrites', () => {
    const base = textObject('t', 'go');
    const linked = {
      ...base,
      runs: [{ length: 2, style: { ...STYLE, color: 'ink' as const, link: LINK } }],
    };
    expect(colorTokensOf(linked)).toEqual(new Set(['ink']));
    expect(usesInk(linked)).toBe(true);
  });

  it('reports an explicitly coloured link by its own token', () => {
    const base = textObject('t', 'go');
    const linked = {
      ...base,
      runs: [{ length: 2, style: { ...STYLE, color: { token: 'surface' }, link: LINK } }],
    };
    expect(colorTokensOf(linked)).toEqual(new Set(['surface']));
    expect(usesInk(linked)).toBe(false);
  });
});
