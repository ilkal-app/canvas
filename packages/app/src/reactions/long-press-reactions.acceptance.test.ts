import { describe, expect, it } from 'vitest';

import { longPressOpensReactions as implementation } from './long-press-reactions.js';

const longPressOpensReactions = implementation;

describe('longPressOpensReactions', () => {
  it('routes only an eligible empty press in the compact floating chrome to reactions', () => {
    expect(
      longPressOpensReactions({
        isFloating: true,
        isCompact: true,
        selectedCount: 0,
        canReact: true,
      }),
    ).toBe(true);
    for (const options of [
      { isFloating: false, isCompact: true, selectedCount: 0, canReact: true },
      { isFloating: true, isCompact: false, selectedCount: 0, canReact: true },
      { isFloating: true, isCompact: true, selectedCount: 1, canReact: true },
      { isFloating: true, isCompact: true, selectedCount: 0, canReact: false },
    ]) {
      expect(longPressOpensReactions(options)).toBe(false);
    }
  });
});
