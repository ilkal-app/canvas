import { describe, expect, it } from 'vitest';

import type { Camera } from '../camera/camera.js';
import type { GpuBindGroupEntry } from '../gpu/gpu-bind-group.js';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import {
  FakeSceneDocument,
  frameObject,
  shapeObject,
  zKeyAt,
} from './__fixtures__/scene-objects.js';
import type { DrawListEntry } from './draw-list.js';
import type { FrameContext } from './frame-context.js';
import type { SceneObject, ScenePass, ScenePassEnvironment } from './scene-pass.js';
import { SceneRenderer } from './scene-renderer.js';
import { SOLID_RECT_PASS } from './solid-rect-pass.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 200, viewportHeightPx: 100, dpr: 1 };

/**
 * A paged stand-in pass: two records per shape, each on the page its shape's `cornerRadius`
 * names plus the record index, so a test moves records between pages by editing a field. The
 * solid-rect pipeline stands in for an atlas-sampling one; only paging matters to the fake
 * backend.
 *
 * @param forgotten - Collects the ids the pass is told to forget.
 * @param pageShift - Added to every page, so a test moves pages without a document change.
 * @param pageShift.value - The shift.
 * @returns The pass.
 */
function pagedPass(forgotten: string[] = [], pageShift = { value: 0 }): ScenePass {
  const pageOf = ({ object }: SceneObject, recordIndex: number): number =>
    (object.type === 'shape' ? object.cornerRadius : 0) + recordIndex + pageShift.value;
  return {
    ...SOLID_RECT_PASS,
    name: 'paged',
    pipelineSpec: {
      ...SOLID_RECT_PASS.pipelineSpec,
      pageBindings: [
        { binding: 1, kind: 'texture', samplerBinding: 2 },
        { binding: 2, kind: 'sampler' },
      ],
    },
    recordCount: (object) => (object.type === 'shape' ? 2 : 0),
    isOccluder: (object) => object.type === 'shape' && object.id.startsWith('occluder'),
    prepare(record, target, recordIndex) {
      SOLID_RECT_PASS.prepare(record, target, recordIndex);
    },
    pageOf,
    pageEntries: (page) => [
      { binding: 1, texture: pageTexture(page) },
      { binding: 2, sampler: SAMPLER },
    ],
    forget: (id) => {
      forgotten.push(id);
    },
  };
}

const SAMPLER = {
  filter: 'linear',
  addressMode: 'clamp-to-edge',
  destroy: () => undefined,
} as const;
const TEXTURES = new Map<number, { destroy: () => void }>();
function pageTexture(page: number): never {
  let texture = TEXTURES.get(page);
  if (texture === undefined) {
    texture = { destroy: () => undefined };
    TEXTURES.set(page, texture);
  }
  return texture as never;
}

/**
 * Records the draw list the draw stage sees.
 *
 * @param renderer - The renderer.
 * @returns Each frame's draw list, in order.
 */
function captureDrawList(renderer: SceneRenderer): { readonly lists: DrawListEntry[][] } {
  const lists: DrawListEntry[][] = [];
  renderer.frame.insertStage('before', 'draw', {
    name: 'captureDrawList',
    run: (context: FrameContext) => {
      lists.push(context.drawList.map((entry) => ({ ...entry })));
    },
  });
  return { lists };
}

describe('paged scene passes', () => {
  it('splits the culled entry by page and binds each page once', () => {
    const backend = new FakeGpuBackend();
    const renderer = new SceneRenderer(backend, { passes: [pagedPass()], isZOrdered: false });
    const { lists } = captureDrawList(renderer);
    const document = new FakeSceneDocument();
    document.create(shapeObject('a', { z: zKeyAt(0) }), shapeObject('b', { cornerRadius: 1 }));
    renderer.enqueue(document.takeChanges());
    backend.resetCalls();
    const stats = renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    // Slots: a0 (page 0), a1 (page 1), b0 (page 1), b1 (page 2).
    expect(lists[0]).toEqual([
      { passName: 'paged', page: 0, ranges: [{ start: 0, count: 1 }] },
      { passName: 'paged', page: 1, ranges: [{ start: 1, count: 2 }] },
      { passName: 'paged', page: 2, ranges: [{ start: 3, count: 1 }] },
    ]);
    expect(stats.drawCalls).toBe(3);
    expect(backend.count('createBindGroup')).toBe(3);
    backend.resetCalls();
    renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    expect(backend.count('createBindGroup')).toBe(0);
  });

  it('splits z-order segments by page, at most segments × pages entries per pass', () => {
    const renderer = new SceneRenderer(new FakeGpuBackend(), {
      passes: [SOLID_RECT_PASS, pagedPass()],
    });
    const { lists } = captureDrawList(renderer);
    const document = new FakeSceneDocument();
    document.create(
      shapeObject('a', { z: zKeyAt(0), kind: 'ellipse' }),
      frameObject('f', { z: zKeyAt(1) }),
      shapeObject('c', { z: zKeyAt(2), kind: 'ellipse', cornerRadius: 1 }),
    );
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    // The frame's background occludes a, so it starts a segment; c paints over it. Paged slots:
    // a0 (page 0), a1 (page 1), c0 (page 1), c1 (page 2).
    expect(lists[0]).toEqual([
      { passName: 'paged', page: 0, ranges: [{ start: 0, count: 1 }] },
      { passName: 'paged', page: 1, ranges: [{ start: 1, count: 1 }] },
      { passName: 'solid-rect', ranges: [{ start: 0, count: 1 }] },
      { passName: 'paged', page: 1, ranges: [{ start: 2, count: 1 }] },
      { passName: 'paged', page: 2, ranges: [{ start: 3, count: 1 }] },
    ]);
  });

  it('re-plans when rewritten records change page with no document change', () => {
    const shift = { value: 0 };
    const renderer = new SceneRenderer(new FakeGpuBackend(), {
      passes: [pagedPass([], shift)],
    });
    const { lists } = captureDrawList(renderer);
    const document = new FakeSceneDocument();
    const shape = shapeObject('a');
    document.create(shape);
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    shift.value = 5;
    const transform = { cos: 1, sin: 0, x: 0, y: 0 };
    expect(renderer.scene.rewriteRecords('paged', [{ object: shape, transform }])).toBe(0);
    expect(renderer.scene.pageRevisionOf('paged')).toBeGreaterThan(0);
    renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    expect(lists[1]?.map(({ page }) => page)).toEqual([5, 6]);
  });

  it('refuses to rewrite an object whose record count changed, and tells the pass of removals', () => {
    const forgotten: string[] = [];
    const renderer = new SceneRenderer(new FakeGpuBackend(), { passes: [pagedPass(forgotten)] });
    const document = new FakeSceneDocument();
    document.create(shapeObject('a'), shapeObject('b'));
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    const retyped = { ...shapeObject('a'), type: 'group' } as never;
    expect(() =>
      renderer.scene.rewriteRecords('paged', [
        { object: retyped, transform: { cos: 1, sin: 0, x: 0, y: 0 } },
      ]),
    ).toThrow(RangeError);
    document.delete('a');
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    expect(forgotten).toEqual(['a']);
    expect(renderer.scene.pagesOf('paged')).toBeInstanceOf(Int32Array);
  });

  it('builds factory passes with the environment, installs them and destroys them with the renderer', () => {
    const events: string[] = [];
    const renderer = new SceneRenderer(new FakeGpuBackend(), {
      environment: { now: () => 42 },
      passes: [
        {
          name: 'built',
          create: (environment) => ({
            ...SOLID_RECT_PASS,
            name: 'built',
            install: () => {
              events.push(`install at ${String(environment.now())}`);
            },
            destroy: () => {
              events.push('destroy');
            },
          }),
        },
      ],
    });
    expect(renderer.scene.passes.map(({ name }) => name)).toEqual(['built']);
    renderer.destroy();
    expect(events).toEqual(['install at 42', 'destroy']);
  });

  it('gives factories a frame request that does nothing and a clock at 0 by default', () => {
    let environment: ScenePassEnvironment | undefined;
    new SceneRenderer(new FakeGpuBackend(), {
      passes: [
        {
          name: 'built',
          create: (given) => {
            environment = given;
            return SOLID_RECT_PASS;
          },
        },
      ],
    });
    expect(environment?.now()).toBe(0);
    expect(environment?.requestFrame()).toBeUndefined();
  });

  it('rebuilds a page bind group only when the pass names other resources for it', () => {
    const backend = new FakeGpuBackend();
    const [first, second] = [pageTexture(10), pageTexture(11)];
    const uniform = backend.createBuffer({ usage: 'uniform', byteLength: 16 });
    const otherUniform = backend.createBuffer({ usage: 'uniform', byteLength: 16 });
    const otherSampler = { ...SAMPLER };
    // Each list differs from the one before in one way: a texture, a buffer, a sampler, a
    // binding, the length.
    const lists: GpuBindGroupEntry[][] = [
      [
        { binding: 1, buffer: uniform },
        { binding: 2, texture: first },
        { binding: 3, sampler: SAMPLER },
      ],
      [
        { binding: 1, buffer: uniform },
        { binding: 2, texture: second },
        { binding: 3, sampler: SAMPLER },
      ],
      [
        { binding: 1, buffer: otherUniform },
        { binding: 2, texture: second },
        { binding: 3, sampler: SAMPLER },
      ],
      [
        { binding: 1, buffer: otherUniform },
        { binding: 2, texture: second },
        { binding: 3, sampler: otherSampler },
      ],
      [
        { binding: 1, buffer: otherUniform },
        { binding: 3, texture: second },
        { binding: 2, sampler: otherSampler },
      ],
      [{ binding: 1, buffer: otherUniform }],
    ];
    let current = 0;
    const pass: ScenePass = {
      ...pagedPass(),
      pipelineSpec: {
        ...SOLID_RECT_PASS.pipelineSpec,
        pageBindings: [
          { binding: 1, kind: 'uniform-buffer' },
          { binding: 2, kind: 'texture', samplerBinding: 3 },
          { binding: 3, kind: 'sampler' },
        ],
      },
      pageOf: () => 0,
      pageEntries: () => lists[current] ?? [],
    };
    const renderer = new SceneRenderer(backend, { passes: [pass], isZOrdered: false });
    const document = new FakeSceneDocument();
    document.create(shapeObject('a'));
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    backend.resetCalls();
    renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    expect(backend.count('createBindGroup')).toBe(0);
    for (current = 1; current < lists.length; current += 1) {
      backend.resetCalls();
      renderer.renderFrame({ timeMs: 16 * (current + 1), camera: CAMERA });
      expect(backend.count('createBindGroup'), `list ${String(current)}`).toBe(1);
    }
  });

  it('refuses to draw a paged pass that gives no page entries', () => {
    const withoutEntries = Object.fromEntries(
      Object.entries(pagedPass()).filter(([key]) => key !== 'pageEntries'),
    ) as unknown as ScenePass;
    const renderer = new SceneRenderer(new FakeGpuBackend(), {
      passes: [withoutEntries],
      isZOrdered: false,
    });
    const document = new FakeSceneDocument();
    document.create(shapeObject('a'));
    renderer.enqueue(document.takeChanges());
    expect(() => renderer.renderFrame({ timeMs: 0, camera: CAMERA })).toThrow(/pageEntries/);
  });

  it('forgets an object the pass stops drawing, and names unknown passes', () => {
    const forgotten: string[] = [];
    const renderer = new SceneRenderer(new FakeGpuBackend(), { passes: [pagedPass(forgotten)] });
    const document = new FakeSceneDocument();
    document.create(shapeObject('a'));
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    document.update('a', { type: 'group' } as never);
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 16, camera: CAMERA });
    expect(forgotten).toEqual(['a']);
    const ghost = { object: shapeObject('ghost', { type: 'group' } as never), transform: IDENTITY };
    expect(renderer.scene.rewriteRecords('paged', [ghost])).toBe(0);
    expect(() => renderer.scene.pagesOf('nope')).toThrow(RangeError);
    expect(renderer.scene.pagesOf('paged')).toBeInstanceOf(Int32Array);
  });
});

const IDENTITY = { cos: 1, sin: 0, x: 0, y: 0 };
