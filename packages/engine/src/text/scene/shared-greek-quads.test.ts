import { expect, it } from 'vitest';

import { layoutText } from '@canvas/text';

import { FakeGlyphMeasurer } from '../layout/__fixtures__/fake-glyph-measurer.js';

import { greekQuads } from './greek-quads.js';
import { SharedGreekQuads } from './shared-greek-quads.js';

function layout(text = 'ab cd\nef') {
  return layoutText(
    text,
    [
      {
        length: text.length,
        style: {
          fontFamily: 'Fake',
          fontSize: 10,
          color: [0.2, 0.4, 0.6, 1],
          weight: 400,
          italic: false,
        },
      },
    ],
    null,
    new FakeGlyphMeasurer(),
  );
}

it('shares immutable bars for many objects using the same layout and local origin', () => {
  const cache = new SharedGreekQuads();
  const text = layout();
  const first = cache.get(text, { x: 5, y: 7 });
  for (let index = 0; index < 100; index++) {
    expect(cache.get(text, { x: 5, y: 7 })).toBe(first);
  }
  expect(first).toEqual(greekQuads(text, { x: 5, y: 7 }));
});

it('keeps only the latest origin and preserves exact uncached bar geometry', () => {
  const cache = new SharedGreekQuads();
  const text = layout();
  const first = cache.get(text, { x: 0, y: 0 });
  for (const origin of [
    { x: 4, y: 0 },
    { x: 4, y: -8 },
    { x: 0, y: 0 },
  ]) {
    const result = cache.get(text, origin);
    expect(result).not.toBe(first);
    expect(result).toEqual(greekQuads(text, origin));
  }
  const changed = layout('different');
  expect(cache.get(changed, { x: 0, y: 0 })).toEqual(greekQuads(changed, { x: 0, y: 0 }));
});
