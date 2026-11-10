import { describe, expect, it, vi } from 'vitest';

import type { FrameObject, ObjectId, PrincipalId } from '@canvas/schema';

import { CAMERA, createTextSetUp, textObject } from './__fixtures__/text-objects.js';
import { FRAME_TITLE_PASS, FRAME_TITLE_PASS_NAME } from './frame-title-pass.js';
import { TEXT_PASS, TEXT_PASS_NAME } from './text-pass.js';

function frame(id: string, fields: Partial<FrameObject> = {}): FrameObject {
  return {
    id: id as ObjectId,
    type: 'frame',
    parentId: null,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:fixture' as PrincipalId,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    width: 400,
    height: 300,
    name: id,
    clip: true,
    background: null,
    ...fields,
  };
}

function setUp() {
  const setup = createTextSetUp(CAMERA, true, false, { passes: [TEXT_PASS, FRAME_TITLE_PASS] });
  // Each record's clip index for an owner in a pass.
  const clipIndicesOf = (id: string, passName: string): number[] => {
    const buffer = setup.renderer.scene.instanceBufferOf(passName);
    const { floatsPerRecord, clipFloat = -1 } = buffer.layout;
    return setup.renderer.scene
      .slotsOf(id as ObjectId, passName)
      .map((slot) => buffer.data[slot * floatsPerRecord + clipFloat] ?? -1);
  };
  const slotOf = (id: string): number => setup.renderer.scene.clipTable.slotOf(id as ObjectId);
  return { ...setup, clipIndicesOf, slotOf };
}

describe('clip indices of text and frame titles', () => {
  it('clips a child text and a shown nested frame’s title, never the clipping frame’s own title', async () => {
    const { renderer, document, settle, clipIndicesOf, slotOf } = setUp();
    document.create(
      frame('outer'),
      // A nested frame shows its name only when asked; shown, it is clipped.
      frame('inner', { parentId: 'outer' as ObjectId, x: 20, y: 40, clip: false, showName: true }),
      textObject('caption', 'Clipped', { parentId: 'outer', x: 10, y: 10 }),
    );
    renderer.enqueue(document.takeChanges());
    await settle();
    const slot = slotOf('outer');
    expect(slot).toBeGreaterThan(0);
    const caption = clipIndicesOf('caption', TEXT_PASS_NAME);
    expect(caption.length).toBeGreaterThan(0);
    expect(caption).toEqual(caption.map(() => slot));
    const inner = clipIndicesOf('inner', FRAME_TITLE_PASS_NAME);
    expect(inner.length).toBeGreaterThan(0);
    expect(inner).toEqual(inner.map(() => slot));
    const outer = clipIndicesOf('outer', FRAME_TITLE_PASS_NAME);
    expect(outer.length).toBeGreaterThan(0);
    expect(outer).toEqual(outer.map(() => 0));
  });

  it('writes the clip index of text reparented into a clipping frame on the patch path, keeping its glyphs', async () => {
    const { renderer, document, settle, clipIndicesOf, slotOf } = setUp();
    document.create(frame('clip'), textObject('t', 'A long text with many glyphs', { x: 50 }));
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(new Set(clipIndicesOf('t', TEXT_PASS_NAME))).toEqual(new Set([0]));
    const pass = renderer.scene.passes.find(({ name }) => name === TEXT_PASS_NAME);
    if (pass === undefined) throw new Error('Missing text pass');
    const prepare = vi.spyOn(pass, 'prepare');
    document.update('t', { parentId: 'clip' as ObjectId });
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 2000, camera: CAMERA });
    expect(prepare).not.toHaveBeenCalled();
    expect(new Set(clipIndicesOf('t', TEXT_PASS_NAME))).toEqual(new Set([slotOf('clip')]));
  });
});
