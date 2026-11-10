// Z-order segments with object boxes and level of detail, through a
// SceneRenderer with its default R-tree culler, whose index gives the boxes: an occluder starts a
// segment only where it covers something a later pass drew before it, and a note's text below
// 2.5 device pixels a line is left out (shown again from 3), so the notes around it share one
// segment.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { Camera } from '../../camera/camera.js';
import { SpatialCuller } from '../../spatial/spatial-culler.js';
import { TEXT_LEVEL_OF_DETAIL } from '../../text/scene/text-detail.js';
import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, frameObject } from '../__fixtures__/scene-objects.js';
import type { ScenePass } from '../scene-pass.js';
import { SceneRenderer } from '../scene-renderer.js';

import {
  NOTE_PASS,
  stickyObject,
  TEXT_PASS,
  textObject,
} from './__fixtures__/note-and-text-passes.js';
import { MAX_CHECKED_MOVES, ZOrderSegments } from './z-order-segments.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 400, dpr: 1 };

/** The text stand-in with the text pass's level of detail: hidden under 2.5 device px a line. */
const DETAILED_TEXT_PASS: ScenePass = { ...TEXT_PASS, levelOfDetail: TEXT_LEVEL_OF_DETAIL };

/**
 * A renderer over the note and text stand-ins, z-ordered with its own culler's boxes.
 *
 * @param textPass - The text stand-in.
 * @returns The backend, the renderer and a document.
 */
function setUp(textPass: ScenePass = TEXT_PASS) {
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, { passes: [NOTE_PASS, textPass] });
  return { backend, renderer, document: new FakeSceneDocument() };
}

/**
 * Renders one frame and describes its draws by the instance buffer bound and the range drawn.
 *
 * @param backend - The fake backend.
 * @param renderer - The renderer.
 * @param camera - The frame's camera.
 * @returns One line per draw, in order.
 */
function drawFrame(backend: FakeGpuBackend, renderer: SceneRenderer, camera = CAMERA): string[] {
  backend.resetCalls();
  renderer.renderFrame({ timeMs: 0, camera });
  const sequence: string[] = [];
  let bound = '';
  for (const call of backend.calls) {
    if (call.method === 'setVertexBuffer' && call.slot === 1) bound = call.label;
    if (call.method === 'draw') {
      sequence.push(`${bound} [${String(call.firstInstance)}, +${String(call.instanceCount)})`);
    }
  }
  return sequence;
}

describe('ZOrderSegments with object boxes', () => {
  it('lets a note that covers no earlier text share the segment of the note before it', () => {
    const { backend, renderer, document } = setUp();
    document.create(
      textObject('label', { z: 'a0' }),
      stickyObject('covering', { z: 'a1', text: 'ab' }),
      stickyObject('beside', { z: 'a2', x: 400, text: 'cd' }),
    );
    renderer.enqueue(document.takeChanges());
    // The label, then both notes and then both notes' text: three draws, not five.
    expect(drawFrame(backend, renderer)).toEqual([
      'text instances [0, +2)',
      'note instances [0, +2)',
      'text instances [2, +4)',
    ]);
  });

  it('splits only at notes over text drawn before them, earlier or later siblings of a note', () => {
    const { backend, renderer, document } = setUp();
    document.create(
      textObject('first', { z: 'a0' }),
      // Over `first`: its own segment. `onFirstNote` is a later sibling on it, drawn above it.
      stickyObject('firstNote', { z: 'a1', x: 50 }),
      textObject('onFirstNote', { z: 'a2', x: 60, y: 20 }),
      // Clear of every text before it: it joins the segment.
      stickyObject('clear', { z: 'a3', x: 300 }),
      // Over `onFirstNote`: a segment of its own again, with the text on it.
      stickyObject('covering', { z: 'a4', x: 120 }),
      textObject('onCovering', { z: 'a5', x: 130, y: 10 }),
    );
    renderer.enqueue(document.takeChanges());
    expect(drawFrame(backend, renderer)).toEqual([
      'text instances [0, +2)',
      'note instances [0, +2)',
      'text instances [2, +2)',
      'note instances [2, +1)',
      'text instances [4, +2)',
    ]);
  });

  it('re-plans when a note it merged moves onto text, and then splits there', () => {
    const { backend, renderer, document } = setUp();
    document.create(
      stickyObject('lower', { z: 'a0', text: 'ab' }),
      stickyObject('upper', { z: 'a1', x: 400, text: 'cd' }),
    );
    renderer.enqueue(document.takeChanges());
    expect(drawFrame(backend, renderer)).toHaveLength(2);
    document.update('upper', { x: 40 });
    renderer.enqueue(document.takeChanges());
    expect(drawFrame(backend, renderer)).toEqual([
      'note instances [0, +1)',
      'text instances [0, +2)',
      'note instances [1, +1)',
      'text instances [2, +2)',
    ]);
  });
});

describe('ZOrderSegments keeping a plan merged by boxes while objects move', () => {
  /**
   * A renderer with its culler's index, and a stage of its own to count plans.
   *
   * @returns The backend, renderer, document and stage.
   */
  function counted() {
    const backend = new FakeGpuBackend();
    const culler = new SpatialCuller();
    const renderer = new SceneRenderer(backend, {
      passes: [NOTE_PASS, TEXT_PASS],
      culler,
      isZOrdered: false,
    });
    const segments = new ZOrderSegments({ spatial: culler.index });
    segments.install(renderer.frame);
    return { backend, renderer, document: new FakeSceneDocument(), segments };
  }

  it('re-plans nothing while a moved object meets nothing its merge relied on', () => {
    const { backend, renderer, document, segments } = counted();
    document.create(
      stickyObject('lower', { z: 'a0', text: 'ab' }),
      stickyObject('upper', { z: 'a1', x: 400, text: 'cd' }),
    );
    renderer.enqueue(document.takeChanges());
    drawFrame(backend, renderer);
    document.update('upper', { x: 420 });
    renderer.enqueue(document.takeChanges());
    expect(drawFrame(backend, renderer)).toHaveLength(2);
    expect(segments.counts.plans).toBe(1);
    expect(segments.segmentCount).toBe(1);
  });

  it('checks what a moved frame carries: a note in it moved onto text', () => {
    const { backend, renderer, document } = counted();
    document.create(
      stickyObject('lower', { z: 'a0', text: 'ab' }),
      frameObject('frame', { z: 'a1', x: 400, width: 300, height: 300 }),
      stickyObject('inside', { z: 'a0', parentId: 'frame' as ObjectId, text: 'cd' }),
    );
    renderer.enqueue(document.takeChanges());
    expect(drawFrame(backend, renderer)).toHaveLength(2);
    document.update('frame', { x: 40 });
    renderer.enqueue(document.takeChanges());
    expect(drawFrame(backend, renderer)).toHaveLength(4);
  });

  it('plans without boxes while many objects move, and with them once nothing does', () => {
    const { backend, renderer, document, segments } = counted();
    const labels = Array.from({ length: MAX_CHECKED_MOVES + 1 }, (unused, index) =>
      textObject(`t${String(index)}`, { z: `b${String(index).padStart(4, '0')}`, x: 1000 }),
    );
    document.create(
      stickyObject('lower', { z: 'a0', text: 'ab' }),
      stickyObject('upper', { z: 'a1', x: 400, text: 'cd' }),
      ...labels,
    );
    renderer.enqueue(document.takeChanges());
    drawFrame(backend, renderer);
    expect(segments.segmentCount).toBe(1);
    for (const { id } of labels) document.update(id, { y: 5 });
    renderer.enqueue(document.takeChanges());
    drawFrame(backend, renderer);
    expect(segments.segmentCount).toBe(2);
    // Still moving: the plan without boxes holds whatever moves.
    document.update('upper', { x: 410 });
    renderer.enqueue(document.takeChanges());
    drawFrame(backend, renderer);
    expect(segments.counts.plans).toBe(2);
    drawFrame(backend, renderer);
    expect(segments.segmentCount).toBe(1);
    expect(segments.counts.plans).toBe(3);
  });
});

describe('ZOrderSegments with hidden text', () => {
  it("leaves out a note's text below 2.5 device pixels a line, merging the notes over it", () => {
    const { backend, renderer, document } = setUp(DETAILED_TEXT_PASS);
    // 16-unit text, 20-unit lines: hidden under 0.125 device pixels per world unit, shown again
    // from 0.15.
    document.create(
      stickyObject('lower', { z: 'a0', text: 'ab' }),
      stickyObject('upper', { z: 'a1', x: 40, text: 'cd' }),
    );
    renderer.enqueue(document.takeChanges());
    expect(drawFrame(backend, renderer)).toHaveLength(4);
    expect(drawFrame(backend, renderer, { ...CAMERA, zoom: 0.1 })).toEqual([
      'note instances [0, +2)',
    ]);
    expect(drawFrame(backend, renderer, { ...CAMERA, zoom: 0.08, dpr: 2 })).toHaveLength(4);
    expect(drawFrame(backend, renderer, { ...CAMERA, zoom: 0.2 })).toHaveLength(4);
  });

  it('re-plans when text is hidden or shown, with a 20% band, not on every zoom', () => {
    const backend = new FakeGpuBackend();
    const renderer = new SceneRenderer(backend, {
      passes: [NOTE_PASS, DETAILED_TEXT_PASS],
      isZOrdered: false,
    });
    const segments = new ZOrderSegments();
    segments.install(renderer.frame);
    const document = new FakeSceneDocument();
    document.create(stickyObject('note', { text: 'ab' }));
    renderer.enqueue(document.takeChanges());
    drawFrame(backend, renderer);
    expect(drawFrame(backend, renderer, { ...CAMERA, zoom: 0.1 })).toEqual([
      'note instances [0, +1)',
    ]);
    drawFrame(backend, renderer, { ...CAMERA, zoom: 0.12 });
    // 2.8 device px: past the 2.5 px threshold but inside its band, so the text stays hidden.
    expect(drawFrame(backend, renderer, { ...CAMERA, zoom: 0.14 })).toEqual([
      'note instances [0, +1)',
    ]);
    expect(segments.counts.plans).toBe(2);
    drawFrame(backend, renderer, { ...CAMERA, zoom: 0.15 });
    expect(segments.counts.plans).toBe(3);
    // 2.6 px: inside the band the other way, so it stays shown.
    expect(drawFrame(backend, renderer, { ...CAMERA, zoom: 0.13 })).toHaveLength(2);
    drawFrame(backend, renderer);
    expect(segments.counts.plans).toBe(3);
  });

  it("re-plans when a note's text size moves it past its threshold", () => {
    const { backend, renderer, document } = setUp(DETAILED_TEXT_PASS);
    document.create(stickyObject('note', { text: 'ab' }));
    renderer.enqueue(document.takeChanges());
    const camera = { ...CAMERA, zoom: 0.1 };
    expect(drawFrame(backend, renderer, camera)).toEqual(['note instances [0, +1)']);
    const large = stickyObject('note', { text: 'ab' }).runs.map((run) => ({
      ...run,
      style: { ...run.style, fontSize: 40 },
    }));
    document.update('note', { runs: large });
    renderer.enqueue(document.takeChanges());
    // 40-unit text, 50-unit lines: 5 device pixels at 0.1.
    expect(drawFrame(backend, renderer, camera)).toEqual([
      'note instances [0, +1)',
      'text instances [0, +2)',
    ]);
  });
});
