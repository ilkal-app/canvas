import { afterEach, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { Camera } from '../../camera/camera.js';
import { SpatialCuller } from '../../spatial/spatial-culler.js';
import { loadBundledFaces } from '../__fixtures__/bundled-fonts.js';

import { CAMERA, createTextSetUp, textObject } from './__fixtures__/text-objects.js';
import { TEXT_PASS, TEXT_PASS_NAME } from './text-pass.js';
import { isTextPreviewReady } from './text-preview-readiness.js';

afterEach(() => vi.restoreAllMocks());

it('waits for successful catalogue, layout, requested glyphs and uploaded pages', async () => {
  const { renderer, document, settle, fonts } = createTextSetUp();
  const pass = renderer.scene.passes.find(({ name }) => name === TEXT_PASS_NAME);
  if (pass === undefined) throw new Error('Missing text pass');
  const key = await fonts.prepareContentIdentity(fonts.faces);
  if (key === undefined) throw new Error('Missing font identity');
  document.create(textObject('text', 'Hi'));
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  expect(isTextPreviewReady(pass, key)).toBe(false);
  expect(renderer.readPreviewResources(CAMERA, key)).toBeUndefined();
  await settle();
  expect(isTextPreviewReady(pass, key)).toBe(true);
  expect(renderer.readPreviewResources(CAMERA, key)?.isCurrent()).toBe(true);
  expect(isTextPreviewReady(pass, 'other')).toBe(false);
  renderer.destroy();
  expect(isTextPreviewReady(pass, key)).toBe(false);
});

it('refuses same-face replacement even after a new content identity and later frames', async () => {
  const { renderer, document, settle, fonts } = createTextSetUp();
  const pass = renderer.scene.passes.find(({ name }) => name === TEXT_PASS_NAME);
  if (pass === undefined) throw new Error('Missing text pass');
  const old = await fonts.prepareContentIdentity(fonts.faces);
  if (old === undefined) throw new Error('Missing identity');
  document.create(textObject('text', 'Hi'));
  renderer.enqueue(document.takeChanges());
  await settle();
  expect(isTextPreviewReady(pass, old)).toBe(true);
  const [regular, bold] = loadBundledFaces();
  if (regular === undefined || bold === undefined) throw new Error('Missing fonts');
  fonts.addFace(regular.face, bold.bytes);
  expect(isTextPreviewReady(pass, old)).toBe(false);
  const changed = await fonts.prepareContentIdentity(fonts.faces);
  if (changed === undefined) throw new Error('Missing identity');
  await settle();
  expect(isTextPreviewReady(pass, changed)).toBe(false);
  renderer.destroy();
});

it('refuses landed-but-not-drawn layout and glyph work, and stale geometry layouts', async () => {
  const { renderer, document, settle, fonts, pool } = createTextSetUp();
  const pass = renderer.scene.passes.find(({ name }) => name === TEXT_PASS_NAME);
  if (pass === undefined) throw new Error('Missing text pass');
  const key = await fonts.prepareContentIdentity(fonts.faces);
  if (key === undefined) throw new Error('Missing identity');
  document.create(textObject('text', 'Hi'));
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  pool.drainMainThread(1_000, () => 0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(isTextPreviewReady(pass, key)).toBe(false);
  renderer.renderFrame({ timeMs: 16, camera: CAMERA });
  await new Promise((resolve) => setTimeout(resolve, 0));
  pool.drainMainThread(1_000, () => 0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(isTextPreviewReady(pass, key)).toBe(false);
  await settle();
  expect(isTextPreviewReady(pass, key)).toBe(true);
  document.update('text', { width: 40, autoWidth: false });
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 100, camera: CAMERA });
  expect(isTextPreviewReady(pass, key)).toBe(false);
  await settle();
  expect(isTextPreviewReady(pass, key)).toBe(true);
  renderer.destroy();
});

it('never accepts old glyph work that lands after a face replacement', async () => {
  const { renderer, document, settle, fonts, pool } = createTextSetUp();
  const submitted = vi.spyOn(pool, 'submit');
  const pass = renderer.scene.passes.find(({ name }) => name === TEXT_PASS_NAME);
  if (pass === undefined) throw new Error('Missing text pass');
  await fonts.prepareContentIdentity(fonts.faces);
  document.create(textObject('text', 'Hi'));
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  pool.drainMainThread(1_000, () => 0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  renderer.renderFrame({ timeMs: 16, camera: CAMERA });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(submitted.mock.calls.some(([kind]) => kind === 'msdf')).toBe(true);
  expect(pool.pendingCount).toBeGreaterThan(0);
  const [regular, bold] = loadBundledFaces();
  if (regular === undefined || bold === undefined) throw new Error('Missing fonts');
  fonts.addFace(regular.face, bold.bytes);
  const current = await fonts.prepareContentIdentity(fonts.faces);
  if (current === undefined) throw new Error('Missing identity');
  pool.drainMainThread(1_000, () => 0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(isTextPreviewReady(pass, current)).toBe(false);
  await settle();
  expect(isTextPreviewReady(pass, current)).toBe(false);
  renderer.destroy();
});

it('leaves out text waiting off-screen for view that the preview does not hold', async () => {
  // Off-screen text an atlas change made stale waits for view, drawn in glyphs it
  // asked for before they landed. Counted, it refused every preview of a board larger than the
  // viewport; but only what the preview holds may be left out: a capped culler admission or a
  // coverage wider than the view can hold text that still waits.
  const { renderer, document, settle, fonts } = createTextSetUp(CAMERA, true, false, {
    culler: new SpatialCuller({ paddingFraction: 0 }),
    passes: [TEXT_PASS],
  });
  const pass = renderer.scene.passes.find(({ name }) => name === TEXT_PASS_NAME);
  if (pass === undefined) throw new Error('Missing text pass');
  const key = await fonts.prepareContentIdentity(fonts.faces);
  if (key === undefined) throw new Error('Missing identity');
  document.create(textObject('visible', 'A'), textObject('offscreen', 'B', { x: 1_000 }));
  renderer.enqueue(document.takeChanges());
  await settle();
  expect(renderer.scene.levelOfDetail.visibleIds).toEqual(['visible']);
  const inView = ['visible'] as ObjectId[];
  expect(isTextPreviewReady(pass, key, new Set(inView))).toBe(true);
  expect(renderer.readPreviewResources(CAMERA, key, inView)?.isCurrent()).toBe(true);
  expect(isTextPreviewReady(pass, key)).toBe(false);
  const both = ['visible', 'offscreen'] as ObjectId[];
  expect(isTextPreviewReady(pass, key, new Set(both))).toBe(false);
  expect(renderer.readPreviewResources(CAMERA, key, both)).toBeUndefined();
  // In view at a scale whose glyph tier has not landed, it counts again until it has.
  const panned: Camera = { ...CAMERA, x: 1_000, zoom: 8 };
  const shown = ['offscreen'] as ObjectId[];
  renderer.renderFrame({ timeMs: 1_000, camera: panned });
  expect(renderer.scene.levelOfDetail.visibleIds).toEqual(shown);
  expect(isTextPreviewReady(pass, key, new Set(shown))).toBe(false);
  expect(renderer.readPreviewResources(panned, key, shown)).toBeUndefined();
  await settle(12, panned);
  expect(isTextPreviewReady(pass, key, new Set(shown))).toBe(true);
  expect(renderer.readPreviewResources(panned, key, shown)?.isCurrent()).toBe(true);
  renderer.destroy();
});
