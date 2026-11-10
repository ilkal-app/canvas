// Pin the two GPU pipeline contracts and the reusable run cover geometry.
import { describe, expect, it, vi } from 'vitest';

import { MOVE_INDEX_LAYOUT } from '../../gpu/move-placement.js';
import type { MovePlacementBinding } from '../../gpu/move-placement.js';
import { GLYPH_EDGE_MOVE_SHADER } from '../../gpu/shaders/glyph-edge-move.generated.js';
import { GLYPH_EDGE_SHADER } from '../../gpu/shaders/glyph-edge.generated.js';
import { GLYPH_STENCIL_MOVE_SHADER } from '../../gpu/shaders/glyph-stencil-move.generated.js';
import { GLYPH_STENCIL_SHADER } from '../../gpu/shaders/glyph-stencil.generated.js';
import { PATH_MOVE_SHADER } from '../../gpu/shaders/path-move.generated.js';
import { PATH_SHADER } from '../../gpu/shaders/path.generated.js';
import { TransformTable } from '../../gpu/transform-table.js';
import { resolveVertexBufferLayouts } from '../../gpu/vertex-layout.js';
import { FakeGpuBackend } from '../../scene/__fixtures__/fake-gpu-backend.js';
import { CLIP_TABLE_BINDING, ClipTableTexture } from '../../scene/clip-table-texture.js';
import { ClipTable } from '../../scene/clip-table.js';
import { resolveSceneInstanceLayout } from '../../scene/instance-layout.js';
import type { ClipRect } from '../../spatial/clip-chain.js';

import type { GlyphBounds } from './glyph-geometry.js';
import {
  GLYPH_STENCIL_VERTEX_LAYOUT,
  VECTOR_COVER_STATE,
  VECTOR_COVER_VERTEX_LAYOUT,
  VECTOR_STENCIL_STATE,
  createVectorTextPipelines,
  destroyVectorTextPipelines,
  vectorCoverQuad,
} from './vector-text-pipelines.js';

const RECORD_LAYOUT = resolveSceneInstanceLayout([
  { location: 1, format: 'float32x4' },
  { location: 2, format: 'float32x4' },
]);
// The count keeps the top bit for what the edge hulls paint; the cover reads the count
// bits only; the hulls paint where that bit is clear; the cleanup clears every bit.
const STENCIL_STATE = {
  compare: 'always',
  passOperation: 'increment-wrap',
  backPassOperation: 'decrement-wrap',
  writeMask: 0x7f,
} as const;
const EDGE_STATE = {
  compare: 'not-equal',
  reference: 0x80,
  readMask: 0x80,
  passOperation: 'replace',
  writeMask: 0xff,
} as const;
const COVER_STATE = {
  compare: 'not-equal',
  reference: 0,
  readMask: 0x7f,
  passOperation: 'zero',
} as const;
const CLEANUP_STATE = {
  compare: 'not-equal',
  reference: 0,
  readMask: 0xff,
  passOperation: 'zero',
} as const;
const EDGE_LAYOUT = {
  stepMode: 'vertex',
  attributes: [
    { location: 0, format: 'float32x2' },
    { location: 3, format: 'float32x2' },
    { location: 4, format: 'float32x2' },
    { location: 5, format: 'float32x2' },
    { location: 6, format: 'float32' },
    { location: 8, format: 'float32x2' },
    { location: 9, format: 'float32x2' },
    { location: 10, format: 'float32x2' },
  ],
} as const;
const STENCIL_LAYOUT = {
  stepMode: 'vertex',
  attributes: [
    { location: 0, format: 'float32x2' },
    { location: 3, format: 'float32x2' },
  ],
} as const;
const COVER_LAYOUT = {
  stepMode: 'vertex',
  attributes: [{ location: 0, format: 'float32x2' }],
} as const;

function rect(id: string): ClipRect {
  return { id: id as ClipRect['id'], x: 0, y: 0, cos: 1, sin: 0, width: 10, height: 10 };
}

describe('vector text pipelines', () => {
  it.each([false, true])(
    'creates compatible count, edge, cover and cleanup descriptors (move=%s)',
    (isMove) => {
      const backend = new FakeGpuBackend();
      const camera = backend.createBuffer({ usage: 'uniform', byteLength: 32 });
      const clips = new ClipTableTexture(backend);
      const table = isMove ? new TransformTable(backend, 1) : undefined;
      const indices = isMove ? backend.createBuffer({ usage: 'vertex', byteLength: 4 }) : undefined;
      const placement: MovePlacementBinding | undefined =
        table && indices ? { table, indices, indexData: new Float32Array(1) } : undefined;
      const create = vi.spyOn(backend, 'createRenderPipeline');
      const bind = vi.spyOn(backend, 'createBindGroup');

      const pipelines = createVectorTextPipelines(
        backend,
        RECORD_LAYOUT,
        camera,
        clips,
        'vector text',
        placement,
      );
      expect(create).toHaveBeenCalledTimes(4);
      expect(backend.pipelines).toHaveLength(4);
      expect(pipelines.count).toBe(backend.pipelines[0]);
      expect(pipelines.edges).toBe(backend.pipelines[1]);
      expect(pipelines.cover).toBe(backend.pipelines[2]);
      expect(pipelines.cleanup).toBe(backend.pipelines[3]);
      expect(backend.pipelines.map((pipeline) => pipeline.label)).toEqual([
        'vector text count',
        'vector text edges',
        'vector text cover',
        'vector text cleanup',
      ]);

      const bindings = [
        { binding: 0, kind: 'uniform-buffer' },
        ...(isMove ? [{ binding: 4, kind: 'load-texture' }] : []),
        { binding: CLIP_TABLE_BINDING, kind: 'load-texture' },
      ];
      expect(create.mock.calls.map(([descriptor]) => descriptor)).toEqual([
        {
          shader: isMove ? GLYPH_STENCIL_MOVE_SHADER : GLYPH_STENCIL_SHADER,
          vertexBuffers: [
            STENCIL_LAYOUT,
            RECORD_LAYOUT.vertexBufferLayout,
            ...(isMove ? [MOVE_INDEX_LAYOUT] : []),
          ],
          bindings,
          blend: 'premultiplied',
          colorWrite: 'none',
          stencil: STENCIL_STATE,
          label: 'vector text count',
        },
        {
          shader: isMove ? GLYPH_EDGE_MOVE_SHADER : GLYPH_EDGE_SHADER,
          vertexBuffers: [
            EDGE_LAYOUT,
            RECORD_LAYOUT.vertexBufferLayout,
            ...(isMove ? [MOVE_INDEX_LAYOUT] : []),
          ],
          bindings,
          blend: 'premultiplied',
          colorWrite: 'all',
          stencil: EDGE_STATE,
          label: 'vector text edges',
        },
        {
          shader: isMove ? PATH_MOVE_SHADER : PATH_SHADER,
          vertexBuffers: [
            COVER_LAYOUT,
            RECORD_LAYOUT.vertexBufferLayout,
            ...(isMove ? [MOVE_INDEX_LAYOUT] : []),
          ],
          bindings,
          blend: 'premultiplied',
          colorWrite: 'all',
          stencil: COVER_STATE,
          label: 'vector text cover',
        },
        {
          shader: isMove ? PATH_MOVE_SHADER : PATH_SHADER,
          vertexBuffers: [
            COVER_LAYOUT,
            RECORD_LAYOUT.vertexBufferLayout,
            ...(isMove ? [MOVE_INDEX_LAYOUT] : []),
          ],
          bindings,
          blend: 'premultiplied',
          colorWrite: 'none',
          stencil: CLEANUP_STATE,
          label: 'vector text cleanup',
        },
      ]);
      for (const pipeline of [pipelines.edges, pipelines.cover, pipelines.cleanup])
        expect(pipeline.bindings).toEqual(pipelines.count.bindings);
      const first = pipelines.bindGroup;
      expect(bind).toHaveBeenCalledTimes(1);
      expect(bind.mock.calls[0]?.[0]).toMatchObject({
        pipeline: pipelines.count,
        entries: [
          { binding: 0, buffer: camera },
          ...(table ? [{ binding: 4, texture: table.texture }] : []),
          { binding: CLIP_TABLE_BINDING, texture: clips.texture },
        ],
      });
      expect(pipelines.bindGroup).toBe(first);
      expect(bind).toHaveBeenCalledTimes(1);

      destroyVectorTextPipelines(pipelines);
      table?.destroy();
      indices?.destroy();
      clips.destroy();
      camera.destroy();
    },
  );

  it('rebuilds one shared bind group when the clip texture is replaced', () => {
    const backend = new FakeGpuBackend();
    const camera = backend.createBuffer({ usage: 'uniform', byteLength: 32 });
    const table = new ClipTable();
    const clips = new ClipTableTexture(backend, table);
    const bind = vi.spyOn(backend, 'createBindGroup');
    const pipelines = createVectorTextPipelines(
      backend,
      RECORD_LAYOUT,
      camera,
      clips,
      'vector text',
    );
    const first = pipelines.bindGroup;
    const originalTexture = clips.texture;
    for (let index = 1; index <= 16; index += 1) {
      table.set(rect(`clip-${String(index)}`), undefined, 0);
    }
    clips.flush({ uploadedBytes: 0 });
    expect(clips.texture).not.toBe(originalTexture);
    const second = pipelines.bindGroup;
    expect(second).not.toBe(first);
    expect(second.entries).toEqual([
      { binding: 0, buffer: camera },
      { binding: CLIP_TABLE_BINDING, texture: clips.texture },
    ]);
    expect(pipelines.bindGroup).toBe(second);
    expect(bind).toHaveBeenCalledTimes(2);
    destroyVectorTextPipelines(pipelines);
    clips.destroy();
    camera.destroy();
  });

  it('destroys both pipelines', () => {
    const backend = new FakeGpuBackend();
    const camera = backend.createBuffer({ usage: 'uniform', byteLength: 32 });
    const clips = new ClipTableTexture(backend);
    const pipelines = createVectorTextPipelines(
      backend,
      RECORD_LAYOUT,
      camera,
      clips,
      'vector text',
    );
    const destroys = [pipelines.count, pipelines.edges, pipelines.cover, pipelines.cleanup].map(
      (pipeline) => vi.spyOn(pipeline, 'destroy'),
    );
    destroyVectorTextPipelines(pipelines);
    for (const destroy of destroys) expect(destroy).toHaveBeenCalledOnce();
    clips.destroy();
    camera.destroy();
  });

  it('lays out x, y, u, v at the same 16-byte stride as a vector run mesh', () => {
    expect(GLYPH_STENCIL_VERTEX_LAYOUT).toEqual(STENCIL_LAYOUT);
    expect(VECTOR_COVER_VERTEX_LAYOUT).toEqual(COVER_LAYOUT);
    expect(VECTOR_STENCIL_STATE).toEqual(STENCIL_STATE);
    expect(VECTOR_COVER_STATE).toEqual(COVER_STATE);
    const [stencil] = resolveVertexBufferLayouts([GLYPH_STENCIL_VERTEX_LAYOUT]);
    expect(stencil?.byteStride).toBe(4 * Float32Array.BYTES_PER_ELEMENT);
    expect(stencil?.attributes.map(({ byteOffset }) => byteOffset)).toEqual([0, 8]);
  });
});

describe('vectorCoverQuad', () => {
  const bounds: GlyphBounds = { minX: -2, minY: 3, maxX: 5, maxY: 11 };
  const vertices = [-2, 3, 5, 3, 5, 11, -2, 3, 5, 11, -2, 11];

  it('builds two triangles from the bounds in the box frame', () => {
    const quad = vectorCoverQuad(bounds);
    expect(quad).toBeInstanceOf(Float32Array);
    expect(Array.from(quad)).toEqual(vertices);
  });

  it('fills and returns a reusable output array', () => {
    const out = new Float32Array(16).fill(99);
    expect(vectorCoverQuad(bounds, out)).toBe(out);
    expect(Array.from(out.subarray(0, 12))).toEqual(vertices);
    expect(Array.from(out.subarray(12))).toEqual([99, 99, 99, 99]);
  });
});
