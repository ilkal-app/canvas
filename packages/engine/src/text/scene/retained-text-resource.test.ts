import { expect, it } from 'vitest';

import { CAMERA, createTextSetUp, STYLE, textObject } from './__fixtures__/text-objects.js';

it('lands pending glyphs at the latest retained position and clears overrides before layout changes', async () => {
  const setup = createTextSetUp();
  const { renderer, document, settle, records, backend } = setup;
  const text = textObject('pending', 'Atlas pending');
  const ids = [text.id];
  document.create(text);
  renderer.enqueue(document.takeChanges());
  await settle(1);
  renderer.renderFrame({ timeMs: 2000, camera: CAMERA });
  expect(records().every((record) => record.every((value) => value === 0))).toBe(true);
  document.update(text.id, { x: 33.123, y: -15.125 });
  renderer.enqueueRetainedMove(document.takeChanges(), ids);
  renderer.renderFrame({ timeMs: 2016, camera: CAMERA });
  document.update(text.id, { x: 77.77777777, y: 22.333333333 });
  renderer.enqueueRetainedMove(document.takeChanges(), ids);
  renderer.renderFrame({ timeMs: 2032, camera: CAMERA });
  expect(records().every((record) => record.every((value) => value === 0))).toBe(true);
  await settle();
  const painted = records().filter((record) => (record[6] ?? 0) > 0);
  expect(painted.length).toBeGreaterThan(0);
  for (const record of painted) {
    expect(record[0]).toBe(Math.fround(77.77777777));
    expect(record[1]).toBe(Math.fround(22.333333333));
  }
  const replacement = 'A longer replacement that requires additional glyph slots';
  document.update(text.id, {
    text: replacement,
    runs: [{ length: replacement.length, style: STYLE }],
  });
  renderer.enqueue(document.takeChanges());
  await settle();
  expect(records().length).toBeGreaterThan(text.text.length);
  expect(
    backend.textures
      .filter((texture) => texture.label === 'move-transform-table')
      .every((texture) => texture.isDestroyed),
  ).toBe(true);
  for (const record of records().filter((record) => (record[6] ?? 0) > 0)) {
    expect(record[0]).toBe(Math.fround(77.77777777));
    expect(record[1]).toBe(Math.fround(22.333333333));
  }
  renderer.destroy();
});
