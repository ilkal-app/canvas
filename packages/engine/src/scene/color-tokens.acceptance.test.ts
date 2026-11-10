// Independent acceptance for token-driven scene records.
import { describe, expect, it } from 'vitest';

import { INK_COLORS, type ObjectId, type Rgba } from '@canvas/schema';

import { SDF_SHAPE_PASS, SDF_SHAPE_PASS_NAME } from '../shapes/shape-pass.js';

import { FakeSceneDocument, shapeObject } from './__fixtures__/scene-objects.js';
import { Scene } from './scene.js';

const RED: Rgba = [1, 0, 0, 1];
const BLUE: Rgba = [0, 0, 1, 1];
const f32 = (color: Rgba) => Array.from(new Float32Array(color));

type TokenScene = Scene & {
  setTokens(table: ReadonlyMap<string, unknown>): number;
};

function tokenScene() {
  const scene = new Scene([SDF_SHAPE_PASS], { instanceBuffer: { maxGapBytes: 0 } }) as TokenScene;
  const document = new FakeSceneDocument();
  document.create(
    shapeObject('token', { stroke: { color: { token: 'accent' } as never, width: 2 } }),
  );
  scene.apply(document.takeChanges());
  const buffer = scene.instanceBufferOf(SDF_SHAPE_PASS_NAME);
  const [slot] = scene.slotsOf('token' as ObjectId, SDF_SHAPE_PASS_NAME);
  const offset = (slot ?? 0) * SDF_SHAPE_PASS.layout.floatsPerRecord + 13;
  const color = () => Array.from(buffer.data.subarray(offset, offset + 4));
  return { scene, buffer, color };
}

describe('scene colour tokens', () => {
  it('draws a token stroke with a colour and re-resolves after a token edit without document reads', () => {
    const { scene, buffer, color } = tokenScene();
    expect(color()).not.toEqual([0, 0, 0, 0]);
    expect(color()).not.toEqual([0, 0, 0, 1]);
    expect(typeof scene.setTokens).toBe('function');
    buffer.clearDirty();
    const table = new Map([['accent', { name: 'Accent', light: RED, dark: BLUE }]]);
    expect(scene.setTokens(table)).toBe(1);
    expect(color()).toEqual(f32(RED));
    expect(buffer.dirtyRanges).toHaveLength(1);
    expect(scene.setTokens(new Map([['accent', { name: 'Accent', light: BLUE, dark: RED }]]))).toBe(
      1,
    );
    expect(color()).toEqual(f32(BLUE));
  });

  it('draws a token fill with a visible colour', () => {
    const scene = new Scene([SDF_SHAPE_PASS]);
    const document = new FakeSceneDocument();
    document.create(shapeObject('filled', { fill: { token: 'accent' } as never, stroke: null }));
    scene.apply(document.takeChanges());
    const [slot] = scene.slotsOf('filled' as ObjectId, SDF_SHAPE_PASS_NAME);
    expect(slot).toBeDefined();
    const buffer = scene.instanceBufferOf(SDF_SHAPE_PASS_NAME);
    const start = (slot ?? 0) * SDF_SHAPE_PASS.layout.floatsPerRecord + 4;
    const fill = Array.from(buffer.data.subarray(start, start + 4));
    expect(fill).not.toEqual([0, 0, 0, 0]);
    expect(fill).not.toEqual([0, 0, 0, 1]);
  });

  it('re-resolves unresolved ink refs on a theme switch while retaining the record slot', () => {
    const scene = new Scene([SDF_SHAPE_PASS], { instanceBuffer: { maxGapBytes: 0 } });
    const document = new FakeSceneDocument();
    document.create(
      shapeObject('ink-ref', { stroke: { color: { token: 'ink' } as never, width: 2 } }),
    );
    scene.apply(document.takeChanges());
    const [before] = scene.slotsOf('ink-ref' as ObjectId, SDF_SHAPE_PASS_NAME);
    expect(scene.setInk(INK_COLORS.dark)).toBe(1);
    const [after] = scene.slotsOf('ink-ref' as ObjectId, SDF_SHAPE_PASS_NAME);
    expect(after).toBe(before);
  });
});
