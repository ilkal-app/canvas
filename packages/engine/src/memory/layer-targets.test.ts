import { describe, expect, it } from 'vitest';

import { MemoryLedger } from '../diagnostics/memory-ledger.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';

import { LayerTargets } from './layer-targets.js';

describe('LayerTargets', () => {
  it('charges each live target’s resolved colour to layers, and frees it on release', () => {
    const backend = new FakeGpuBackend();
    const ledger = new MemoryLedger();
    const layers = new LayerTargets(backend, ledger);
    const group = layers.acquire('group-1', { width: 32, height: 16 });
    layers.acquire('frame-2', { width: 10, height: 10 });
    expect(ledger.bytesOf('layers')).toBe(32 * 16 * 4 + 10 * 10 * 4);
    expect(layers.size).toBe(2);
    layers.release('group-1');
    expect(backend.liveTextures()).not.toContain(group.texture);
    expect(ledger.bytesOf('layers')).toBe(400);
    layers.release('group-1');
    expect(ledger.bytesOf('layers')).toBe(400);
  });

  it('keeps a target while its size holds, and replaces it when the size changes', () => {
    const backend = new FakeGpuBackend();
    const ledger = new MemoryLedger();
    const layers = new LayerTargets(backend, ledger);
    const first = layers.acquire('group-1', { width: 32, height: 16 });
    expect(layers.acquire('group-1', { width: 32, height: 16 })).toBe(first);
    const wider = layers.acquire('group-1', { width: 64, height: 16 });
    expect(wider).not.toBe(first);
    expect(backend.liveTextures()).not.toContain(first.texture);
    expect(ledger.bytesOf('layers')).toBe(64 * 16 * 4);
    expect(layers.acquire('group-1', { width: 64, height: 8 })).not.toBe(wider);
  });

  it('keeps the old target when a new size is out of range', () => {
    const backend = new FakeGpuBackend({ maxTextureSize: 64 });
    const ledger = new MemoryLedger();
    const layers = new LayerTargets(backend, ledger);
    const first = layers.acquire('group-1', { width: 32, height: 16 });
    expect(() => layers.acquire('group-1', { width: 65, height: 16 })).toThrow(RangeError);
    expect(layers.acquire('group-1', { width: 32, height: 16 })).toBe(first);
    expect(ledger.bytesOf('layers')).toBe(2048);
  });

  it('releases every target at once', () => {
    const backend = new FakeGpuBackend();
    const ledger = new MemoryLedger();
    const layers = new LayerTargets(backend, ledger);
    layers.acquire('a', { width: 8, height: 8 });
    layers.acquire('b', { width: 8, height: 8 });
    layers.releaseAll();
    expect(layers.size).toBe(0);
    expect(ledger.bytesOf('layers')).toBe(0);
    expect(backend.targets.every((target) => target.isDestroyed)).toBe(true);
  });
});
