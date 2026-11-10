import { describe, expect, it } from 'vitest';

import {
  colorForPrincipal,
  colourwayForPrincipal,
  PRESENCE_COLOURWAYS,
  PRESENCE_PALETTE,
} from './presence-color.js';

describe('colourwayForPrincipal', () => {
  it('gives a principal the same colourway on every client and every call', () => {
    expect(colourwayForPrincipal('user-42')).toBe(colourwayForPrincipal('user-42'));
  });

  it('picks from the six Ilkal colourways, in the brand kit’s order', () => {
    expect(PRESENCE_COLOURWAYS).toEqual(['gulabi', 'kesari', 'neeli', 'kempu', 'nerale', 'hasiru']);
    expect(PRESENCE_COLOURWAYS).toContain(colourwayForPrincipal('agent-layout'));
  });

  it('spreads many principals across every colourway', () => {
    const colourways = new Set(
      [...Array(200).keys()].map((index) => colourwayForPrincipal(`user-${String(index)}`)),
    );

    expect(colourways.size).toBe(PRESENCE_COLOURWAYS.length);
  });

  it('keeps the mapping fixed: the same ids land in the same colourways in every build', () => {
    // FNV-1a of the id, modulo six. A change here recolours every collaborator.
    expect(['user-1', 'user-2', 'user-3', 'agent-layout', 'Ada-id', ''].map(colourwayForPrincipal))
      .toMatchInlineSnapshot(`
      [
        "nerale",
        "kesari",
        "neeli",
        "kempu",
        "kesari",
        "kesari",
      ]
    `);
  });
});

describe('colorForPrincipal', () => {
  it('is the dark of the principal’s colourway', () => {
    for (const id of ['user-1', 'user-2', 'agent-layout', 'guest-7']) {
      const colourway = colourwayForPrincipal(id);
      expect(colorForPrincipal(id)).toBe(PRESENCE_PALETTE[PRESENCE_COLOURWAYS.indexOf(colourway)]);
    }
  });

  it('carries each colourway’s dark from the brand kit', () => {
    expect(PRESENCE_PALETTE).toEqual([
      '#cf4766',
      '#ea7a3c',
      '#296dc7',
      '#c74d29',
      '#7a52c9',
      '#3aa293',
    ]);
  });

  it('keeps every palette entry a #rrggbb colour', () => {
    for (const color of PRESENCE_PALETTE) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
