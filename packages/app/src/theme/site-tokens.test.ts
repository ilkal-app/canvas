import { describe, expect, it } from 'vitest';

import { contrastOf } from '../collab/avatar-colors.js';

import { GRAPHITE_COLORS, VELLUM_COLORS } from './color-tokens.js';
import { SCALE_TOKENS } from './scale-tokens.js';

// The site's own tokens: its radius scale and its search fields' edge, both the owner's
// calls on the MVP frames' audit.
describe('the site’s tokens', () => {
  it('round the site on its own scale: row 6, control 8, surface 12, dialog 14, sheet 20, a pill', () => {
    expect(SCALE_TOKENS).toMatchObject({
      '--radius-site-row': '6px',
      '--radius-site-control': '8px',
      '--radius-site-surface': '12px',
      '--radius-site-dialog': '14px',
      '--radius-site-sheet': '20px',
      '--radius-site-pill': '999px',
    });
  });

  it('give a search field’s edge 3:1 on every surface a search sits on (WCAG 1.4.11)', () => {
    for (const [theme, colors] of [
      ['Graphite', GRAPHITE_COLORS],
      ['Vellum', VELLUM_COLORS],
    ] as const) {
      // Home's on the mat, the Trash's on the sheet, the New board dialog's on the raised fill.
      for (const surface of [
        '--color-ground-mat',
        '--color-surface-sheet',
        '--color-surface-raised',
      ] as const) {
        const ratio = contrastOf(colors['--color-line-search'], colors[surface]);
        expect(ratio, `${theme} on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
