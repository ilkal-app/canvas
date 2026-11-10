// C2b/C2c acceptance: layer form, planning and bucketed targets.
import { afterEach, describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { component, instance } from '../components/__fixtures__/component-objects.js';
import {
  connectorObject,
  imageObject,
  lineObject,
  pathObject,
  stickyObject,
} from '../spatial/__fixtures__/spatial-objects.js';
import { hitPoint } from '../spatial/hit-point.js';
import { SceneSpatialIndex } from '../spatial/scene-spatial-index.js';
import { textObject } from '../text/scene/__fixtures__/text-objects.js';
import type { WorkerPool } from '../workers/worker-pool.js';

import {
  FakeSceneDocument,
  frameObject,
  groupObject,
  shapeObject,
} from './__fixtures__/scene-objects.js';
import {
  createDrawn,
  type Drawn,
  STANDARD_CAMERA,
} from './segments/__fixtures__/standard-draw-order.js';

const pools: WorkerPool[] = [];
afterEach(() => {
  for (const pool of pools.splice(0)) pool.terminate();
});

const draw = () => createDrawn(pools);
const red: [number, number, number, number] = [1, 0, 0, 1];
const blue: [number, number, number, number] = [0, 0, 1, 1];
const label = {
  text: 'Label',
  runs: [
    {
      length: 5,
      style: { fontFamily: 'Inter', fontSize: 16, color: red, weight: 400 as const, italic: false },
    },
  ],
};

async function settle(drawn: Drawn, camera = STANDARD_CAMERA): Promise<void> {
  for (let frame = 0; frame < 6; frame += 1) {
    drawn.renderer.renderFrame({ timeMs: frame * 16, camera });
    drawn.pool.drainMainThread(Number.POSITIVE_INFINITY, () => 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  drawn.backend.resetCalls();
  drawn.renderer.renderFrame({ timeMs: 200, camera });
}

function targetCount(drawn: Drawn): number {
  return drawn.backend.calls.filter(
    (call) => call.method === 'beginRenderPass' && call.target !== undefined,
  ).length;
}

function signature(drawn: Drawn): string[] {
  const owners = new Map<string, Map<number, string>>();
  for (const { name } of drawn.renderer.scene.passes) {
    const slots = new Map<number, string>();
    for (const [id, entries] of drawn.renderer.scene.slotEntriesOf(name)) {
      for (const slot of entries) slots.set(slot, id);
    }
    owners.set(name, slots);
  }
  const result: string[] = [];
  let pipeline = '';
  let target = 'canvas';
  for (const call of drawn.backend.calls) {
    if (call.method === 'beginRenderPass') target = call.target === undefined ? 'canvas' : 'layer';
    if (call.method === 'setPipeline') pipeline = call.label.split(' ')[0] ?? '';
    if (call.method !== 'draw') continue;
    for (let index = 0; index < call.instanceCount; index += 1) {
      const owner = owners.get(pipeline)?.get(call.firstInstance + index);
      if (owner !== undefined) result.push(`${target}:${pipeline}:${owner}`);
    }
  }
  return result;
}

async function render(objects: BoardObject[], camera = STANDARD_CAMERA): Promise<Drawn> {
  const drawn = draw();
  drawn.document.create(...objects);
  drawn.renderer.enqueue(drawn.document.takeChanges());
  await settle(drawn, camera);
  return drawn;
}

describe('layer planning', () => {
  it('places the layers stage after planning and before canvas draw', () => {
    const names = draw().renderer.frame.stageNames;
    expect(names).toContain('layers');
    expect(names.indexOf('layers')).toBeGreaterThan(names.indexOf('zOrderSegments'));
    expect(names.indexOf('layers')).toBeLessThan(names.indexOf('draw'));
  });

  it('chooses layer form for containers and multi-part leaves, multiply for single-part leaves', async () => {
    const cases: { name: string; object: BoardObject; isLayer: boolean }[] = [
      { name: 'group', object: groupObject('subject', { opacity: 0.5 }), isLayer: true },
      { name: 'main', object: component('subject', { opacity: 0.5 }), isLayer: true },
      { name: 'instance', object: instance('subject', 'main', { opacity: 0.5 }), isLayer: true },
      { name: 'frame', object: frameObject('subject', { opacity: 0.5 }), isLayer: true },
      {
        name: 'shape-label',
        object: shapeObject('subject', { width: 100, height: 100, opacity: 0.5, label }),
        isLayer: true,
      },
      {
        name: 'shape-shadow',
        object: shapeObject('subject', {
          opacity: 0.5,
          width: 100,
          height: 100,
          shadow: { x: 4, y: 4, blur: 0, spread: 0, color: blue },
        }),
        isLayer: true,
      },
      { name: 'plain-shape', object: shapeObject('subject', { opacity: 0.5 }), isLayer: false },
      {
        name: 'sticky',
        object: {
          ...stickyObject('subject', { opacity: 0.5, width: 100, height: 100 }),
          text: 'Note',
          runs: [
            {
              length: 4,
              style: { fontFamily: 'Inter', fontSize: 16, color: red, weight: 400, italic: false },
            },
          ],
        },
        isLayer: true,
      },
      { name: 'line', object: lineObject('subject', { opacity: 0.5 }), isLayer: false },
      { name: 'image', object: { ...imageObject('subject'), opacity: 0.5 }, isLayer: false },
      { name: 'text', object: { ...textObject('subject', 'Text'), opacity: 0.5 }, isLayer: false },
      {
        name: 'path-fill',
        object: {
          ...pathObject(
            'subject',
            [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 100 },
            ],
            { isFilled: true, isClosed: true, strokeWidth: null },
          ),
          fill: red,
          opacity: 0.5,
        },
        isLayer: false,
      },
      {
        name: 'path-fill-stroke',
        object: {
          ...pathObject(
            'subject',
            [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 100 },
            ],
            { isFilled: true, isClosed: true, strokeWidth: 4 },
          ),
          fill: red,
          opacity: 0.5,
        },
        isLayer: true,
      },
      {
        name: 'connector',
        object: { ...connectorObject('subject'), opacity: 0.5 },
        isLayer: false,
      },
      {
        name: 'labelled-connector',
        object: {
          ...connectorObject('subject'),
          to: { kind: 'point', x: 100, y: 100 },
          label,
          opacity: 0.5,
        },
        isLayer: true,
      },
    ];
    for (const { name, object, isLayer } of cases) {
      const drawn = await render(
        ['group', 'main', 'instance'].includes(name)
          ? [object, shapeObject('child', { parentId: 'subject', width: 100, height: 100 })]
          : [object],
      );
      expect(targetCount(drawn), name).toBe(isLayer ? 1 : 0);
    }
  });

  it('closes nested layers before the parent and hides both interiors from the main plan', async () => {
    const drawn = await render([
      shapeObject('behind', { z: 'a0', width: 180, height: 180 }),
      frameObject('outer', {
        z: 'a1',
        opacity: 0.5,
        width: 160,
        height: 160,
        name: 'Title',
        showName: true,
        stroke: { color: blue, width: 4 },
      }),
      shapeObject('first', { parentId: 'outer', z: 'a0', width: 70, height: 70 }),
      groupObject('inner', { parentId: 'outer', z: 'a1', opacity: 0.5 }),
      shapeObject('inside', { parentId: 'inner', width: 100, height: 100 }),
      shapeObject('last', { parentId: 'outer', z: 'a2', width: 60, height: 60 }),
      shapeObject('above', { z: 'a2', width: 180, height: 180 }),
    ]);
    const calls = drawn.backend.calls;
    const targets = calls.filter(
      (call) => call.method === 'beginRenderPass' && call.target !== undefined,
    );
    expect(targets).toHaveLength(2);
    const order = signature(drawn);
    expect(order).toContain('layer:sdf-shape:inside');
    expect(order).toContain('layer:sdf-shape:first');
    expect(order).toContain('layer:sdf-shape:last');
    expect(order).not.toContain('canvas:sdf-shape:inside');
    expect(order).not.toContain('canvas:sdf-shape:first');
    expect(order).not.toContain('canvas:solid-rect:outer');
    expect(order).not.toContain('canvas:frame-stroke:outer');
    expect(order).toContain('canvas:frame-title:outer');
    expect(order).toContain('layer:layer-composite:inner');
    expect(order).toContain('canvas:layer-composite:outer');
    expect(order.filter((entry) => entry === 'layer:sdf-shape:inside')).toHaveLength(1);
    const composite = drawn.renderer.scene.passes.find((pass) => pass.name === 'layer-composite');
    const outer = drawn.document.get('outer' as ObjectId);
    if (outer === undefined) throw new Error('missing outer frame');
    expect(composite?.isDrawnAfterDescendants).toBe(true);
    expect(composite?.isOccluder?.(outer)).toBe(true);
    expect(order.indexOf('canvas:sdf-shape:behind')).toBeLessThan(
      order.indexOf('canvas:layer-composite:outer'),
    );
    expect(order.indexOf('canvas:layer-composite:outer')).toBeLessThan(
      order.indexOf('canvas:sdf-shape:above'),
    );
  });

  it('skips an opacity-zero layer while keeping its object in the document', async () => {
    const drawn = await render([
      groupObject('invisible', { opacity: 0 }),
      shapeObject('child', { parentId: 'invisible' }),
      shapeObject('zero-leaf', { x: 30, opacity: 0 }),
    ]);
    expect(drawn.document.get('invisible' as ObjectId)).toBeDefined();
    expect(targetCount(drawn)).toBe(0);
    expect(signature(drawn)).not.toContain('canvas:sdf-shape:child');
    expect(signature(drawn)).not.toContain('canvas:sdf-shape:zero-leaf');
    expect(
      drawn.renderer.projectionCandidates({ minX: 30, minY: 0, maxX: 40, maxY: 10 }),
    ).toContain('zero-leaf');
    const document = new FakeSceneDocument();
    document.create(shapeObject('zero-leaf', { x: 30, opacity: 0 }));
    const index = new SceneSpatialIndex();
    index.apply(document.takeChanges());
    expect(hitPoint(index, document, { x: 35, y: 5 }, { zoom: 1, tolerancePx: 0 })).toContain(
      'zero-leaf',
    );
  });

  it('writes descendant opacity relative to the nearest layer', async () => {
    const drawn = await render([
      groupObject('outer', { opacity: 0.5 }),
      groupObject('inner', { parentId: 'outer', opacity: 0.5 }),
      shapeObject('child', { parentId: 'inner', width: 100, height: 100, opacity: 0.6 }),
    ]);
    const [slot] = drawn.renderer.scene.slotsOf('child' as ObjectId, 'sdf-shape');
    if (slot === undefined) throw new Error('missing child record');
    const pass = drawn.renderer.scene.passes.find((entry) => entry.name === 'sdf-shape');
    if (pass?.layout.opacityFloat === undefined) throw new Error('missing opacity layout');
    const data = drawn.renderer.scene.instanceBufferOf('sdf-shape').data;
    expect(data[slot * pass.layout.floatsPerRecord + pass.layout.opacityFloat]).toBeCloseTo(0.4);
  });

  it('rounds a partly offscreen layer rect and intersects it with an ancestor clip', async () => {
    const scaled = await render(
      [frameObject('scaled', { x: 10, y: 10, width: 40, height: 40, opacity: 0.5 })],
      { ...STANDARD_CAMERA, zoom: 2 },
    );
    expect(scaled.backend.targets.at(-1)?.width).toBe(128);
    expect(scaled.backend.targets.at(-1)?.height).toBe(128);

    const partly = await render([
      frameObject('offscreen', { x: -20.25, y: -10.25, width: 100.5, height: 60.5, opacity: 0.5 }),
    ]);
    const offscreen = partly.backend.targets.at(-1);
    if (offscreen === undefined) throw new Error('missing offscreen target');
    expect(offscreen.width).toBe(128);
    expect(offscreen.height).toBe(64);

    const clipped = await render([
      frameObject('clip', { x: 20, y: 20, width: 80, height: 80, clip: true }),
      frameObject('layer', {
        parentId: 'clip',
        x: -30,
        y: -30,
        width: 110,
        height: 110,
        opacity: 0.5,
      }),
    ]);
    const target = clipped.backend.targets.at(-1);
    if (target === undefined) throw new Error('missing clipped target');
    expect(target.width).toBe(128);
    expect(target.height).toBe(128);
  });

  it('matches a fresh renderer after layer, multiply and opaque switches and insertion', async () => {
    const retained = draw();
    retained.document.create(
      groupObject('group', { opacity: 0.5 }),
      shapeObject('shape', { parentId: 'group', width: 100, height: 100, opacity: 0.5, label }),
    );
    retained.renderer.enqueue(retained.document.takeChanges());
    const edits = [
      () => {
        retained.document.update('shape', { label: null });
      },
      () => {
        retained.document.update('shape', { opacity: 1 });
      },
      () => {
        retained.document.update('shape', { opacity: 0.5, label });
      },
      () => {
        retained.document.create(shapeObject('new-child', { parentId: 'group', z: 'a1' }));
      },
    ];
    const snapshot = (): BoardObject[] =>
      ['group', 'shape', 'new-child']
        .map((id) => retained.document.get(id as ObjectId))
        .filter((object): object is BoardObject => object !== undefined);
    const expectedLayers = [2, 1, 1, 2, 2];
    for (const [step, edit] of [() => undefined, ...edits].entries()) {
      edit();
      retained.renderer.enqueue(retained.document.takeChanges());
      await settle(retained);
      const fresh = await render(snapshot());
      expect(signature(retained)).toEqual(signature(fresh));
      expect(targetCount(retained)).toBe(targetCount(fresh));
      expect(targetCount(retained)).toBe(expectedLayers[step]);
    }
  });
});
