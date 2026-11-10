import { describe, expect, it } from 'vitest';

import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import { InstanceBuffer } from '../scene/instance-buffer.js';
import { resolveSceneInstanceLayout } from '../scene/instance-layout.js';

import { PATH_RECORD_TEXELS, PathRecordTexture } from './path-record-texture.js';

const LAYOUT = resolveSceneInstanceLayout([
  { location: 1, format: 'float32x4' },
  { location: 2, format: 'float32x4' },
]);

function recordsOf(count: number): InstanceBuffer {
  const instances = new InstanceBuffer(LAYOUT, { initialCapacity: count });
  for (let index = 0; index < count; index += 1) {
    const slot = instances.allocate();
    // placement, colour, clip slot, transparency
    instances.write(
      slot,
      Float32Array.from([1, 0, slot, 2 * slot, 0.1, 0.2, 0.3, 1, slot % 3, 0.25]),
    );
  }
  return instances;
}

function textureWrites(backend: FakeGpuBackend): number[] {
  return backend.calls.flatMap((call) => (call.method === 'writeTexture' ? [call.byteLength] : []));
}

describe('PathRecordTexture', () => {
  it('lays out three texels per slot and keeps the move index in the last float', () => {
    const backend = new FakeGpuBackend();
    const texture = new PathRecordTexture(backend, 'records');
    const instances = recordsOf(4);
    texture.sync(instances, [0, 1, 2, 3], (slot) => (slot === 2 ? 5 : 0));
    texture.flush();
    expect([...texture.texelsOf(2)]).toEqual(
      [1, 0, 2, 4, 0.1, 0.2, 0.3, 1, 2, 0.25, 0, 5].map(Math.fround),
    );
    expect(texture.texture.width * texture.texture.height).toBeGreaterThanOrEqual(
      4 * PATH_RECORD_TEXELS,
    );
    texture.destroy();
  });

  it('uploads only the slots that changed, one write per row they cover', () => {
    // Eight texels a row: a slot's three texels may cross a row.
    const backend = new FakeGpuBackend({ maxTextureSize: 8 });
    const texture = new PathRecordTexture(backend, 'records');
    const instances = recordsOf(16);
    const slots = [...Array(16).keys()];
    texture.sync(instances, slots, () => 0);
    expect(texture.texture.width).toBe(8);
    expect(texture.texture.height).toBe(6);
    texture.flush();
    backend.resetCalls();
    const revision = texture.revision;
    texture.sync(instances, slots, () => 0);
    expect(texture.flush()).toEqual({ uploadedBytes: 0, writes: 0 });
    expect(texture.revision).toBe(revision);
    // Slot 2 is texels 6–8: the end of row 0 and the start of row 1.
    instances.writePartial(2, 4, Float32Array.from([0.9]));
    texture.sync(instances, slots, () => 0);
    expect(texture.revision).toBe(revision + 1);
    expect(texture.flush()).toEqual({ uploadedBytes: 3 * 16, writes: 2 });
    expect(textureWrites(backend)).toEqual([2 * 16, 16]);
    expect(texture.texelsOf(2)[4]).toBeCloseTo(0.9);
    texture.destroy();
  });

  it('keeps its texels when it grows with the instance buffer', () => {
    const backend = new FakeGpuBackend();
    const texture = new PathRecordTexture(backend, 'records');
    const small = recordsOf(2);
    texture.sync(small, [0, 1], () => 0);
    texture.flush();
    const before = texture.texture;
    const before1 = texture.texelsOf(1);
    const large = recordsOf(64);
    texture.sync(large, [40], () => 0);
    expect(texture.texture).not.toBe(before);
    expect(texture.texelsOf(1)).toEqual(before1);
    expect(texture.flush().uploadedBytes).toBeGreaterThanOrEqual(64 * PATH_RECORD_TEXELS * 16);
    texture.destroy();
  });

  it('refuses more records than the texture or exact float indices allow', () => {
    const backend = new FakeGpuBackend({ maxTextureSize: 4 });
    const texture = new PathRecordTexture(backend, 'records');
    expect(() => {
      texture.sync(recordsOf(8), [0], () => 0);
    }).toThrow(RangeError);
  });
});
