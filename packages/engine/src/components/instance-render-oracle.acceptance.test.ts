// Acceptance, second slice: a
// renderer fed the expansion's change sets, step by step, holds exactly the records a fresh
// renderer holds when given the oracle's objects at once (the detached copy), in every pass; an
// instance dragged on the retained move path carries its virtual content; and a root move of an
// ordinary object keeps its marker through the expansion, so its fast path is unchanged.
import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import type { Camera } from '../camera/camera.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { isRootMoveChanges, markRootMoveChanges } from '../scene/root-move-changes.js';
import { SceneRenderer } from '../scene/scene-renderer.js';
import type { SceneChangeSet } from '../scene/scene-source.js';

import {
  cardMain,
  ComponentBoard,
  expectedScene,
  ExpansionHarness,
  frame,
  id,
  instance,
  shape,
} from './__fixtures__/component-scene.js';
import { expectedExport } from './__fixtures__/expected-api.js';

const CAMERA: Camera = {
  x: -100,
  y: -100,
  zoom: 1,
  viewportWidthPx: 1600,
  viewportHeightPx: 1200,
  dpr: 1,
};

/** Each pass's records, by owner id. */
type Records = Record<string, Record<string, number[][]>>;

function recordsOf(renderer: SceneRenderer): Records {
  const result: Records = {};
  for (const pass of renderer.scene.passes) {
    const buffer = renderer.scene.instanceBufferOf(pass.name);
    const floats = buffer.layout.floatsPerRecord;
    const byId: Record<string, number[][]> = {};
    for (const [owner, slots] of renderer.scene.slotEntriesOf(pass.name)) {
      byId[owner] = slots.map((slot) =>
        Array.from(buffer.data.subarray(slot * floats, (slot + 1) * floats)),
      );
    }
    result[pass.name] = byId;
  }
  return result;
}

function freshRecords(objects: ReadonlyMap<string, BoardObject>): Records {
  const renderer = new SceneRenderer(new FakeGpuBackend());
  renderer.enqueue({
    created: [...objects.keys()] as ObjectId[],
    updated: [],
    deleted: [],
    get: (key) => objects.get(key),
  });
  renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  return recordsOf(renderer);
}

/**
 * A renderer fed by a harness, a frame after every step, as the app's frame loop reads.
 *
 * @param objects - The board's objects.
 * @param page - The page shown, if the board has pages.
 * @returns The harness, the renderer and a step that changes both.
 */
function rendered(objects: readonly BoardObject[], page?: string) {
  const harness = new ExpansionHarness(
    new ComponentBoard(objects, page),
    expectedExport('InstanceExpansion'),
  );
  const renderer = new SceneRenderer(new FakeGpuBackend());
  const step = (): void => {
    const from = harness.outputs.length;
    harness.step();
    for (const changes of harness.outputs.slice(from)) renderer.enqueue(changes);
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
  };
  step();
  return { harness, renderer, step };
}

describe('InstanceExpansion through the renderer', () => {
  it('draws, step by step, exactly what the detached copy draws', () => {
    const objects = [
      ...cardMain('page-a'),
      frame('holder', null, { pageId: 'page-b', x: 300, width: 400, height: 300, z: 'a1' }),
      instance('inst', 'main', { parentId: 'holder', x: 20, y: 20, rotation: 0.3 }),
      shape('above', 'holder', { x: 30, y: 30, z: 'b0' }),
      instance('other', 'main', { pageId: 'page-b', y: 400, z: 'a2' }),
    ];
    const { harness, renderer, step } = rendered(objects, 'page-b');
    expect(recordsOf(renderer)).toEqual(freshRecords(expectedScene(harness.board)));
    const edits: ((board: ComponentBoard) => void)[] = [
      (board) => {
        board.update('inst', {
          overrides: { note: { color: [0.3, 0.6, 0.9, 1] }, badge: { isHidden: true } },
        });
      },
      (board) => {
        board.update('inst', { width: 260, height: 140 });
      },
      (board) => {
        board.update('title', { fill: [0, 0, 0, 1], constraints: { x: 'stretch', y: 'start' } });
      },
      (board) => {
        board.update('holder', { x: 900, rotation: -0.2 });
      },
      (board) => {
        board.update('main', { retired: true });
      },
      (board) => {
        board.remove('note');
      },
      (board) => {
        board.remove('other');
      },
    ];
    for (const edit of edits) {
      edit(harness.board);
      step();
      expect(recordsOf(renderer)).toEqual(freshRecords(expectedScene(harness.board)));
    }
  });

  it('carries an instance’s virtual content on the retained move path', () => {
    const { harness, renderer } = rendered([...cardMain(), instance('inst', 'main', { x: 400 })]);
    harness.board.update('inst', { x: 640, y: 90 });
    const moved = harness.board.objects.get(id('inst'));
    const changes: SceneChangeSet = {
      created: [],
      updated: [id('inst')],
      deleted: [],
      get: (key) => (key === 'inst' ? moved : harness.worker.get(key)),
    };
    renderer.enqueueRetainedMove(changes, [id('inst')]);
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(recordsOf(renderer)).toEqual(freshRecords(expectedScene(harness.board)));
  });

  it('keeps an ordinary root move marked as one through the expansion', () => {
    const { harness } = rendered([
      ...cardMain(),
      instance('inst', 'main', { x: 400 }),
      shape('plain', null, { y: 400 }),
    ]);
    harness.board.update('plain', { x: 50 });
    const shown = harness.board.takeShown();
    harness.board.takeBoard();
    const result = harness.expansion.expand(markRootMoveChanges(shown));
    expect(isRootMoveChanges(result)).toBe(true);
    expect([...result.created, ...result.updated, ...result.deleted]).toEqual(['plain']);
  });
});
