import { describe, expect, it } from 'vitest';

describe('faceLabel', () => {
  it('uses the last PostScript suffix and separates camel case', async () => {
    const path = './face-label.js';
    const module = (await import(path)) as { faceLabel(name: string): string };
    expect(module.faceLabel('PrivateSans-CondensedBold')).toBe('Condensed Bold');
    expect(module.faceLabel('Inter-Display')).toBe('Display');
    expect(module.faceLabel('Foo')).toBe('Foo');
    expect(module.faceLabel('Family-SubFamily-LightItalic')).toBe('Light Italic');
  });
});
