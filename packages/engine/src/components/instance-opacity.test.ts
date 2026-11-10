import { describe, expect, it } from 'vitest';

import type { InstanceObject, ObjectId } from '@canvas/schema';

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
import {
  isShownLayerChanged,
  mainLayerOf,
  mainOpacityOf,
  withMainLayer,
  withMainOpacity,
} from './instance-opacity.js';

/**
 * A main on page A at half opacity holding a half-opaque shape, an instance of it on page B that
 * sets no opacity, one that sets its own, one that overrides the child's, and a main nesting an
 * instance of the first; page B shown, each expansion output applied to a scene.
 *
 * @returns The harness, a stepper and a reader of a record's opacity.
 */
function setUp() {
  const harness = new ExpansionHarness(
    new ComponentBoard(
      [
        component('main', { pageId: 'page-a', opacity: 0.5 }),
        shape('dot', 'main', { opacity: 0.5 }),
        component('outer', { pageId: 'page-a' }),
        instance('nested', 'main', { parentId: 'outer' }),
        instance('plain', 'main', { pageId: 'page-b' }),
        instance('own', 'main', { pageId: 'page-b', opacity: 1, x: 300 }),
        instance('override', 'main', {
          pageId: 'page-b',
          y: 300,
          overrides: { dot: { opacity: 1 } },
        }),
        instance('wrap', 'outer', { pageId: 'page-b', x: 300, y: 300 }),
      ],
      'page-b',
    ),
    InstanceExpansion,
  );
  const scene = new Scene([SDF_SHAPE_PASS]);
  let applied = 0;
  const step = (): void => {
    harness.step();
    for (const changes of harness.outputs.slice(applied)) scene.apply(changes);
    applied = harness.outputs.length;
  };
  const { floatsPerRecord, opacityFloat = -1 } = SDF_SHAPE_PASS.layout;
  const opacityOf = (id: string): number | undefined => {
    const [slot] = scene.slotsOf(id as ObjectId, SDF_SHAPE_PASS_NAME);
    const data = scene.instanceBufferOf(SDF_SHAPE_PASS_NAME).data;
    const transparency =
      slot === undefined ? undefined : data[slot * floatsPerRecord + opacityFloat];
    return transparency === undefined ? undefined : 1 - transparency;
  };
  step();
  return { harness, step, opacityOf };
}

describe('instance layer opacity', () => {
  it('fades an instance’s content by its own opacity, else its main’s, the main on another page', () => {
    const { opacityOf } = setUp();
    expect(opacityOf('plain/dot')).toBeCloseTo(0.25);
    expect(opacityOf('own/dot')).toBeCloseTo(0.5);
    // A child's override replaces its own opacity; the main's still reaches it.
    expect(opacityOf('override/dot')).toBeCloseTo(0.5);
    // Nested: the nested instance sets none, so its main's opacity reaches it inside `wrap`.
    expect(opacityOf('wrap/nested/dot')).toBeCloseTo(0.25);
  });

  it('re-resolves instances when their main’s opacity changes, and the scene rewrites them', () => {
    const { harness, step, opacityOf } = setUp();
    harness.board.update('main', { opacity: undefined });
    step();
    expect(opacityOf('plain/dot')).toBeCloseTo(0.5);
    expect(opacityOf('wrap/nested/dot')).toBeCloseTo(0.5);
    harness.board.update('main', { opacity: 0.8 });
    step();
    expect(opacityOf('plain/dot')).toBeCloseTo(0.4);
  });
});

describe('instance layer opacity with a content scale (D1)', () => {
  it('draws a scaled instance’s content larger and faded by both opacities', () => {
    const harness = new ExpansionHarness(
      new ComponentBoard([
        component('main', { opacity: 0.5 }),
        shape('dot', 'main', { width: 40, height: 20, opacity: 0.5 }),
        instance('big', 'main', { x: 400, width: 200, height: 200, scale: 2, opacity: 0.8 }),
      ]),
      InstanceExpansion,
    );
    harness.step();
    const scene = new Scene([SDF_SHAPE_PASS]);
    for (const changes of harness.outputs) scene.apply(changes);
    expect(harness.mirror.get('big/dot')).toMatchObject({ width: 80, height: 40, opacity: 0.5 });
    const [slot] = scene.slotsOf('big/dot' as ObjectId, SDF_SHAPE_PASS_NAME);
    const { floatsPerRecord, opacityFloat = -1 } = SDF_SHAPE_PASS.layout;
    const data = scene.instanceBufferOf(SDF_SHAPE_PASS_NAME).data;
    const transparency =
      slot === undefined ? undefined : data[slot * floatsPerRecord + opacityFloat];
    // The instance's own 0.8 beats its main's 0.5; the child's own 0.5 multiplies in.
    expect(transparency).toBeCloseTo(1 - 0.4);
  });
});

describe('a main’s layer handed down', () => {
  const main = component('main', { opacity: 0.5, colorMode: 'dark' });
  const plain = instance('plain', 'main') as InstanceObject;

  it('hands down a component’s opacity below 1, and nothing of another object', () => {
    expect(mainOpacityOf(main)).toBe(0.5);
    expect(mainOpacityOf(component('opaque', { opacity: 1 }))).toBeUndefined();
    expect(mainOpacityOf(component('unset'))).toBeUndefined();
    expect(mainOpacityOf(shape('dot', null, { opacity: 0.5 }))).toBeUndefined();
    expect(mainOpacityOf(undefined)).toBeUndefined();
  });

  it('shows an instance with its main’s opacity unless it sets its own', () => {
    expect(withMainOpacity(plain, 0.5)).toMatchObject({ opacity: 0.5 });
    expect(withMainOpacity(plain, undefined)).toBe(plain);
    const own = { ...plain, opacity: 0.9 };
    expect(withMainOpacity(own, 0.5)).toBe(own);
  });

  it('hands down the mode and the opacity together, and tells when either changed', () => {
    expect(mainLayerOf(main)).toEqual({ mode: 'dark', opacity: 0.5 });
    const shown = withMainLayer(plain, mainLayerOf(main));
    expect(shown).toMatchObject({ colorMode: 'dark', opacity: 0.5 });
    expect(isShownLayerChanged(plain, shown)).toBe(true);
    expect(isShownLayerChanged(shown, { ...shown, opacity: 0.4 })).toBe(true);
    expect(isShownLayerChanged(shown, { ...shown })).toBe(false);
    expect(isShownLayerChanged(undefined, plain)).toBe(false);
  });
});
