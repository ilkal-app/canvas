import { describe, expect, it } from 'vitest';

import type { BoardObject, Rgba } from '@canvas/schema';

import { paletteOf, textPaletteOf } from '../paint/color-palette.js';

import { frameObject, shapeObject } from './__fixtures__/scene-objects.js';
import { ColorTargets } from './color-targets.js';
import type { SceneSource } from './scene-source.js';

const PASTEL: Rgba = [1, 0.93, 0.6, 1];
const PALE_BLUE: Rgba = [0.87, 0.93, 1, 1];
const NAVY: Rgba = [0.05, 0.08, 0.2, 1];
const AT = { cos: 1, sin: 0, x: 0, y: 0 };
const INK_LABEL = { text: 'Hi', runs: [{ length: 2, style: { color: 'ink' } }] };

/**
 * A sticky drawn with ink text on a fill.
 *
 * @param id - Its id.
 * @param color - Its fill.
 * @param parentId - Its parent.
 * @returns The sticky.
 */
function sticky(id: string, color: unknown, parentId: string | null = null): BoardObject {
  return {
    ...shapeObject(id, parentId === null ? {} : { parentId: parentId }),
    type: 'sticky',
    color,
    ...INK_LABEL,
    autoWidth: false,
  } as unknown as BoardObject;
}

/**
 * A source over some objects.
 *
 * @param objects - The objects.
 * @returns The source.
 */
function sourceOf(...objects: BoardObject[]): SceneSource {
  const byId = new Map(objects.map((object) => [object.id, object]));
  return { get: (id) => byId.get(id) };
}

const labelled = (id: string, fill: unknown) =>
  shapeObject(id, { fill: fill as Rgba, label: INK_LABEL as never });

describe('ColorTargets container text', () => {
  it('draws a pastel sticky’s and a pale shape’s ink text in the light palette in Graphite', () => {
    const targets = new ColorTargets({ theme: 'dark' });
    for (const object of [sticky('n', PASTEL), labelled('s', PALE_BLUE)]) {
      const target = targets.targetOf(object, AT, sourceOf(object));
      expect(paletteOf(target).mode).toBe('dark');
      expect(textPaletteOf(target).mode).toBe('light');
    }
  });

  it('needs no text palette where the fill agrees with the mode, or there is no fill', () => {
    const light = new ColorTargets({ theme: 'light' });
    const note = sticky('n', PASTEL);
    expect(light.targetOf(note, AT, sourceOf(note)).textPalette).toBeUndefined();
    const dark = new ColorTargets({ theme: 'dark' });
    const unfilled = labelled('s', null);
    expect(dark.targetOf(unfilled, AT, sourceOf(unfilled)).textPalette).toBeUndefined();
    const night = labelled('d', NAVY);
    expect(dark.targetOf(night, AT, sourceOf(night)).textPalette).toBeUndefined();
    expect(textPaletteOf(light.targetOf(night, AT, sourceOf(night))).mode).toBe('dark');
  });

  it('keeps a sticky’s text dark inside an explicit dark frame', () => {
    const targets = new ColorTargets({ theme: 'light' });
    const frame = frameObject('f', { colorMode: 'dark' } as never);
    const note = sticky('n', PASTEL, 'f');
    const target = targets.targetOf(note, AT, sourceOf(frame, note));
    expect(paletteOf(target).mode).toBe('dark');
    expect(textPaletteOf(target).mode).toBe('light');
    expect(targets.setTheme('dark')).toEqual([]);
  });

  it('hands back the target with its text palette on a theme switch, and current agrees', () => {
    const targets = new ColorTargets({ theme: 'light' });
    const note = sticky('n', PASTEL);
    const before = targets.targetOf(note, AT, sourceOf(note));
    const [after] = targets.setTheme('dark');
    expect(after && paletteOf(after).mode).toBe('dark');
    expect(after && textPaletteOf(after).mode).toBe('light');
    expect(targets.current(before)).toEqual(after);
    const [back] = targets.setTheme('light');
    expect(back?.textPalette).toBeUndefined();
    expect(back && 'textPalette' in back).toBe(false);
  });

  it('follows a token fill into the mode it draws in', () => {
    const targets = new ColorTargets({ theme: 'dark' });
    const note = sticky('n', { token: 'surface' });
    // Surface is dark in Graphite: the text stays light.
    expect(targets.targetOf(note, AT, sourceOf(note)).textPalette).toBeUndefined();
    const brand = new Map([['surface', { light: NAVY, dark: PASTEL }]]);
    const [repainted] = targets.setTokens(brand);
    expect(repainted && textPaletteOf(repainted).mode).toBe('light');
  });
});
