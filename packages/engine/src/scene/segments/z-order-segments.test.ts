import { describe, expect, it } from 'vitest';

import type { Camera } from '../../camera/camera.js';
import { FakeGpuBackend } from '../__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, zKeyAt } from '../__fixtures__/scene-objects.js';
import type { InstanceRange, SceneCuller } from '../scene-culler.js';
import type { ScenePass } from '../scene-pass.js';
import { SceneRenderer } from '../scene-renderer.js';

import {
  NOTE_PASS,
  stickyObject,
  TEXT_PASS,
  textObject,
} from './__fixtures__/note-and-text-passes.js';
import { ZOrderSegments } from './z-order-segments.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 200, viewportHeightPx: 100, dpr: 1 };

/** A culler whose visible ranges the test sets: the stand-in for the R-tree culler. */
class ScriptedCuller implements SceneCuller {
  visible = new Map<string, readonly InstanceRange[]>();
  cull(): ReadonlyMap<string, readonly InstanceRange[]> {
    return this.visible;
  }
}

function setUp(culler?: SceneCuller): {
  backend: FakeGpuBackend;
  renderer: SceneRenderer;
  document: FakeSceneDocument;
  segments: ZOrderSegments;
} {
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend, {
    passes: [NOTE_PASS, TEXT_PASS],
    isZOrdered: false,
    ...(culler ? { culler } : {}),
  });
  const segments = new ZOrderSegments();
  segments.install(renderer.frame);
  return { backend, renderer, document: new FakeSceneDocument(), segments };
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

describe('ZOrderSegments', () => {
  it('draws a note over the text below it, as the prototype did, not text over the note', () => {
    const { backend, renderer, document } = setUp();
    document.create(textObject('label', { z: 'a0' }), stickyObject('note', { z: 'a1' }));
    renderer.enqueue(document.takeChanges());
    expect(drawFrame(backend, renderer)).toEqual([
      'text instances [0, +2)',
      'note instances [0, +1)',
    ]);
  });

  it('draws text over the note below it in one segment, the note pass first', () => {
    const { backend, renderer, document } = setUp();
    document.create(stickyObject('note', { z: 'a0' }), textObject('label', { z: 'a1' }));
    renderer.enqueue(document.takeChanges());
    expect(drawFrame(backend, renderer)).toEqual([
      'note instances [0, +1)',
      'text instances [0, +2)',
    ]);
  });

  it('covers the text of a lower note with a higher note, and keeps each note under its own text', () => {
    const { backend, renderer, document } = setUp();
    document.create(
      stickyObject('lower', { z: 'a0', text: 'ab' }),
      stickyObject('upper', { z: 'a1', text: 'cd' }),
    );
    renderer.enqueue(document.takeChanges());
    expect(drawFrame(backend, renderer)).toEqual([
      'note instances [0, +1)',
      'text instances [0, +2)',
      'note instances [1, +1)',
      'text instances [2, +2)',
    ]);
  });

  it('keeps draw calls within segments × passes, not object count', () => {
    const { backend, renderer, document } = setUp();
    const notes = 10;
    for (let index = 0; index < notes; index += 1) {
      // Three text boxes, then a note covering them: every note starts a segment.
      for (let label = 0; label < 3; label += 1) {
        const position = index * 4 + label;
        document.create(textObject(`t${String(position)}`, { z: zKeyAt(position) }));
      }
      document.create(stickyObject(`n${String(index)}`, { z: zKeyAt(index * 4 + 3) }));
    }
    renderer.enqueue(document.takeChanges());
    const draws = drawFrame(backend, renderer);
    const segments = notes + 1;
    expect(draws.length).toBeLessThanOrEqual(segments * 2);
    expect(draws.length).toBe(notes * 2);
    expect(draws.slice(0, 3)).toEqual([
      'text instances [0, +6)',
      'note instances [0, +1)',
      'text instances [6, +6)',
    ]);
  });

  it('re-plans nothing on camera-only frames or when objects only move', () => {
    const { backend, renderer, document, segments } = setUp();
    document.create(textObject('label', { z: 'a0' }), stickyObject('note', { z: 'a1' }));
    renderer.enqueue(document.takeChanges());
    drawFrame(backend, renderer);
    expect(segments.counts).toEqual({
      orderBuilds: 1,
      orderEdits: 0,
      slotBuilds: 1,
      plans: 1,
      slotCompactions: 0,
    });
    for (let frame = 1; frame <= 5; frame += 1) {
      drawFrame(backend, renderer, { ...CAMERA, x: frame * 10, zoom: 1 + frame / 10 });
    }
    document.update('note', { x: 30, y: 12 });
    renderer.enqueue(document.takeChanges());
    const draws = drawFrame(backend, renderer);
    expect(segments.counts).toEqual({
      orderBuilds: 1,
      orderEdits: 0,
      slotBuilds: 1,
      plans: 1,
      slotCompactions: 0,
    });
    expect(draws).toEqual(['text instances [0, +2)', 'note instances [0, +1)']);
  });

  it('re-plans when a z key changes, reversing which object covers the other', () => {
    const { backend, renderer, document, segments } = setUp();
    document.create(textObject('label', { z: 'a0' }), stickyObject('note', { z: 'a1' }));
    renderer.enqueue(document.takeChanges());
    drawFrame(backend, renderer);
    document.update('label', { z: 'a2' });
    renderer.enqueue(document.takeChanges());
    expect(drawFrame(backend, renderer)).toEqual([
      'note instances [0, +1)',
      'text instances [0, +2)',
    ]);
    // A leaf restacked edits the order in place: no walk, its slots patched.
    expect(segments.counts).toEqual({
      orderBuilds: 1,
      orderEdits: 1,
      slotBuilds: 1,
      plans: 2,
      slotCompactions: 0,
    });
  });

  it('patches the slot owners, rebuilding neither them nor the paint order, when a record count changes', () => {
    const { backend, renderer, document, segments } = setUp();
    document.create(textObject('label', { z: 'a0' }), stickyObject('note', { z: 'a1' }));
    renderer.enqueue(document.takeChanges());
    drawFrame(backend, renderer);
    document.update('label', { text: 'abc', runs: textObject('label', { text: 'abc' }).runs });
    renderer.enqueue(document.takeChanges());
    expect(drawFrame(backend, renderer)).toEqual([
      'text instances [0, +3)',
      'note instances [0, +1)',
    ]);
    // Only the text's slots are rewritten.
    expect(segments.counts).toEqual({
      orderBuilds: 1,
      orderEdits: 0,
      slotBuilds: 1,
      plans: 2,
      slotCompactions: 0,
    });
    expect(segments.slotPatchCount).toBe(1);
  });

  it('re-plans without a new paint order when an object stops occluding', () => {
    // A translucent note hides nothing, so this pass flags only opaque ones.
    const opaqueNotes: ScenePass = {
      ...NOTE_PASS,
      isOccluder: (object) =>
        object.type === 'sticky' && Array.isArray(object.color) && object.color[3] === 1,
    };
    const backend = new FakeGpuBackend();
    const renderer = new SceneRenderer(backend, {
      passes: [opaqueNotes, TEXT_PASS],
      isZOrdered: false,
    });
    const segments = new ZOrderSegments();
    segments.install(renderer.frame);
    const document = new FakeSceneDocument();
    document.create(textObject('label', { z: 'a0' }), stickyObject('note', { z: 'a1' }));
    renderer.enqueue(document.takeChanges());
    expect(drawFrame(backend, renderer)).toEqual([
      'text instances [0, +2)',
      'note instances [0, +1)',
    ]);
    document.update('note', { color: [1, 0.92, 0.55, 0.5] });
    renderer.enqueue(document.takeChanges());
    expect(drawFrame(backend, renderer)).toEqual([
      'note instances [0, +1)',
      'text instances [0, +2)',
    ]);
    expect(segments.counts).toEqual({
      orderBuilds: 1,
      orderEdits: 0,
      slotBuilds: 1,
      plans: 2,
      slotCompactions: 0,
    });
  });

  it('re-plans when the visible ranges change, and not when they stay the same', () => {
    const culler = new ScriptedCuller();
    const { backend, renderer, document, segments } = setUp(culler);
    document.create(
      textObject('a', { z: 'a0' }),
      stickyObject('note', { z: 'a1' }),
      textObject('b', { z: 'a2' }),
    );
    renderer.enqueue(document.takeChanges());
    culler.visible = new Map([['text', [{ start: 0, count: 4 }]]]);
    expect(drawFrame(backend, renderer)).toEqual(['text instances [0, +4)']);
    culler.visible = new Map([['text', [{ start: 0, count: 4 }]]]);
    drawFrame(backend, renderer, { ...CAMERA, x: 5 });
    expect(segments.counts.plans).toBe(1);
    culler.visible = new Map([['text', [{ start: 0, count: 2 }]]]);
    expect(drawFrame(backend, renderer, { ...CAMERA, x: 6 })).toEqual(['text instances [0, +2)']);
    culler.visible = new Map([['note', [{ start: 0, count: 1 }]]]);
    expect(drawFrame(backend, renderer, { ...CAMERA, x: 7 })).toEqual(['note instances [0, +1)']);
    culler.visible = new Map([
      ['note', [{ start: 0, count: 1 }]],
      ['text', [{ start: 0, count: 4 }]],
    ]);
    expect(drawFrame(backend, renderer, { ...CAMERA, x: 10 })).toEqual([
      'text instances [0, +2)',
      'note instances [0, +1)',
      'text instances [2, +2)',
    ]);
    expect(segments.counts).toEqual({
      orderBuilds: 1,
      orderEdits: 0,
      slotBuilds: 1,
      plans: 4,
      slotCompactions: 0,
    });
  });

  it('forgets deleted objects and never draws their released records', () => {
    const { backend, renderer, document } = setUp();
    document.create(textObject('label', { z: 'a0' }), stickyObject('note', { z: 'a1' }));
    renderer.enqueue(document.takeChanges());
    drawFrame(backend, renderer);
    document.delete('note');
    renderer.enqueue(document.takeChanges());
    expect(drawFrame(backend, renderer)).toEqual(['text instances [0, +2)']);
  });

  it('refuses to draw when installed after the scene already applied changes', () => {
    const backend = new FakeGpuBackend();
    const renderer = new SceneRenderer(backend, {
      passes: [NOTE_PASS, TEXT_PASS],
      isZOrdered: false,
    });
    const document = new FakeSceneDocument();
    document.create(stickyObject('note'));
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    new ZOrderSegments().install(renderer.frame);
    expect(() => renderer.renderFrame({ timeMs: 16, camera: CAMERA })).toThrow(/install/);
  });

  it('is installed by SceneRenderer by default, right after cull', () => {
    const backend = new FakeGpuBackend();
    const renderer = new SceneRenderer(backend, { passes: [NOTE_PASS, TEXT_PASS] });
    expect(renderer.frame.stageNames.slice(3, 5)).toEqual(['cull', 'zOrderSegments']);
    const document = new FakeSceneDocument();
    document.create(textObject('label', { z: 'a0' }), stickyObject('note', { z: 'a1' }));
    renderer.enqueue(document.takeChanges());
    expect(drawFrame(backend, renderer)).toEqual([
      'text instances [0, +2)',
      'note instances [0, +1)',
    ]);
  });
});
