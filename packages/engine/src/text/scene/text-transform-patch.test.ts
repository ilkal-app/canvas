import { expect, it, vi } from 'vitest';

import { CAMERA, createTextSetUp, STYLE, textObject } from './__fixtures__/text-objects.js';
import { TEXT_PASS_NAME } from './text-pass.js';

it('moves retained text without preparing each glyph and matches full record preparation', async () => {
  const setup = createTextSetUp();
  const { renderer, document, settle } = setup;
  document.create(textObject('t', 'A long text with many glyphs'));
  renderer.enqueue(document.takeChanges());
  await settle();
  const pass = renderer.scene.passes.find(({ name }) => name === TEXT_PASS_NAME);
  if (!pass) throw new Error('Missing text pass');
  const prepare = vi.spyOn(pass, 'prepare');
  document.update('t', { x: 43.25, y: -9.75 });
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 2000, camera: CAMERA });
  expect(prepare).not.toHaveBeenCalled();
  const patched = setup.records().map((record) => [...record]);
  const pages = renderer.scene.pagesOf(TEXT_PASS_NAME)?.slice();
  const preparePatch = pass.preparePatch?.bind(pass);
  if (preparePatch === undefined) throw new Error('Missing retained-record support');
  pass.preparePatch = () => undefined;
  document.update('t', { x: 0, y: 0 });
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 2016, camera: CAMERA });
  document.update('t', { x: 43.25, y: -9.75 });
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 2032, camera: CAMERA });
  expect(setup.records().map((record) => [...record])).toEqual(patched);
  expect(renderer.scene.pagesOf(TEXT_PASS_NAME)).toEqual(pages);
  pass.preparePatch = preparePatch;
  prepare.mockClear();
  document.update('t', { text: 'Changed', runs: [{ length: 7, style: STYLE }] });
  renderer.enqueue(document.takeChanges());
  await settle();
  expect(prepare).toHaveBeenCalled();
});

it('keeps a shortened pending layout bounded when it moves before replacement glyphs land', async () => {
  const { renderer, document, settle, records } = createTextSetUp();
  document.create(textObject('t', 'Many previous glyphs'));
  renderer.enqueue(document.takeChanges());
  await settle();
  document.update('t', { text: 'A', runs: [{ length: 1, style: STYLE }] });
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 2000, camera: CAMERA });
  document.update('t', { x: 123 });
  renderer.enqueue(document.takeChanges());
  expect(() => renderer.renderFrame({ timeMs: 2016, camera: CAMERA })).not.toThrow();
  expect(records()[0]?.[0]).toBe(123);
  await settle();
  expect(records()[0]?.[0]).toBe(123);
});

it('keeps missing atlas glyph records entirely zero when moved before glyphs arrive', async () => {
  const { renderer, document, settle, records } = createTextSetUp();
  document.create(textObject('t', 'Atlas pending'));
  renderer.enqueue(document.takeChanges());
  await settle(1); // Finish layout only; the next frame requests the still-missing glyphs.
  renderer.renderFrame({ timeMs: 2000, camera: CAMERA });
  expect(records().every((record) => record.every((value) => value === 0))).toBe(true);
  document.update('t', { x: 123, y: -45 });
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 2016, camera: CAMERA });
  expect(records().every((record) => record.every((value) => value === 0))).toBe(true);
  await settle();
  expect(records()[0]?.[0]).toBe(123);
});
