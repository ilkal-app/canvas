// Frame outlines in z order across incremental changes: the full
// standard pass list with fonts, so text draws too. After every edit the renderer's draw order
// (`pass:object` per record, runs of one object's records in one pass collapsed) must equal a
// fresh renderer's given the board as it now is, and the edits a review named are pinned explicitly:
// a background or a shadow given to or taken from a stroked frame over an image changes only the
// frame's own rank's occluder flag (the closing rank's stays), and a stroke given to or taken from
// a frame with a background changes the closing rank. Children of every kind (a gradient shape,
// a text, a connector, an image, a pen path, a nested stroked frame) are inserted, removed,
// reordered and reparented into and out of a stroked frame.
import { afterEach, describe, expect, it } from 'vitest';

import type { BoardObject, Gradient, ObjectId, Shadow, Stroke } from '@canvas/schema';

import {
  component,
  ComponentBoard,
  expectedScene,
  ExpansionHarness,
  frame as componentFrame,
  instance,
  shape as componentShape,
} from '../../components/__fixtures__/component-scene.js';
import { expectedExport } from '../../components/__fixtures__/expected-api.js';
import { imageObject } from '../../images/__fixtures__/image-objects.js';
import { connectorObject, pathObject } from '../../spatial/__fixtures__/spatial-objects.js';
import { textObject } from '../../text/scene/__fixtures__/text-objects.js';
import type { WorkerPool } from '../../workers/worker-pool.js';
import { type FakeSceneDocument, frameObject, shapeObject } from '../__fixtures__/scene-objects.js';

import { createDrawn as createDrawnIn, drawOrder } from './__fixtures__/standard-draw-order.js';

const pools: WorkerPool[] = [];

afterEach(() => {
  for (const pool of pools.splice(0)) pool.terminate();
});

/**
 * A renderer over the standard passes whose pool `afterEach` terminates.
 *
 * @returns The renderer, its backend and pool, and an empty document.
 */
const createDrawn = () => createDrawnIn(pools);

/** A 4 px outline. */
const OUTLINE: Stroke = { color: [0.1, 0.2, 0.3, 1], width: 4 };

/** A sharp shadow 10 right and down. */
const SHADOW: Shadow = { x: 10, y: 10, blur: 0, spread: 0, color: [0, 0, 0, 0.5] };

const GRADIENT: Gradient = {
  type: 'linear',
  angle: 0,
  stops: [
    { offset: 0, color: [1, 0, 0, 1] },
    { offset: 1, color: [0, 0, 1, 1] },
  ],
};

/**
 * Draws a board, then applies each edit in turn, checking after each that the renderer draws
 * what a fresh renderer given the same board draws.
 *
 * @param board - The board.
 * @param edits - The edits, each on the document.
 * @returns The draw order after the board and after each edit.
 */
async function drawSteps(
  board: readonly BoardObject[],
  edits: readonly ((document: FakeSceneDocument) => void)[],
): Promise<string[][]> {
  const drawn = createDrawn();
  const objects = new Map<ObjectId, BoardObject>(board.map((object) => [object.id, object]));
  drawn.document.create(...board);
  drawn.renderer.enqueue(drawn.document.takeChanges());
  const orders = [await drawOrder(drawn)];
  for (const edit of edits) {
    edit(drawn.document);
    const changes = drawn.document.takeChanges();
    for (const id of [...changes.created, ...changes.updated, ...changes.deleted]) {
      const object = changes.get(id);
      if (object) objects.set(id, object);
      else objects.delete(id);
    }
    drawn.renderer.enqueue(changes);
    const order = await drawOrder(drawn);
    const fresh = createDrawn();
    fresh.document.create(...objects.values());
    fresh.renderer.enqueue(fresh.document.takeChanges());
    expect(order).toEqual(await drawOrder(fresh));
    orders.push(order);
  }
  return orders;
}

/**
 * A frame with no name drawn, so the frame title pass draws nothing.
 *
 * @param id - Its id.
 * @param overrides - Fields to change.
 * @returns The frame.
 */
const framed = (id: string, overrides: Parameters<typeof frameObject>[1] = {}) =>
  frameObject(id, { showName: false, ...overrides });

/**
 * An image at a box, in a parent, at a z key.
 *
 * @param id - Its id.
 * @param box - Its box in its parent's frame.
 * @param box.x - Its left.
 * @param box.y - Its top.
 * @param box.width - Its width.
 * @param box.height - Its height.
 * @param z - Its z key.
 * @param parentId - Its parent, or null.
 * @returns The image.
 */
const photo = (
  id: string,
  box: { x: number; y: number; width: number; height: number },
  z: string,
  parentId: string | null = null,
): BoardObject => ({
  ...imageObject({ id: id as ObjectId, ...box }),
  z,
  parentId: parentId as ObjectId | null,
});

describe('frame outlines across incremental changes', () => {
  it('re-flag the frame’s own rank when a stroked frame gains or loses its background', async () => {
    // The frame (0, 0)–(200, 200) sits over an image it overlaps; it starts without a background.
    const orders = await drawSteps(
      [
        photo('photo', { x: 50, y: 50, width: 80, height: 60 }, 'a0'),
        framed('frame', { z: 'a1', width: 200, height: 200, background: null, stroke: OUTLINE }),
      ],
      [
        (document) => {
          document.update('frame', { background: [1, 1, 1, 1] });
        },
        (document) => {
          document.update('frame', { background: null });
        },
      ],
    );
    expect(orders).toEqual([
      ['image:photo', 'frame-stroke:frame'],
      ['image:photo', 'solid-rect:frame', 'frame-stroke:frame'],
      ['image:photo', 'frame-stroke:frame'],
    ]);
  });

  it('re-flag the frame’s own rank when a stroked frame gains or loses its shadow', async () => {
    const orders = await drawSteps(
      [
        photo('photo', { x: 150, y: 150, width: 80, height: 60 }, 'a0'),
        framed('frame', { z: 'a1', width: 150, height: 150, background: null, stroke: OUTLINE }),
      ],
      [
        (document) => {
          document.update('frame', { shadow: SHADOW });
        },
        (document) => {
          document.update('frame', { shadow: null });
        },
      ],
    );
    expect(orders).toEqual([
      ['image:photo', 'frame-stroke:frame'],
      ['image:photo', 'frame-shadow:frame', 'frame-stroke:frame'],
      ['image:photo', 'frame-stroke:frame'],
    ]);
  });

  it('move the outline when a frame with a background gains or loses its stroke', async () => {
    const orders = await drawSteps(
      [
        photo('photo', { x: 50, y: 50, width: 80, height: 60 }, 'a0'),
        framed('frame', { z: 'a1', width: 200, height: 200 }),
        photo('inside', { x: -10, y: 20, width: 60, height: 40 }, 'a0', 'frame'),
      ],
      [
        (document) => {
          document.update('frame', { stroke: OUTLINE });
        },
        (document) => {
          document.update('frame', { stroke: null });
        },
      ],
    );
    expect(orders).toEqual([
      ['image:photo', 'solid-rect:frame', 'image:inside'],
      ['image:photo', 'solid-rect:frame', 'image:inside', 'frame-stroke:frame'],
      ['image:photo', 'solid-rect:frame', 'image:inside'],
    ]);
  });

  it('close over gradient, text, connector, image, path and nested frame children', async () => {
    const [order] = await drawSteps(
      [
        framed('frame', { z: 'a0', width: 400, height: 300, stroke: OUTLINE }),
        shapeObject('gradient', {
          parentId: 'frame',
          z: 'a0',
          x: -10,
          y: 10,
          width: 60,
          height: 40,
          fill: GRADIENT,
        }),
        textObject('label', 'Hello', { parentId: 'frame', z: 'a1', x: -5, y: 60 }),
        { ...connectorObject('link'), parentId: 'frame' as ObjectId, z: 'a2' },
        photo('picture', { x: 300, y: 250, width: 120, height: 80 }, 'a3', 'frame'),
        pathObject(
          'pen',
          [
            { x: 0, y: 150 },
            { x: 420, y: 150 },
          ],
          {},
          { parentId: 'frame', z: 'a4' },
        ),
        framed('inner', { parentId: 'frame', z: 'a5', x: 350, y: 20, stroke: OUTLINE }),
      ],
      [],
    );
    expect(order?.at(-1)).toBe('frame-stroke:frame');
    for (const entry of [
      'sdf-shape-gradient:gradient',
      'text:label',
      'connector:link',
      'image:picture',
      'path:pen',
      'frame-stroke:inner',
    ]) {
      expect(order).toContain(entry);
    }
  });

  it('stay over the subtree as children are inserted, removed, reordered and reparented', async () => {
    const outerFrame = framed('frame', { z: 'a0', width: 300, height: 300, stroke: OUTLINE });
    const orders = await drawSteps(
      [
        outerFrame,
        framed('beside', { z: 'a1', x: 280, width: 200, height: 200, stroke: OUTLINE }),
        shapeObject('first', { parentId: 'frame', z: 'a0', x: -10, y: 10 }),
      ],
      [
        (document) => {
          document.create(photo('added', { x: 250, y: 20, width: 80, height: 60 }, 'a1', 'frame'));
        },
        (document) => {
          // Reordered under the first child.
          document.update('added', { z: 'Zz' });
        },
        (document) => {
          // Reparented out of the frame into its sibling, which overlaps the frame's edge.
          document.update('added', { parentId: 'beside' as ObjectId, x: 0, z: 'a0' });
        },
        (document) => {
          // And back in, on top.
          document.update('added', { parentId: 'frame' as ObjectId, x: 250, z: 'a5' });
        },
        (document) => {
          document.delete('first');
        },
        (document) => {
          document.delete('added');
        },
      ],
    );
    expect(orders.at(1)?.indexOf('frame-stroke:frame')).toBeGreaterThan(
      orders.at(1)?.indexOf('image:added') ?? Number.POSITIVE_INFINITY,
    );
    expect(orders.at(3)?.indexOf('image:added')).toBeGreaterThan(
      orders.at(3)?.indexOf('frame-stroke:frame') ?? Number.POSITIVE_INFINITY,
    );
    expect(orders.at(-1)).toEqual([
      'solid-rect:frame',
      'frame-stroke:frame',
      'solid-rect:beside',
      'frame-stroke:beside',
    ]);
  });

  it('close an instance’s stroked frame over its content, a hidden child left out', async () => {
    // A main holding a stroked frame with two children, and an instance of it; then the
    // instance hides one child by an override.
    const board = new ComponentBoard([
      component('main'),
      componentFrame('panel', 'main', { width: 160, height: 80, stroke: OUTLINE }),
      componentShape('leaf', 'panel', { x: -10, y: 10, width: 40, height: 30 }),
      componentShape('badge', 'panel', { x: 140, y: 60, z: 'a1' }),
      instance('inst', 'main', { x: 300 }),
    ]);
    const harness = new ExpansionHarness(board, expectedExport('InstanceExpansion'));
    const drawn = createDrawn();
    const step = async (): Promise<string[]> => {
      const from = harness.outputs.length;
      harness.step();
      for (const changes of harness.outputs.slice(from)) drawn.renderer.enqueue(changes);
      const order = await drawOrder(drawn);
      const fresh = createDrawn();
      fresh.document.create(...expectedScene(harness.board).values());
      fresh.renderer.enqueue(fresh.document.takeChanges());
      expect(order).toEqual(await drawOrder(fresh));
      return order;
    };
    const whole = await step();
    const strokes = whole.filter((entry) => entry.startsWith('frame-stroke:'));
    expect(strokes).toHaveLength(2);
    for (const stroke of strokes) {
      const owner = stroke.slice('frame-stroke:'.length);
      // Each outline draws after its own frame's background and children (`inst/…` for the
      // instance's virtual copies).
      const prefix = owner.slice(0, -'panel'.length);
      for (const content of [
        `solid-rect:${owner}`,
        `sdf-shape:${prefix}leaf`,
        `sdf-shape:${prefix}badge`,
      ]) {
        expect(whole.indexOf(stroke)).toBeGreaterThan(whole.indexOf(content));
      }
    }
    harness.board.update('inst', { overrides: { badge: { isHidden: true } } });
    const hidden = await step();
    expect(hidden).not.toContain('sdf-shape:inst/badge');
    expect(hidden.indexOf('frame-stroke:inst/panel')).toBeGreaterThan(
      hidden.indexOf('sdf-shape:inst/leaf'),
    );
  });
});
