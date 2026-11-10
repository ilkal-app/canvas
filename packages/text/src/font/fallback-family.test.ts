import { expect, it } from 'vitest';

import { fallbackFamily } from './fallback-family.js';
import { resolveFontFace } from './font-face.js';

it('chooses predictable category fallbacks using only the stored family name', () => {
  expect(fallbackFamily('Courier New')).toBe('JetBrains Mono');
  expect(fallbackFamily('Times New Roman')).toBe('Lora');
  expect(fallbackFamily('Comic Sans MS')).toBe('Caveat');
  expect(fallbackFamily('Unknown Sans')).toBe('Liberation Sans');
  expect(fallbackFamily('Impact')).toBe('Oswald');
  expect(fallbackFamily('Papyrus')).toBe('Liberation Sans');
});
it('keeps requested weight and slant in the fallback family', () => {
  const regular = { family: 'Lora', weight: 400, isItalic: false } as const;
  const bold = { ...regular, weight: 700, isItalic: true } as const;
  expect(
    resolveFontFace([regular, bold], { family: 'Times New Roman', weight: 700, isItalic: true }),
  ).toEqual(bold);
});
