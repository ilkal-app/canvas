import { bench, describe } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import {
  FakeSceneDocument,
  frameObject,
  shapeObject,
} from '../scene/__fixtures__/scene-objects.js';
import type { SceneChangeSet } from '../scene/scene-source.js';
import { Scene } from '../scene/scene.js';
import { SOLID_RECT_PASS } from '../scene/solid-rect-pass.js';
import { SDF_SHAPE_PASS } from '../shapes/shape-pass.js';

import { benchSize } from './__fixtures__/bench-size.js';
import { SceneSpatialIndex } from './scene-spatial-index.js';

// The CPU cost frame clipping adds where a change enters the engine: `Scene.apply`
// works out each changed record's clip chain (`clipChainOf`) and keeps the clip table in step,
// and `SceneSpatialIndex.apply` re-indexes the same objects. A board of the budgets' size, 50k
// objects in 500 frames of 100 (as the frame-time suite's boards): each frame 1,400 square
// holds 49 shapes and a nested 1,000-square frame with 49 more, so half the board sits two
// clipping frames deep, and its last column of shapes crosses the frame's edge. The same board
// with no frame clipping is measured beside it, so the difference is clipping's cost. CI's smoke
// run (`BENCH_SMOKE=1`) builds 20 frames (2k objects).
// Gated by `pnpm bench:ci` (its micro-benchmark suite).

const FRAME_COUNT = benchSize({ full: 500, smoke: 20 });
const OBJECT_COUNT = FRAME_COUNT * 100;
const FRAME_SIDE = 1_400;
const FRAME_PITCH = 1_600;
const COLUMNS = Math.ceil(Math.sqrt(FRAME_COUNT));
/** Shapes per frame directly, and in its nested frame. */
const SHAPES_PER_LEVEL = 49;
/** Children edited per scattered-edit iteration. */
const EDIT_COUNT = 100;

/**
 * The board: frames on a grid, each with 49 shapes on a 7 × 7 grid of 200 units (the last
 * column crossing its right edge) and a nested frame holding 49 more.
 *
 * @param isClipping - Whether every frame clips.
 * @returns The objects, parents before children.
 */
function clippedFramesBoard(isClipping: boolean): BoardObject[] {
  const objects: BoardObject[] = [];
  for (let index = 0; index < FRAME_COUNT; index += 1) {
    const id = `f${String(index)}`;
    const inner = `${id}-in`;
    objects.push(
      frameObject(id, {
        x: (index % COLUMNS) * FRAME_PITCH,
        y: Math.floor(index / COLUMNS) * FRAME_PITCH,
        width: FRAME_SIDE,
        height: FRAME_SIDE,
        clip: isClipping,
      }),
      frameObject(inner, {
        parentId: id,
        x: 100,
        y: 100,
        width: 1_000,
        height: 1_000,
        clip: isClipping,
      }),
    );
    for (let slot = 0; slot < SHAPES_PER_LEVEL; slot += 1) {
      const place = { x: (slot % 7) * 200 + 20, y: Math.floor(slot / 7) * 200 + 20 };
      objects.push(
        shapeObject(`${id}-s${String(slot)}`, { parentId: id, ...place, width: 120, height: 120 }),
        shapeObject(`${inner}-s${String(slot)}`, {
          parentId: inner,
          ...place,
          width: 120,
          height: 120,
        }),
      );
    }
  }
  return objects;
}

/**
 * The board as one change set that creates it.
 *
 * @param objects - The board.
 * @returns The change set.
 */
function createdChanges(objects: readonly BoardObject[]): SceneChangeSet {
  const byId = new Map(objects.map((object) => [object.id, object]));
  return { created: [...byId.keys()], updated: [], deleted: [], get: (id) => byId.get(id) };
}

/**
 * A scene and an index loaded with the board, and the document behind them.
 *
 * @param isClipping - Whether every frame clips.
 * @returns Them, and `apply`, which hands the document's changes to both.
 */
function loaded(isClipping: boolean) {
  const scene = new Scene([SOLID_RECT_PASS, SDF_SHAPE_PASS], {
    instanceBuffer: { initialCapacity: OBJECT_COUNT },
  });
  const index = new SceneSpatialIndex();
  const document = new FakeSceneDocument();
  document.create(...clippedFramesBoard(isClipping));
  const apply = () => {
    const changes = document.takeChanges();
    scene.apply(changes);
    index.apply(changes);
  };
  apply();
  return { scene, index, document, apply };
}

for (const isClipping of [true, false]) {
  const variant = isClipping ? 'clipping frames' : 'frames that do not clip';
  describe(`Scene and SceneSpatialIndex apply, ${String(OBJECT_COUNT)} objects in ${variant}`, () => {
    const board = createdChanges(clippedFramesBoard(isClipping));
    bench(`load the board (Scene.apply then SceneSpatialIndex.apply)`, () => {
      const scene = new Scene([SOLID_RECT_PASS, SDF_SHAPE_PASS], {
        instanceBuffer: { initialCapacity: OBJECT_COUNT },
      });
      scene.apply(board);
      new SceneSpatialIndex().apply(board);
    });

    const moving = loaded(isClipping);
    const middle = `f${String(Math.floor(FRAME_COUNT / 2))}`;
    const homeX = moving.document.get(middle as ObjectId)?.x ?? 0;
    let step = 0;
    bench('move one frame (its 99 descendants rewritten and re-indexed)', () => {
      step = (step + 1) % 50;
      moving.document.update(middle, { x: homeX + step });
      moving.apply();
    });

    const editing = loaded(isClipping);
    let turn = 0;
    bench(`edit ${String(EDIT_COUNT)} scattered children (half of them in nested frames)`, () => {
      turn += 1;
      for (let edit = 0; edit < EDIT_COUNT; edit += 1) {
        const frame = (edit * 37 + turn) % FRAME_COUNT;
        const level = edit % 2 === 0 ? '' : '-in';
        editing.document.update(`f${String(frame)}${level}-s${String((edit * 7) % 49)}`, {
          rotation: (turn % 10) / 100,
        });
      }
      editing.apply();
    });
  });
}
