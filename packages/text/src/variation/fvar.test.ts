import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

interface VariationReader {
  readVariationAxes: (bytes: Uint8Array) => unknown;
}

const { readVariationAxes } = await vi.importActual<VariationReader>('./fvar.js');

const CORPUS = new URL('../__fixtures__/format-corpus/', import.meta.url);
const variableBytes = new Uint8Array(readFileSync(new URL('corpus-sans-variable.ttf', CORPUS)));
const reference = JSON.parse(
  readFileSync(new URL('corpus-sans-variable.reference.json', CORPUS), 'utf8'),
) as {
  axes: { tag: string; minimum: number; default: number; maximum: number; name: string }[];
  instances: { name: string; coordinates: Record<string, number> }[];
};

/**
 * Returns the byte offset of the fvar directory entry and table.
 *
 * @param bytes - The font bytes.
 * @returns The entry and table offsets.
 * @throws {Error} When the checked-in fixture has no fvar table.
 */
function fvarLocation(bytes: Uint8Array): { entry: number; table: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4);
  for (let index = 0; index < count; index += 1) {
    const entry = 12 + 16 * index;
    const tag = String.fromCharCode(...bytes.subarray(entry, entry + 4));
    if (tag === 'fvar') return { entry, table: view.getUint32(entry + 8) };
  }
  throw new Error('The variable corpus has no fvar table');
}

/**
 * Changes one fvar field without changing the checked-in fixture.
 *
 * @param offset - The field offset in the fvar table.
 * @param value - The replacement value.
 * @param width - The field width in bits.
 * @returns A changed copy of the fixture.
 */
function damagedFvar(offset: number, value: number, width: 16 | 32 = 16): Uint8Array {
  const bytes = variableBytes.slice();
  const location = fvarLocation(bytes);
  const view = new DataView(bytes.buffer);
  if (width === 16) view.setUint16(location.table + offset, value);
  else view.setUint32(location.table + offset, value);
  return bytes;
}

describe('fvar reader', () => {
  it('reads the corpus axes and named instances exactly as fontTools does', () => {
    expect(readVariationAxes(variableBytes)).toEqual({
      axes: reference.axes.map((axis) => ({ ...axis, isHidden: false })),
      instances: reference.instances,
    });
  });

  it('returns undefined for a static TrueType face', () => {
    const bytes = new Uint8Array(readFileSync(new URL('corpus-sans-regular.ttf', CORPUS)));
    expect(readVariationAxes(bytes)).toBeUndefined();
  });

  it('refuses a short fvar table without reading beyond its declared length', () => {
    const bytes = variableBytes.slice();
    const { entry } = fvarLocation(bytes);
    new DataView(bytes.buffer).setUint32(entry + 12, 15);
    expect(readVariationAxes(bytes)).toBeUndefined();
  });

  it('refuses an axis count that runs beyond the fvar table', () => {
    expect(readVariationAxes(damagedFvar(8, 0xffff))).toBeUndefined();
  });

  it('refuses an instance record smaller than its axis coordinates', () => {
    expect(readVariationAxes(damagedFvar(14, 3))).toBeUndefined();
  });

  it('refuses an axes array that starts inside the fvar header', () => {
    expect(readVariationAxes(damagedFvar(4, 8))).toBeUndefined();
  });

  it('refuses an unknown fvar version', () => {
    expect(readVariationAxes(damagedFvar(0, 0x00020000, 32))).toBeUndefined();
  });

  it('never throws for seeded random damage within fvar', () => {
    const { table, entry } = fvarLocation(variableBytes);
    const tableLength = new DataView(variableBytes.buffer).getUint32(entry + 12);
    let seed = 0x51219;
    for (let sample = 0; sample < 256; sample += 1) {
      const bytes = variableBytes.slice();
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const offset = (seed >>> 0) % tableLength;
      bytes[table + offset] = (bytes[table + offset] ?? 0) ^ ((seed >>> 8) & 0xff);
      expect(() => readVariationAxes(bytes), `damage sample ${String(sample)}`).not.toThrow();
    }
  });
});
