import { describe, expect, it } from 'vitest';

import { textToolStyleOf } from './text-style.js';

describe('text tool style defaults', () => {
  it('keeps variable font coordinates selected for new text', () => {
    const { textStyle } = textToolStyleOf({
      textStyle: { fontFamily: 'Inter Variable', weight: 700, fontVariations: { opsz: 18 } },
    });
    expect(textStyle).toMatchObject({
      fontFamily: 'Inter Variable',
      weight: 700,
      fontVariations: { opsz: 18 },
    });
  });
});
