import { describe, expect, it } from 'vitest';

import { isImeKey } from './ime-key.js';

describe('isImeKey', () => {
  it('holds a key while a composition is under way', () => {
    expect(isImeKey({ isComposing: true, keyCode: 13 })).toBe(true);
  });

  it('holds Safari’s key that ends a composition: not composing, but keyCode 229', () => {
    expect(isImeKey({ isComposing: false, keyCode: 229 })).toBe(true);
  });

  it('lets any other key through, with or without a keyCode', () => {
    expect(isImeKey({ isComposing: false, keyCode: 13 })).toBe(false);
    expect(isImeKey({ isComposing: false })).toBe(false);
  });
});
