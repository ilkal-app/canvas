import { describe, expect, it } from 'vitest';

import { MEMORY_CATEGORIES, MemoryLedger, type MemoryCategory } from './memory-ledger.js';

describe('MemoryLedger', () => {
  it('lists the GPU memory categories, then layers, in a fixed order', () => {
    expect(MEMORY_CATEGORIES).toEqual([
      'instanceBuffers',
      'atlases',
      'textures',
      'meshes',
      'uniforms',
      'layers',
    ]);
  });

  it('starts with zero bytes in every category', () => {
    const ledger = new MemoryLedger();
    for (const category of MEMORY_CATEGORIES) expect(ledger.bytesOf(category)).toBe(0);
    expect(ledger.totalBytes).toBe(0);
  });

  it('sums every owner of a category', () => {
    const ledger = new MemoryLedger();
    ledger.set('instanceBuffers', 'solidRect', 4096);
    ledger.set('instanceBuffers', 'shapes', 1024);
    ledger.set('uniforms', 'camera', 16);
    expect(ledger.bytesOf('instanceBuffers')).toBe(5120);
    expect(ledger.bytesOf('uniforms')).toBe(16);
    expect(ledger.totalBytes).toBe(5136);
  });

  it('replaces an owner report rather than adding to it, as a buffer grows or shrinks', () => {
    const ledger = new MemoryLedger();
    ledger.set('atlases', 'page 0', 4_194_304);
    ledger.set('atlases', 'page 0', 16_777_216);
    expect(ledger.bytesOf('atlases')).toBe(16_777_216);
    ledger.set('atlases', 'page 0', 0);
    expect(ledger.bytesOf('atlases')).toBe(0);
  });

  it('keeps the same owner name apart in different categories', () => {
    const ledger = new MemoryLedger();
    ledger.set('textures', 'image-1', 100);
    ledger.set('meshes', 'image-1', 20);
    expect(ledger.bytesOf('textures')).toBe(100);
    expect(ledger.bytesOf('meshes')).toBe(20);
  });

  it('forgets a freed owner, and deleting an unknown owner changes nothing', () => {
    const ledger = new MemoryLedger();
    ledger.set('meshes', 'path-1', 64);
    ledger.set('meshes', 'path-2', 32);
    expect(ledger.delete('meshes', 'path-1')).toBe(true);
    expect(ledger.delete('meshes', 'path-1')).toBe(false);
    expect(ledger.bytesOf('meshes')).toBe(32);
    expect([...ledger.ownersOf('meshes')]).toEqual([['path-2', 32]]);
  });

  it('copies the category totals, in category order, into a caller-owned array', () => {
    const ledger = new MemoryLedger();
    ledger.set('textures', 'image', 300);
    ledger.set('uniforms', 'camera', 16);
    const target = [9, 9, 9, 9, 9, 9];
    ledger.copyTotalsInto(target);
    expect(target).toEqual([0, 0, 300, 0, 16, 0]);
  });

  it('rejects a byte count that is negative, fractional or not finite', () => {
    const ledger = new MemoryLedger();
    for (const bytes of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => {
        ledger.set('textures', 'image', bytes);
      }).toThrow(RangeError);
    }
    expect(ledger.totalBytes).toBe(0);
  });

  it('rejects a category it does not know, from an untyped caller', () => {
    const ledger = new MemoryLedger();
    const unknown = 'video' as MemoryCategory;
    expect(() => {
      ledger.set(unknown, 'clip', 1);
    }).toThrow(RangeError);
    expect(() => ledger.bytesOf(unknown)).toThrow(RangeError);
  });
});
