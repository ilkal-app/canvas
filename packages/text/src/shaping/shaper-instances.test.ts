import { readFileSync } from 'node:fs';

import { expect, it } from 'vitest';

import { MAX_VARIATION_INSTANCES, loadShaper, shapeText } from './shaper.js';

const BYTES = new Uint8Array(
  readFileSync(new URL('../__fixtures__/format-corpus/corpus-sans-variable.ttf', import.meta.url)),
);

it('keeps every held instance face across sweeps of its source', async () => {
  const shaper = await loadShaper();
  const id = 'unit-instances-sweep';
  // Steps of 1/16 within 400–700: more faces than two sweeps' sizes, all held.
  const count = 4 * MAX_VARIATION_INSTANCES + 1;
  const held = Array.from({ length: count }, (unused, index) =>
    shaper.face(id, BYTES, { wght: 400 + (index + 1) / 16 }),
  );
  for (const [index, face] of held.entries()) {
    expect(shaper.face(id, BYTES, { wght: 400 + (index + 1) / 16 })).toBe(face);
  }
  expect(shapeText(shaper, held.at(0) ?? shaper.face(id, BYTES), 'A', 0, 1).glyphs).toHaveLength(1);
});
