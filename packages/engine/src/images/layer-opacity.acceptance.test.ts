// Slice C1 (layer opacity): an image record carries its parent multiplier.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { groupObject, FakeSceneDocument } from '../scene/__fixtures__/scene-objects.js';
import { SceneRenderer } from '../scene/scene-renderer.js';

import { imageObject } from './__fixtures__/image-objects.js';
import { IMAGE_PASS, IMAGE_PASS_NAME } from './image-pass.js';

const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 400, viewportHeightPx: 300, dpr: 1 };

describe('image record layer opacity', () => {
  it('combines its own image opacity and the group multiplier', () => {
    const renderer = new SceneRenderer(new FakeGpuBackend(), { passes: [IMAGE_PASS] });
    const document = new FakeSceneDocument();
    document.create(
      groupObject('group', { opacity: 0.5 }),
      imageObject({ id: 'image' as ObjectId, parentId: 'group' as ObjectId, opacity: 0.5 }),
    );
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    const [slot] = renderer.scene.slotsOf('image' as ObjectId, IMAGE_PASS_NAME);
    if (slot === undefined) throw new Error('missing image record');
    const layout = renderer.scene.passes.find((pass) => pass.name === IMAGE_PASS_NAME)?.layout;
    if (layout === undefined) throw new Error('missing image layout');
    const data = renderer.scene.instanceBufferOf(IMAGE_PASS_NAME).data;
    const own = data[slot * layout.floatsPerRecord + 20] ?? Number.NaN;
    const transparency =
      data[slot * layout.floatsPerRecord + (layout.opacityFloat ?? -1)] ?? Number.NaN;
    expect(own * (1 - transparency)).toBeCloseTo(0.25);
    renderer.destroy();
  });
});
