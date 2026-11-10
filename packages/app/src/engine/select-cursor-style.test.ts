import { describe, expect, it } from 'vitest';

import { ROTATE_CURSOR_STEPS } from '@canvas/tools';

import {
  createRotateCursorImages,
  cssCursorOf,
  ROTATE_CURSOR_CSS,
  rotateCursorTurnOf,
} from './select-cursor-style.js';

const DEGREE = Math.PI / 180;

/**
 * The SVG inside a CSS cursor value.
 *
 * @param css - The value.
 * @returns The decoded SVG.
 */
function svgOf(css: string): string {
  return decodeURIComponent(/^url\("data:image\/svg\+xml,([^"]+)"\)/.exec(css)?.[1] ?? '');
}

/**
 * The rotate cursor at an angle.
 *
 * @param degrees - The angle, degrees clockwise from the untouched icon.
 * @returns The cursor.
 */
function rotateAt(degrees: number) {
  return { kind: 'rotate' as const, angle: degrees * DEGREE };
}

describe('cssCursorOf', () => {
  it('maps the default cursor to the browser’s default', () => {
    expect(cssCursorOf('default')).toBe('default');
  });

  it('maps the rotate cursor to an inline SVG image with a centred hotspot and a fallback', () => {
    const css = cssCursorOf(rotateAt(30));
    expect(css).toMatch(/^url\("data:image\/svg\+xml,[^"]+"\) 12 12, crosshair$/);
    expect(svgOf(css)).toMatch(
      /^<svg xmlns='http:\/\/www\.w3\.org\/2000\/svg' width='24' height='24'/,
    );
  });

  it('shows the icon untouched for the top-left corner of an unturned box', () => {
    expect(cssCursorOf(rotateAt(0))).toBe(ROTATE_CURSOR_CSS);
    expect(cssCursorOf(rotateAt(360))).toBe(ROTATE_CURSOR_CSS);
    expect(svgOf(ROTATE_CURSOR_CSS)).not.toContain('rotate(');
  });

  it('turns the icon about its hotspot by the cursor’s angle', () => {
    expect(svgOf(cssCursorOf(rotateAt(90)))).toContain("<g transform='rotate(90 12 12)'>");
    expect(svgOf(cssCursorOf(rotateAt(180)))).toContain("<g transform='rotate(180 12 12)'>");
    expect(svgOf(cssCursorOf(rotateAt(270)))).toContain("<g transform='rotate(270 12 12)'>");
    // Quantised to the nearest 15°.
    expect(cssCursorOf(rotateAt(97))).toBe(cssCursorOf(rotateAt(90)));
    expect(svgOf(cssCursorOf(rotateAt(52)))).toContain('rotate(45 12 12)');
  });
});

describe('rotateCursorTurnOf', () => {
  it('rounds the angle to 15° within one turn, clockwise', () => {
    expect([0, 90, 180, 270].map((degrees) => rotateCursorTurnOf(degrees * DEGREE))).toEqual([
      0, 90, 180, 270,
    ]);
    expect(rotateCursorTurnOf(-15 * DEGREE)).toBe(345);
    expect(rotateCursorTurnOf(405 * DEGREE)).toBe(45);
  });
});

describe('createRotateCursorImages', () => {
  it('builds one value per orientation step, on first use, and reuses it', () => {
    const images = createRotateCursorImages();
    expect(images.size).toBe(0);
    const first = images.cssOf(rotateAt(44));
    expect(images.cssOf(rotateAt(50))).toBe(first);
    expect(images.size).toBe(1);
    expect(images.cssOf(rotateAt(60))).not.toBe(first);
    expect(images.size).toBe(2);
    for (let degrees = -180; degrees < 540; degrees += 5) images.cssOf(rotateAt(degrees));
    expect(images.size).toBe(ROTATE_CURSOR_STEPS);
  });
});
