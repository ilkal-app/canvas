import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseFont } from '@canvas/text';

import { COVERAGE_FONT_FAMILIES } from './coverage-fonts.js';
import { FONT_FAMILIES } from './font-catalogue.js';

describe('app color emoji bundle', () => {
  it('loads one hidden regular Noto Color Emoji face from the drawing file', () => {
    const entry = COVERAGE_FONT_FAMILIES.find(({ family }) => family === 'Noto Color Emoji');
    expect(entry?.faces).toHaveLength(1);
    const face = entry?.faces[0];
    expect(face).toMatchObject({ family: 'Noto Color Emoji', weight: 400, isItalic: false });
    expect(face?.url).toContain('/notocoloremoji/400.ttf');
    expect(face?.url).not.toContain('400-metrics.ttf');
    expect(COVERAGE_FONT_FAMILIES.map(({ family }) => family)).not.toContain('Noto Emoji');
    expect(FONT_FAMILIES.map(({ family }) => family)).not.toContain('Noto Color Emoji');
    if (face === undefined) return;
    expect(parseFont(readFileSync(fileURLToPath(face.url))).glyphIdOf(0x1f44d)).toBeGreaterThan(0);
  });
});
