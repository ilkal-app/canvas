import { describe, expect, it } from 'vitest';

import type { Gradient, ObjectId } from '@canvas/schema';

import { FakeGpuBackend, type FakeGpuTexture } from '../scene/__fixtures__/fake-gpu-backend.js';

import { GRADIENT_RECORD_FLOATS, packGradientRecord } from './gradient-record.js';
import { PAINT_TABLE_RECORDS_PER_ROW, PaintTable } from './paint-table.js';

const id = (value: string) => value as ObjectId;

const gradient = (alpha: number): Gradient => ({
  type: 'linear',
  angle: 0,
  stops: [
    { offset: 0, color: [1, 0, 0, alpha] },
    { offset: 1, color: [0, 0, 1, 1] },
  ],
});

describe('PaintTable', () => {
  it('allocates no texture until a record is flushed', () => {
    const backend = new FakeGpuBackend();
    const table = new PaintTable(backend);
    expect(table.flush()).toEqual({ uploadedBytes: 0, writes: 0 });
    expect(table.texture).toBeUndefined();
    expect(table.byteLength).toBe(0);
    expect(backend.count('createTexture')).toBe(0);
  });

  it('numbers records from 1, keeping 0 for the average colour', () => {
    const table = new PaintTable(new FakeGpuBackend());
    expect(table.write(id('a'), gradient(1))).toBe(1);
    expect(table.write(id('b'), gradient(1))).toBe(2);
    expect(table.write(id('a'), gradient(0.5))).toBe(1);
    expect(table.recordOf(id('b'))).toBe(2);
  });

  it('writes the packed record, premultiplied', () => {
    const table = new PaintTable(new FakeGpuBackend());
    const record = table.write(id('a'), gradient(0.5));
    const expected = new Float32Array(GRADIENT_RECORD_FLOATS);
    packGradientRecord(gradient(0.5), expected);
    expect([...table.read(record)]).toEqual([...expected]);
    expect([...table.read(record).subarray(4, 8)]).toEqual([0.5, 0, 0, 0.5]);
  });

  it('creates an rgba32float texture 704 texels wide and uploads only dirty records', () => {
    const backend = new FakeGpuBackend();
    const table = new PaintTable(backend);
    table.write(id('a'), gradient(1));
    expect(table.flush().writes).toBe(1);
    expect(table.texture?.format).toBe('rgba32float');
    expect(table.texture?.width).toBe(704);
    expect(table.byteLength).toBe(704 * 4 * 4);
    backend.resetCalls();
    // An unchanged paint marks nothing; a changed one uploads its record alone.
    table.write(id('a'), gradient(1));
    expect(table.flush()).toEqual({ uploadedBytes: 0, writes: 0 });
    table.write(id('b'), gradient(0.25));
    expect(table.flush()).toEqual({ uploadedBytes: 176, writes: 1 });
    expect(backend.count('writeTexture')).toBe(1);
    expect(backend.count('createTexture')).toBe(0);
  });

  it('reuses a released record without uploading the release', () => {
    const table = new PaintTable(new FakeGpuBackend());
    table.write(id('a'), gradient(1));
    table.write(id('b'), gradient(1));
    table.flush();
    table.release(id('a'));
    expect(table.flush().writes).toBe(0);
    expect(table.recordCount).toBe(1);
    expect(table.write(id('c'), gradient(0.5))).toBe(1);
  });

  it('grows by doubling its rows, recreating the texture and uploading every record', () => {
    const backend = new FakeGpuBackend();
    const table = new PaintTable(backend);
    for (let index = 0; index < PAINT_TABLE_RECORDS_PER_ROW - 1; index += 1) {
      table.write(id(`o${String(index)}`), gradient(1));
    }
    table.flush();
    const first = table.texture as FakeGpuTexture | undefined;
    expect(first?.height).toBe(1);
    table.write(id('next'), gradient(0.5));
    const upload = table.flush();
    expect(table.texture?.height).toBe(2);
    expect(first?.isDestroyed).toBe(true);
    // Records 0 to 64 across two texture rows: two writes.
    expect(upload.writes).toBe(2);
    expect(upload.uploadedBytes).toBe(65 * 176);
  });

  it('frees its texture', () => {
    const table = new PaintTable(new FakeGpuBackend());
    table.write(id('a'), gradient(1));
    table.flush();
    const texture = table.texture as FakeGpuTexture | undefined;
    table.destroy();
    expect(texture?.isDestroyed).toBe(true);
    expect(table.texture).toBeUndefined();
  });
});
