// The z-order segments' slot-owner and end-edit tests' board: a renderer with
// note, text, shape and frame-stroke passes (the last drawn after descendants, a closing rank) and
// its own segment stage, drawn to the objects each slot's records belong to, in draw order.
import type { BoardObject, ObjectId } from '@canvas/schema';

import type { Camera } from '../../../camera/camera.js';
import { FakeGpuBackend } from '../../__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument } from '../../__fixtures__/scene-objects.js';
import type { ScenePass } from '../../scene-pass.js';
import { SceneRenderer } from '../../scene-renderer.js';
import { SOLID_RECT_PASS } from '../../solid-rect-pass.js';
import { ZOrderSegments } from '../z-order-segments.js';

import { NOTE_PASS, TEXT_PASS, textObject } from './note-and-text-passes.js';

/** The camera every draw uses unless given another: zoom 1 at the origin, 800 × 600. */
export const CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 800,
  viewportHeightPx: 600,
  dpr: 1,
};
/** One record per shape, every shape an occluder. */
export const SHAPE_PASS: ScenePass = {
  ...SOLID_RECT_PASS,
  name: 'shape',
  recordCount: (object) => (object.type === 'shape' ? 1 : 0),
  isOccluder: (object) => object.type === 'shape',
};
/** A stroked frame's outline, drawn after its descendants: one record per letter of its name. */
export const CLOSING_PASS: ScenePass = {
  ...SOLID_RECT_PASS,
  name: 'frame-stroke',
  isDrawnAfterDescendants: true,
  recordCount: (object) => (object.type === 'frame' && object.stroke ? object.name.length : 0),
  isOccluder: (object) => object.type === 'frame' && !!object.stroke,
};
/** The board's passes, in draw order. */
export const PASSES = [NOTE_PASS, TEXT_PASS, SHAPE_PASS, CLOSING_PASS];

/** A renderer with its own z-order segment stage, and the document it draws. */
export interface Board {
  /** The recording backend. */
  readonly backend: FakeGpuBackend;
  /** The document. */
  readonly document: FakeSceneDocument;
  /** The renderer. */
  readonly renderer: SceneRenderer;
  /** Its z-order segment stage. */
  readonly segments: ZOrderSegments;
}

/**
 * An empty board.
 *
 * @returns The board.
 */
export function board(): Board {
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, { passes: PASSES, isZOrdered: false });
  const segments = new ZOrderSegments();
  segments.install(renderer.frame);
  return { backend, document: new FakeSceneDocument(), renderer, segments };
}

/**
 * Gives a text new content, its runs to match.
 *
 * @param document - The document.
 * @param id - The text.
 * @param text - Its new content.
 */
export function changeText(document: FakeSceneDocument, id: string, text: string): void {
  document.update(id, { text, runs: textObject(id, { text }).runs });
}

/**
 * Draws a frame and reads what it drew: each drawn slot's owner, as `pass:id`, in draw order.
 *
 * @param board - The board.
 * @param camera - The camera.
 * @returns The drawn records.
 */
export function draw(board: Board, camera: Camera = CAMERA): string[] {
  const { backend, renderer } = board;
  backend.resetCalls();
  renderer.renderFrame({ timeMs: 0, camera });
  const owners = new Map<string, Map<number, ObjectId>>();
  for (const pass of PASSES) {
    const bySlot = new Map<number, ObjectId>();
    for (const [id, slots] of renderer.scene.slotEntriesOf(pass.name)) {
      for (const slot of slots) bySlot.set(slot, id);
    }
    owners.set(pass.name, bySlot);
  }
  const entries: string[] = [];
  let pass = '';
  for (const call of backend.calls) {
    if (call.method === 'setVertexBuffer' && call.slot === 1) {
      pass = PASSES.find((candidate) => call.label === `${candidate.name} instances`)?.name ?? '';
    }
    if (call.method !== 'draw') continue;
    for (let slot = call.firstInstance; slot < call.firstInstance + call.instanceCount; slot += 1) {
      const owner = owners.get(pass)?.get(slot);
      if (owner !== undefined) entries.push(`${pass}:${owner}`);
    }
  }
  return entries;
}

/**
 * Creates objects and draws them.
 *
 * @param board - The board.
 * @param objects - The objects.
 * @param camera - The camera.
 * @returns The drawn records.
 */
export function install(
  board: Board,
  objects: readonly BoardObject[],
  camera: Camera = CAMERA,
): string[] {
  board.document.create(...objects);
  board.renderer.enqueue(board.document.takeChanges());
  return draw(board, camera);
}

/**
 * What a fresh board draws for objects: the reference an incremental stage must match.
 *
 * @param objects - The objects.
 * @param camera - The camera.
 * @returns The drawn records.
 */
export function freshDraw(objects: readonly BoardObject[], camera: Camera = CAMERA): string[] {
  return install(board(), objects, camera);
}

/**
 * The objects of a set of ids the document still holds.
 *
 * @param document - The document.
 * @param ids - The ids.
 * @returns The objects, in the ids' order.
 */
export function currentObjects(document: FakeSceneDocument, ids: Iterable<string>): BoardObject[] {
  return [...ids].flatMap((id) => {
    const object = document.get(id as ObjectId);
    return object ? [object] : [];
  });
}
