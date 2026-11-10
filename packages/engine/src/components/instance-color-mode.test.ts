import { describe, expect, it } from 'vitest';

import type { ObjectId, Rgba } from '@canvas/schema';

import { Scene } from '../scene/scene.js';
import { SDF_SHAPE_PASS, SDF_SHAPE_PASS_NAME } from '../shapes/shape-pass.js';

import {
  component,
  ComponentBoard,
  ExpansionHarness,
  instance,
  shape,
} from './__fixtures__/component-scene.js';
import { InstanceExpansion } from './instance-expansion.js';

const RED: Rgba = [1, 0, 0, 1];
const BLUE: Rgba = [0, 0, 1, 1];
const f32 = (color: readonly number[]) => Array.from(new Float32Array(color));
const OUTLINE = 13;

/**
 * A main on page A holding a token-outlined shape, an instance of it on page B that sets no mode,
 * another that sets light, and a main nesting an instance of the first; page B shown, each
 * expansion output applied to a scene, as the feed and the renderer do.
 *
 * @returns The harness, the scene and a reader of an outline's colour.
 */
function setUp() {
  const harness = new ExpansionHarness(
    new ComponentBoard(
      [
        component('main', { pageId: 'page-a', colorMode: 'dark' }),
        shape('dot', 'main', { stroke: { color: { token: 'brand' }, width: 2 } }),
        component('outer', { pageId: 'page-a' }),
        instance('nested', 'main', { parentId: 'outer' }),
        instance('plain', 'main', { pageId: 'page-b' }),
        instance('lit', 'main', { pageId: 'page-b', colorMode: 'light', x: 300 }),
        instance('wrap', 'outer', { pageId: 'page-b', y: 300 }),
      ],
      'page-b',
    ),
    InstanceExpansion,
  );
  const scene = new Scene([SDF_SHAPE_PASS], {
    colorTokens: new Map([['brand', { light: RED, dark: BLUE }]]),
  });
  let applied = 0;
  const step = (): void => {
    harness.step();
    for (const changes of harness.outputs.slice(applied)) scene.apply(changes);
    applied = harness.outputs.length;
  };
  const outline = (id: string): number[] => {
    const slot = scene.slotsOf(id as ObjectId, SDF_SHAPE_PASS_NAME)[0] ?? -1;
    const at = slot * SDF_SHAPE_PASS.layout.floatsPerRecord + OUTLINE;
    return Array.from(scene.instanceBufferOf(SDF_SHAPE_PASS_NAME).data.subarray(at, at + 4));
  };
  step();
  return { harness, scene, step, outline };
}

describe('instance colour modes', () => {
  it('draws an instance’s content in its own mode, else its main’s, the main on another page', () => {
    const { outline } = setUp();
    expect(outline('plain/dot')).toEqual(f32(BLUE));
    expect(outline('lit/dot')).toEqual(f32(RED));
    // Nested: the nested instance sets none, so its main's mode reaches it inside `wrap`.
    expect(outline('wrap/nested/dot')).toEqual(f32(BLUE));
  });

  it('re-resolves instances when their main’s mode changes, and the scene redraws them', () => {
    const { harness, scene, step, outline } = setUp();
    harness.board.update('main', { colorMode: 'light' });
    step();
    expect(outline('plain/dot')).toEqual(f32(RED));
    expect(outline('wrap/nested/dot')).toEqual(f32(RED));
    harness.board.update('main', { colorMode: undefined });
    step();
    expect(scene.setTheme('dark')).toBe(2);
    expect(outline('plain/dot')).toEqual(f32(BLUE));
    expect(outline('lit/dot')).toEqual(f32(RED));
  });

  it('keeps the main’s mode on an instance that only moves, reading nothing of the main', () => {
    const { harness, step, outline } = setUp();
    harness.board.resetReads();
    harness.board.update('plain', { x: 40 });
    step();
    expect(harness.board.reads.filter(({ id }) => id === 'main')).toEqual([]);
    expect(outline('plain/dot')).toEqual(f32(BLUE));
  });
});
