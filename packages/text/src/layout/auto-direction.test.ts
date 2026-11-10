// The side an auto-direction text's start resolves to, for the inspector.
import { describe, expect, it } from 'vitest';

import { autoDirectionOf } from './text-bidi.js';

describe('autoDirectionOf', () => {
  it.each([
    ['', 'ltr'],
    ['Hello', 'ltr'],
    ['123 שלום', 'rtl'],
    ['مرحبا world', 'rtl'],
    ['Hello שלום', 'ltr'],
    ['שלום\nHello', 'rtl'],
    ['Hello\nשלום', 'ltr'],
    ['\u2067שלום\u2069 Hello', 'ltr'],
  ])('%j is %s', (text, expected) => {
    expect(autoDirectionOf(text)).toBe(expected);
  });
});
