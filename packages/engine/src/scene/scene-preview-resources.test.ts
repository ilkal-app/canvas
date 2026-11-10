import { expect, it } from 'vitest';

import { TEXT_VECTOR_PASS } from '../text/scene/text-vector-pass.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, frameObject } from './__fixtures__/scene-objects.js';
import { NO_FRAME_TIMERS } from './frame-context.js';
import { FRAME_SHADOW_PASS } from './frame-shadow-pass.js';
import { FRAME_STROKE_PASS } from './frame-stroke-pass.js';
import { GridBackground } from './grid-background.js';
import { IMAGE_BORDER_PASS } from './image-border-pass.js';
import { LAYER_COMPOSITE_PASS } from './layers/layer-composite-pass.js';
import { SceneRenderer } from './scene-renderer.js';
import { SOLID_RECT_PASS } from './solid-rect-pass.js';

const CAMERA = { x: 0, y: 0, zoom: 1, dpr: 1, viewportWidthPx: 100, viewportHeightPx: 100 };

it('requires a completed built-in frame and the exact drawn camera', () => {
  const renderer = new SceneRenderer(new FakeGpuBackend());
  expect(renderer.readPreviewResources(CAMERA, 'fonts')).toBeUndefined();
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  expect(renderer.readPreviewResources(CAMERA, 'fonts')).toMatchObject({
    frameIndex: 0,
    images: [],
  });
  expect(renderer.readPreviewResources({ ...CAMERA, zoom: 2 }, 'fonts')).toBeUndefined();
  renderer.destroy();
  expect(renderer.readPreviewResources(CAMERA, 'fonts')).toBeUndefined();
});

it('refuses a same-name custom pass or an unknown frame extension', () => {
  const custom = new SceneRenderer(new FakeGpuBackend(), { passes: [{ ...SOLID_RECT_PASS }] });
  custom.renderFrame({ timeMs: 0, camera: CAMERA });
  expect(custom.readPreviewResources(CAMERA, 'fonts')).toBeUndefined();
  custom.destroy();
  const renderer = new SceneRenderer(new FakeGpuBackend());
  renderer.frame.insertStage('after', 'draw', { name: 'unknown', run: () => undefined });
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  expect(renderer.readPreviewResources(CAMERA, 'fonts')).toBeUndefined();
  renderer.destroy();
});

it('refuses custom backgrounds and a built-in background whose draw callback is replaced', () => {
  const backend = new FakeGpuBackend();
  const background = new GridBackground(backend);
  const renderer = new SceneRenderer(backend, { background });
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  expect(renderer.readPreviewResources(CAMERA, 'fonts')).toBeDefined();
  background.draw = () => undefined;
  renderer.renderFrame({ timeMs: 1, camera: CAMERA });
  expect(renderer.readPreviewResources(CAMERA, 'fonts')).toBeUndefined();
  renderer.destroy();
  background.destroy();
  const custom = new SceneRenderer(new FakeGpuBackend(), {
    background: { prepare: () => undefined, draw: () => undefined },
  });
  custom.renderFrame({ timeMs: 0, camera: CAMERA });
  expect(custom.readPreviewResources(CAMERA, 'fonts')).toBeUndefined();
  custom.destroy();
});

it('permits built-in no-op timers but refuses custom frame hooks', () => {
  const standard = new SceneRenderer(new FakeGpuBackend(), { timers: NO_FRAME_TIMERS });
  standard.renderFrame({ timeMs: 0, camera: CAMERA });
  expect(standard.readPreviewResources(CAMERA, 'fonts')).toBeDefined();
  standard.destroy();
  const custom = new SceneRenderer(new FakeGpuBackend(), { timers: { ...NO_FRAME_TIMERS } });
  custom.renderFrame({ timeMs: 0, camera: CAMERA });
  expect(custom.readPreviewResources(CAMERA, 'fonts')).toBeUndefined();
  custom.destroy();
});

it('revokes a completed certificate when background preparation is replaced', () => {
  const backend = new FakeGpuBackend();
  const background = new GridBackground(backend);
  const renderer = new SceneRenderer(backend, { background });
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  const ready = renderer.readPreviewResources(CAMERA, 'fonts');
  expect(ready?.isCurrent()).toBe(true);
  background.prepare = () => undefined;
  expect(ready?.isCurrent()).toBe(false);
  expect(renderer.readPreviewResources(CAMERA, 'fonts')).toBeUndefined();
  renderer.destroy();
  background.destroy();
});

it('accepts the stateless frame shadow pass as a built-in contributor', () => {
  // A built-in pass the reader does not know refuses every preview, so the site never cached one
  // once the standard passes gained the frame shadow pass.
  const renderer = new SceneRenderer(new FakeGpuBackend(), {
    passes: [FRAME_SHADOW_PASS, SOLID_RECT_PASS],
  });
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  expect(renderer.readPreviewResources(CAMERA, 'fonts')).toMatchObject({ frameIndex: 0 });
  renderer.destroy();
});

it('accepts the stateless frame stroke pass as a built-in contributor', () => {
  // As the frame shadow pass: a frame's outline is drawn from records alone.
  const renderer = new SceneRenderer(new FakeGpuBackend(), {
    passes: [SOLID_RECT_PASS, FRAME_STROKE_PASS],
  });
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  expect(renderer.readPreviewResources(CAMERA, 'fonts')).toMatchObject({ frameIndex: 0 });
  renderer.destroy();
});

it('accepts the stateless image border pass as a built-in contributor', () => {
  // As the frame stroke pass: a border is drawn from records alone. Left out, the site's cached
  // preview was refused on every board once the standard passes gained it.
  const renderer = new SceneRenderer(new FakeGpuBackend(), {
    passes: [SOLID_RECT_PASS, IMAGE_BORDER_PASS],
  });
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  expect(renderer.readPreviewResources(CAMERA, 'fonts')).toMatchObject({ frameIndex: 0 });
  renderer.destroy();
});

it('accepts the layer composite pass, with a layer drawn, as a built-in contributor', () => {
  // A preview of a board with a translucent frame: its layer is rendered and composited within
  // the certified frame, so the composite has no resource to wait for.
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, {
    passes: [SOLID_RECT_PASS, LAYER_COMPOSITE_PASS],
  });
  const document = new FakeSceneDocument();
  document.create(frameObject('frame', { opacity: 0.5 }));
  renderer.enqueue(document.takeChanges());
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  expect(backend.calls.some((call) => call.method === 'beginRenderPass' && call.target)).toBe(true);
  expect(renderer.readPreviewResources(CAMERA, 'fonts')).toMatchObject({ frameIndex: 0 });
  renderer.destroy();
});

it('admits the text vector companion, which holds no records without vector glyphs', () => {
  const renderer = new SceneRenderer(new FakeGpuBackend(), {
    passes: [SOLID_RECT_PASS, TEXT_VECTOR_PASS],
  });
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  expect(renderer.readPreviewResources(CAMERA, 'fonts')).toBeDefined();
  renderer.destroy();
});
