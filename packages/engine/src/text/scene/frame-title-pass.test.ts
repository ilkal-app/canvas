// The frame title pass through a real SceneRenderer: a frame's name laid out in CSS
// pixels above its top edge, one record per drawn character at the frame's place, the same
// records at every zoom (the shader scales them), and hidden while the frame is small on screen.
import { describe, expect, it, vi } from 'vitest';

import type { FrameObject, ObjectId, PrincipalId } from '@canvas/schema';

import { CAMERA, createTextSetUp, textObject } from './__fixtures__/text-objects.js';
import { FRAME_TITLE_BAND_PX, frameTitlePlacement, frameTitleTextOf } from './frame-title-box.js';
import {
  FRAME_TITLE_LEVEL_OF_DETAIL,
  FRAME_TITLE_PASS,
  FRAME_TITLE_PASS_KIND,
  FRAME_TITLE_PASS_NAME,
} from './frame-title-pass.js';

/**
 * A frame on the root.
 *
 * @param id - Its id.
 * @param name - Its name.
 * @param overrides - Fields to change.
 * @returns The frame.
 */
function frame(id: string, name: string, overrides: Partial<FrameObject> = {}): FrameObject {
  return {
    id: id as ObjectId,
    type: 'frame',
    parentId: null,
    x: 20,
    y: 60,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:ada' as PrincipalId,
    createdAt: 1,
    updatedAt: 1,
    width: 200,
    height: 100,
    name,
    clip: false,
    background: [1, 1, 1, 1],
    ...overrides,
  };
}

/**
 * A renderer drawing the frame title pass alone, with its records.
 *
 * @param isZOrdered - Whether frames draw in z-order segments (which leave out hidden names).
 * @returns The set-up, its records reading the frame title pass.
 */
function setUp(isZOrdered = false) {
  const setup = createTextSetUp(CAMERA, true, isZOrdered, { passes: [FRAME_TITLE_PASS] });
  const records = (): Float32Array[] => {
    const buffer = setup.renderer.scene.instanceBufferOf(FRAME_TITLE_PASS_NAME);
    const floats = buffer.layout.floatsPerRecord;
    return Array.from({ length: buffer.recordCount }, (ignored, slot) =>
      buffer.data.slice(slot * floats, (slot + 1) * floats),
    );
  };
  return { ...setup, records };
}

describe('frameTitlePlacement', () => {
  it('lays a frame’s name out on one line inside its title band, from its corner', () => {
    const geometry = frameTitlePlacement(frame('f', 'Plan'));
    expect(geometry).toMatchObject({ text: 'Plan', wrapWidth: null, align: 'left' });
    expect(geometry?.origin.x).toBe(0);
    expect(geometry?.origin.y).toBeLessThan(0);
    expect(geometry?.origin.y).toBeGreaterThanOrEqual(-FRAME_TITLE_BAND_PX);
    expect((geometry?.origin.y ?? 0) + (geometry?.boxHeight ?? 0)).toBeLessThan(0);
  });

  it('places nothing for a frame without a name or an object that is not a frame', () => {
    expect(frameTitlePlacement(frame('f', ''))).toBeUndefined();
    expect(frameTitlePlacement(textObject('t', 'Plan'))).toBeUndefined();
    expect(frameTitleTextOf(textObject('t', 'Plan'))).toBeUndefined();
    expect(frameTitleTextOf(frame('f', 'A b'))).toBe('A b');
  });

  it('places a name unless showName is false, as the scene resolves it', () => {
    const nested = { parentId: 'outer' as ObjectId };
    expect(frameTitlePlacement(frame('f', 'Plan', { ...nested, showName: true }))?.text).toBe(
      'Plan',
    );
    expect(frameTitlePlacement(frame('f', 'Plan', { ...nested, showName: false }))).toBeUndefined();
    expect(frameTitlePlacement(frame('f', 'Plan', { showName: false }))).toBeUndefined();
    expect(frameTitleTextOf(frame('f', 'Plan', { showName: false }))).toBeUndefined();
    const kind = FRAME_TITLE_PASS_KIND;
    expect(kind.hasDrawingBounds(frame('f', 'Plan'))).toBe(true);
    expect(kind.hasDrawingBounds(frame('f', 'Plan', { ...nested, showName: false }))).toBe(false);
    expect(kind.hasDrawingBounds(textObject('t', 'Plan'))).toBe(false);
  });

  it('measures the level of detail by the frame’s width, and draws at the device pixel ratio', () => {
    const detail = FRAME_TITLE_LEVEL_OF_DETAIL;
    expect(detail.sizeOf(frame('f', 'A'))).toBe(200);
    expect(detail.sizeOf(textObject('t', 'A'))).toBe(0);
    expect(detail.isSameSize?.(frame('f', 'A'), frame('f', 'B'))).toBe(true);
    expect(detail.isSameSize?.(frame('f', 'A'), frame('f', 'A', { width: 10 }))).toBe(false);
    expect(FRAME_TITLE_PASS_KIND.scaleOf({ ...CAMERA, zoom: 8, dpr: 2 })).toBe(2);
  });
});

describe('the frame title pass', () => {
  it('draws one record per character of the name, above the frame, at the frame’s place', async () => {
    const { renderer, document, settle, records } = setUp();
    document.create(frame('f', 'A b', { rotation: 0.5 }));
    renderer.enqueue(document.takeChanges());
    // It settles: once the name is laid out and its glyphs are in, it asks for no more frames.
    expect(await settle()).toBeLessThan(12);
    const drawn = records();
    expect(drawn).toHaveLength(2);
    for (const record of drawn) {
      // The frame's world origin and axis, then the glyph's rectangle in CSS px.
      expect([...record.slice(0, 2)]).toEqual([20, 60]);
      expect(record[2]).toBeCloseTo(Math.cos(0.5), 6);
      expect(record[3]).toBeCloseTo(Math.sin(0.5), 6);
      const top = record[5] ?? 0;
      const height = record[7] ?? 0;
      expect(top).toBeGreaterThan(-FRAME_TITLE_BAND_PX - 4);
      expect(top + height).toBeLessThan(4);
      expect(height).toBeLessThan(FRAME_TITLE_BAND_PX);
    }
  });

  it('keeps the same records at every zoom: the shader scales them, so a zoom writes nothing', async () => {
    const { renderer, document, settle, records } = setUp();
    document.create(frame('f', 'Plan'));
    renderer.enqueue(document.takeChanges());
    await settle();
    const before = records().map((record) => [...record]);
    const rewrite = vi.spyOn(renderer.scene, 'rewriteRecords');
    await settle(12, { ...CAMERA, zoom: 6 });
    await settle(12, { ...CAMERA, zoom: 0.5 });
    expect(rewrite).not.toHaveBeenCalled();
    expect(records().map((record) => [...record])).toEqual(before);
  });

  it('rewrites the records when the frame is renamed, and draws none for an empty name', async () => {
    const { renderer, document, settle, records } = setUp();
    document.create(frame('f', 'Plan'));
    renderer.enqueue(document.takeChanges());
    await settle();
    document.update('f', { name: 'Ideas!' });
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(records()).toHaveLength(6);
    document.update('f', { name: '' });
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(renderer.scene.slotsOf('f' as ObjectId, FRAME_TITLE_PASS_NAME)).toHaveLength(0);
  });

  it('gives each record its frame’s width, where the shader cuts the name, and a resize too', async () => {
    const { renderer, document, settle, records } = setUp();
    document.create(frame('f', 'Plan', { width: 240 }));
    renderer.enqueue(document.takeChanges());
    await settle();
    // The record's last own float, where the scene text shader reads its page's index.
    expect(records().map((record) => record[16])).toEqual([240, 240, 240, 240]);
    document.update('f', { width: 90 });
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(records().map((record) => record[16])).toEqual([90, 90, 90, 90]);
  });

  it('draws no records for a hidden name, and draws them again when it is shown', async () => {
    const { renderer, document, settle, records } = setUp();
    document.create(
      frame('outer', 'Outer', { width: 400, height: 300 }),
      frame('inner', 'Inner', { parentId: 'outer' as ObjectId, x: 10, y: 40 }),
    );
    renderer.enqueue(document.takeChanges());
    await settle();
    // The root frame's five letters only: the nested frame's name is hidden by default.
    expect(records()).toHaveLength(5);
    expect(renderer.scene.slotsOf('inner' as ObjectId, FRAME_TITLE_PASS_NAME)).toHaveLength(0);
    document.update('inner', { showName: true });
    document.update('outer', { showName: false });
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(renderer.scene.slotsOf('inner' as ObjectId, FRAME_TITLE_PASS_NAME)).toHaveLength(5);
    expect(renderer.scene.slotsOf('outer' as ObjectId, FRAME_TITLE_PASS_NAME)).toHaveLength(0);
  });

  it('hides a name when its group moves into a frame, and shows it when the group moves back', async () => {
    const { renderer, document, settle } = setUp();
    const slots = (id: string) => renderer.scene.slotsOf(id as ObjectId, FRAME_TITLE_PASS_NAME);
    document.create(
      frame('outer', 'Outer', { x: 400, width: 400, height: 300 }),
      { ...frame('group', '', { x: 0, y: 0 }), type: 'group' } as unknown as FrameObject,
      frame('card', 'Card', { parentId: 'group' as ObjectId, x: 10, y: 40 }),
    );
    renderer.enqueue(document.takeChanges());
    await settle();
    // Only groups above it: the card shows its name.
    expect(slots('card')).toHaveLength(4);
    // The group alone moves into the frame; the card is not in the change set.
    document.update('group', { parentId: 'outer' as ObjectId });
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(slots('card')).toHaveLength(0);
    document.update('group', { parentId: null });
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(slots('card')).toHaveLength(4);
  });

  it('hides a name inside a component, and a deleted ancestor frame shows it again', async () => {
    const { renderer, document, settle } = setUp();
    const slots = (id: string) => renderer.scene.slotsOf(id as ObjectId, FRAME_TITLE_PASS_NAME);
    document.create(
      {
        ...frame('main', '', { width: 400, height: 300 }),
        type: 'component',
      } as unknown as FrameObject,
      frame('in-main', 'Main', { parentId: 'main' as ObjectId }),
      frame('host', 'Host', { x: 600, width: 400, height: 300 }),
      frame('in-host', 'Kept', { parentId: 'host' as ObjectId }),
    );
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(slots('in-main')).toHaveLength(0);
    expect(slots('in-host')).toHaveLength(0);
    // The host goes and its child is left with no parent in the document: the root default.
    document.delete('host');
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(slots('in-host')).toHaveLength(4);
  });

  it('writes nothing for a hidden name at rest: a zoom rewrites no records', async () => {
    const { renderer, document, settle } = setUp();
    document.create(frame('f', 'Plan', { showName: false }));
    renderer.enqueue(document.takeChanges());
    await settle();
    const rewrite = vi.spyOn(renderer.scene, 'rewriteRecords');
    await settle(12, { ...CAMERA, zoom: 3 });
    expect(rewrite).not.toHaveBeenCalled();
    expect(renderer.scene.slotsOf('f' as ObjectId, FRAME_TITLE_PASS_NAME)).toHaveLength(0);
  });

  it('hides the name of a frame under 40 device px wide on screen', async () => {
    const { renderer, document, settle, backend } = setUp(true);
    document.create(frame('f', 'Plan', { width: 100 }));
    renderer.enqueue(document.takeChanges());
    await settle();
    backend.resetCalls();
    renderer.renderFrame({ timeMs: 9_000, camera: CAMERA });
    expect(backend.draws()).toHaveLength(1);
    // 100 units at 30%: 30 device px.
    renderer.renderFrame({ timeMs: 9_016, camera: { ...CAMERA, zoom: 0.3 } });
    backend.resetCalls();
    renderer.renderFrame({ timeMs: 9_032, camera: { ...CAMERA, zoom: 0.3 } });
    expect(backend.draws()).toHaveLength(0);
  });
});
