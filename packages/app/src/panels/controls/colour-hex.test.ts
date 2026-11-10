// Swatch colours: a CSS colour keeps the alpha a hex colour drops, and a swatch draws a
// translucent colour over a checkerboard.
import { describe, expect, it } from 'vitest';

import { hexToRgba, rgbaToCss, rgbaToHex, swatchBackground } from './colour-hex.js';

describe('colour-hex', () => {
  it('drops alpha in hex and keeps it in CSS', () => {
    const colour = [1, 0.5, 0, 0.25] as const;
    expect(rgbaToHex([...colour])).toBe('#ff8000');
    expect(hexToRgba('#ff8000', 0.25)).toEqual([1, 128 / 255, 0, 0.25]);
    expect(rgbaToCss(colour)).toBe('rgb(255 128 0 / 0.25)');
  });

  it('paints a swatch colour over a checkerboard, so translucency shows', () => {
    const background = swatchBackground([0, 0, 1, 0.5]);
    expect(background).toMatch(
      /^linear-gradient\(rgb\(0 0 255 \/ 0\.5\), rgb\(0 0 255 \/ 0\.5\)\), /u,
    );
    expect(background).toContain('repeating-conic-gradient(');
  });
});
