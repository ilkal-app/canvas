import { describe, expect, it } from 'vitest';

import { GlyphAtlas } from '../atlas/glyph-atlas.js';
import type { GlyphBitmap } from '../atlas/glyph-bitmap.js';
import { BASE_TIER } from '../atlas/glyph-tiers.js';

import { RecordingGpuBackend } from './__fixtures__/recording-gpu-backend.js';
import { GlyphInstanceBatch } from './glyph-instance-batch.js';
import { GLYPH_INSTANCE_BYTES, type GlyphQuad } from './glyph-instance.js';
import type { GlyphQuads } from './glyph-quads.js';
import { TextRenderer } from './text-renderer.js';

const FACE = '400|n|Fake';

function bitmap(field: 'msdf' | 'sdf'): GlyphBitmap {
  return {
    field,
    width: 4,
    height: 4,
    pixels: new Uint8Array(field === 'msdf' ? 48 : 16),
    left: 0,
    top: 4,
    advance: 5,
  };
}

function quads(pageId: number, count: number): GlyphQuads {
  const quad: GlyphQuad = {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    u0: 0,
    v0: 0,
    u1: 1,
    v1: 1,
    color: [0, 0, 0, 1],
  };
  return {
    quadsByPage: new Map([[pageId, Array<GlyphQuad>(count).fill(quad)]]),
    tiers: [],
    isComplete: true,
  };
}

describe('TextRenderer', () => {
  it('creates its pipeline, sampler and unit quad up front', () => {
    const backend = new RecordingGpuBackend();
    new TextRenderer(backend, new GlyphAtlas());
    expect(backend.callsNamed('createRenderPipeline')).toEqual([
      { label: 'msdf-text', blend: 'premultiplied' },
    ]);
    expect(backend.callsNamed('createSampler')).toEqual([
      { filter: 'linear', addressMode: 'clamp-to-edge', label: 'glyph-atlas' },
    ]);
    expect(backend.callsNamed('writeBuffer').map(({ byteLength }) => byteLength)).toEqual([48]);
  });

  it('gives each atlas page a texture of its format and a page uniform, then uploads its cells', () => {
    const backend = new RecordingGpuBackend();
    const atlas = new GlyphAtlas({ pageSize: 64 });
    const renderer = new TextRenderer(backend, atlas);
    atlas.insert(FACE, 0x41, BASE_TIER, bitmap('msdf'));
    atlas.insert(FACE, 0x42, BASE_TIER, bitmap('sdf'));
    renderer.prepare();
    expect(backend.callsNamed('createTexture')).toEqual([
      { format: 'rgba8unorm', width: 64, height: 64, label: 'glyph-page-0' },
      { format: 'r8unorm', width: 64, height: 64, label: 'glyph-page-1' },
    ]);
    const writes = backend.callsNamed('writeTexture');
    expect(writes.map(({ region, byteLength }) => [region, byteLength])).toEqual([
      [{ x: 0, y: 0, width: 6, height: 6 }, 6 * 6 * 4],
      [{ x: 0, y: 0, width: 6, height: 6 }, 6 * 6],
    ]);
    renderer.prepare();
    expect(backend.callsNamed('createTexture')).toHaveLength(2);
    expect(backend.callsNamed('writeTexture')).toHaveLength(2);
  });

  it('frees the texture of a page the atlas released', () => {
    const backend = new RecordingGpuBackend();
    const atlas = new GlyphAtlas({ pageSize: 64 });
    const renderer = new TextRenderer(backend, atlas);
    atlas.insert(FACE, 0x41, BASE_TIER, bitmap('msdf'));
    renderer.prepare();
    atlas.clear();
    renderer.prepare();
    expect(backend.destroyed).toEqual(['texture:glyph-page-0', 'buffer:glyph-page-0']);
  });

  it('refuses atlas pages larger than the backend allows', () => {
    const atlas = new GlyphAtlas({ pageSize: 64 });
    const renderer = new TextRenderer(new RecordingGpuBackend(32), atlas);
    atlas.insert(FACE, 0x41, BASE_TIER, bitmap('msdf'));
    expect(() => {
      renderer.prepare();
    }).toThrow(RangeError);
  });

  it('cannot upload glyphs while a pass is open', () => {
    const backend = new RecordingGpuBackend();
    const atlas = new GlyphAtlas({ pageSize: 64 });
    const renderer = new TextRenderer(backend, atlas);
    atlas.insert(FACE, 0x41, BASE_TIER, bitmap('msdf'));
    const pass = backend.beginRenderPass();
    expect(() => {
      renderer.prepare();
    }).toThrow(/pass is open/);
    pass.end();
  });

  it('draws a range with the pipeline, a cached bind group, both vertex buffers and firstInstance', () => {
    const backend = new RecordingGpuBackend();
    const atlas = new GlyphAtlas({ pageSize: 64 });
    const renderer = new TextRenderer(backend, atlas);
    atlas.insert(FACE, 0x41, BASE_TIER, bitmap('msdf'));
    renderer.prepare();
    const batch = new GlyphInstanceBatch(backend);
    batch.add(quads(0, 3));
    const [span] = batch.add(quads(0, 2));
    batch.upload();
    const camera = backend.createBuffer({ usage: 'uniform', byteLength: 32 });
    const pass = backend.beginRenderPass();
    if (span === undefined) throw new Error('no span');
    renderer.draw(pass, camera, batch.rangeOf(span));
    renderer.draw(pass, camera, batch.rangeOf(span));
    pass.end();
    expect(backend.callsNamed('createBindGroup')).toHaveLength(1);
    expect(backend.callsNamed('pass.draw')[0]).toEqual({
      vertexCount: 6,
      instanceCount: 2,
      firstVertex: 0,
      firstInstance: 3,
    });
    expect(backend.callsNamed('pass.setVertexBuffer').map(({ slot }) => slot)).toEqual([
      0, 1, 0, 1,
    ]);
  });

  it('skips an empty range and rejects a page it has no texture for', () => {
    const backend = new RecordingGpuBackend();
    const renderer = new TextRenderer(backend, new GlyphAtlas());
    const buffer = backend.createBuffer({ usage: 'vertex', byteLength: 36 });
    const camera = backend.createBuffer({ usage: 'uniform', byteLength: 32 });
    const pass = backend.beginRenderPass();
    renderer.draw(pass, camera, { pageId: 7, buffer, firstInstance: 0, instanceCount: 0 });
    expect(() => {
      renderer.draw(pass, camera, { pageId: 7, buffer, firstInstance: 0, instanceCount: 1 });
    }).toThrow(/prepare/);
    pass.end();
    expect(backend.callsNamed('pass.draw')).toEqual([]);
  });

  it('frees everything it created', () => {
    const backend = new RecordingGpuBackend();
    const atlas = new GlyphAtlas({ pageSize: 64 });
    const renderer = new TextRenderer(backend, atlas);
    atlas.insert(FACE, 0x41, BASE_TIER, bitmap('msdf'));
    renderer.prepare();
    renderer.destroy();
    expect(backend.destroyed).toEqual([
      'texture:glyph-page-0',
      'buffer:glyph-page-0',
      'buffer:glyph-quad',
      'sampler',
      'pipeline',
    ]);
  });
});

describe('GlyphInstanceBatch', () => {
  it('writes each page to its own instance buffer and returns one range per page', () => {
    const backend = new RecordingGpuBackend();
    const batch = new GlyphInstanceBatch(backend);
    batch.add(quads(0, 2));
    batch.add(quads(4, 1));
    const ranges = batch.upload();
    expect(
      ranges.map(({ pageId, firstInstance, instanceCount }) => [
        pageId,
        firstInstance,
        instanceCount,
      ]),
    ).toEqual([
      [0, 0, 2],
      [4, 0, 1],
    ]);
    expect(backend.callsNamed('writeBuffer').map(({ byteLength }) => byteLength)).toEqual([
      2 * GLYPH_INSTANCE_BYTES,
      GLYPH_INSTANCE_BYTES,
    ]);
  });

  it('reuses buffers across refills and grows them by doubling', () => {
    const backend = new RecordingGpuBackend();
    const batch = new GlyphInstanceBatch(backend);
    batch.add(quads(0, 2));
    batch.upload();
    batch.clear();
    batch.add(quads(0, 1));
    expect(batch.upload()).toHaveLength(1);
    expect(backend.callsNamed('createBuffer')).toHaveLength(1);
    batch.clear();
    batch.add(quads(0, 3));
    batch.upload();
    expect(backend.callsNamed('createBuffer').map(({ byteLength }) => byteLength)).toEqual([
      2 * GLYPH_INSTANCE_BYTES,
      4 * GLYPH_INSTANCE_BYTES,
    ]);
    expect(backend.destroyed).toEqual(['buffer:glyph-instances-0']);
  });

  it('skips pages left empty by a refill, and rejects ranges of pages never uploaded', () => {
    const backend = new RecordingGpuBackend();
    const batch = new GlyphInstanceBatch(backend);
    const [span] = batch.add(quads(0, 1));
    if (span === undefined) throw new Error('no span');
    expect(() => batch.rangeOf(span)).toThrow(/uploaded/);
    batch.upload();
    batch.clear();
    expect(batch.upload()).toEqual([]);
    batch.destroy();
    expect(backend.destroyed).toEqual(['buffer:glyph-instances-0']);
  });
});
