// Slice C1 (layer opacity): pure cumulative multiply and per-record transparency.
import { describe, expect, it } from 'vitest';

import { FILLED_RECT_PASS } from './__fixtures__/filled-rect-pass.js';
import {
  FakeSceneDocument,
  frameObject,
  groupObject,
  shapeObject,
} from './__fixtures__/scene-objects.js';
import { resolveSceneInstanceLayout } from './instance-layout.js';
import { SceneOpacity } from './scene-opacity.js';
import { Scene } from './scene.js';

const object = (id: string, parentId: string | null, opacity?: number) =>
  shapeObject(id, { parentId: parentId as never, ...(opacity === undefined ? {} : { opacity }) });

describe('multiply scene opacity', () => {
  it('multiplies own and ancestor opacity and defaults absence to one', () => {
    const objects = new Map([
      ['main', object('main', null, 0.8)],
      ['group', object('group', 'main', 0.5)],
      ['shape', object('shape', 'group', 0.5)],
      ['plain', object('plain', null)],
    ]);
    const opacity = new SceneOpacity();
    const source = { get: (id: string) => objects.get(id) };
    const must = (id: string) => {
      const found = objects.get(id);
      if (found === undefined) throw new Error(`missing ${id}`);
      return found;
    };
    expect(opacity.update(must('shape'), source as never)).toBeCloseTo(0.2);
    expect(opacity.update(must('plain'), source as never)).toBe(1);
    expect(opacity.update(object('zero', 'group', 0), source as never)).toBe(0);
  });

  it('writes cumulative transparency into a descendant record', () => {
    const document = new FakeSceneDocument();
    const scene = new Scene([FILLED_RECT_PASS], { instanceBuffer: { maxGapBytes: 0 } });
    document.create(
      frameObject('frame', { opacity: 0.5 }),
      groupObject('group', { parentId: 'frame', opacity: 0.5 }),
      shapeObject('child', { parentId: 'group', opacity: 0.5 }),
    );
    scene.apply(document.takeChanges());
    const [slot] = scene.slotsOf('child' as never, 'solid-rect');
    if (slot === undefined) throw new Error('missing child record');
    const layout = FILLED_RECT_PASS.layout;
    const data = scene.instanceBufferOf('solid-rect').data;
    expect(data[slot * layout.floatsPerRecord + (layout.opacityFloat ?? -1)]).toBeCloseTo(
      1 - 0.125,
    );
  });

  it('allocates a trailing transparency float for every scene record', () => {
    const layout = resolveSceneInstanceLayout([{ location: 0, format: 'float32x4' }]);
    expect(layout.opacityFloat).toBe(layout.floatsPerRecord - 1);
    expect(layout.clipFloat).toBe(layout.floatsPerRecord - 2);
  });
});
