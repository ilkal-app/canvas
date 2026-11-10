import { afterEach, expect, it, vi } from 'vitest';

import { textObject } from './__fixtures__/text-objects.js';
import { TextLayoutKey } from './text-layout-key.js';
import { textPlacementOf, type TextBoxGeometry } from './text-placement.js';

afterEach(() => vi.restoreAllMocks());

const expected = (geometry: TextBoxGeometry, fonts: string): string =>
  JSON.stringify([
    fonts,
    geometry.wrapWidth,
    geometry.align,
    geometry.direction,
    geometry.fitHeight ?? null,
    geometry.runs,
    geometry.text,
  ]);

it('does not serialize unchanged text inputs on translated or vertically moved boxes', () => {
  const geometry = textPlacementOf(textObject('label', 'Move me'));
  const cache = new TextLayoutKey();
  const serialize = vi.spyOn(JSON, 'stringify');
  const first = cache.of(geometry, 'fonts');
  for (let index = 0; index < 100; index += 1) {
    expect(
      cache.of({ ...geometry, origin: { x: index, y: index }, boxHeight: 100 + index }, 'fonts'),
    ).toBe(first);
  }
  expect(serialize).toHaveBeenCalledTimes(1);
});

it('matches full input serialization for every layout-affecting change', () => {
  const base = textPlacementOf(textObject('label', 'Move me'));
  const cache = new TextLayoutKey();
  const runs = base.runs.map((run) => ({ ...run, style: { ...run.style, fontSize: 48 } }));
  const geometries: TextBoxGeometry[] = [
    base,
    { ...base, text: 'Other text' },
    { ...base, wrapWidth: 14 },
    { ...base, align: 'right' },
    { ...base, direction: 'rtl' },
    { ...base, fitHeight: 168 },
    { ...base, runs },
    base,
  ];
  for (const fonts of ['first', 'second', 'first']) {
    for (const geometry of geometries)
      expect(cache.of(geometry, fonts)).toBe(expected(geometry, fonts));
  }
});
