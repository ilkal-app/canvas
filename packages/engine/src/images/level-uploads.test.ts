import { describe, expect, it } from 'vitest';

import type { AssetId } from '@canvas/schema';

import { MemoryLedger } from '../diagnostics/memory-ledger.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';
import type { DecodedLevel } from '../workers/job-kinds.js';

import type { AssetCatalogue } from './asset-catalogue.js';
import type { Want } from './image-needs.js';
import { LevelUploads } from './level-uploads.js';
import { TextureResidency } from './texture-residency.js';

const MIB = 1024 * 1024;

/**
 * A blank square level.
 *
 * @param edgePx - Its edge, px.
 * @returns The level.
 */
function level(edgePx: number): DecodedLevel {
  return { widthPx: edgePx, heightPx: edgePx, rgba: new Uint8Array(edgePx * edgePx * 4) };
}

/**
 * Uploads over a residency of a budget, with a catalogue that has no levels of its own.
 *
 * @param budgetBytes - The residency's budget.
 * @returns The uploads, the residency and the keys reported uploaded.
 */
function uploadsOf(budgetBytes: number) {
  const residency = new TextureResidency(
    new FakeGpuBackend(),
    new MemoryLedger(),
    budgetBytes,
    () => undefined,
  );
  const catalogue = {
    peek: () => undefined,
    smallestOf: () => undefined,
  } as unknown as AssetCatalogue;
  const uploaded: string[] = [];
  const pressure: number[] = [];
  const uploads = new LevelUploads(residency, catalogue, budgetBytes, 16 * MIB, {
    onUploaded: (key) => uploaded.push(key),
    onAllocationFailed: () => undefined,
    onPressure: () => pressure.push(1),
  });
  return { uploads, residency, uploaded, pressure };
}

/**
 * The frame's wants: each key needed, at visible priority.
 *
 * @param keys - The keys.
 * @returns The wants.
 */
function wantsOf(keys: readonly string[]): Map<string, Want> {
  const source = { kind: 'server', assetId: 'a' as AssetId, longEdgePx: 512 } as const;
  return new Map(keys.map((key) => [key, { key, source, priority: 'visible', isNeeded: true }]));
}

describe('LevelUploads', () => {
  it('drops a newer version refused for the budget: the resident one keeps serving', () => {
    const { uploads, residency, uploaded } = uploadsOf(1.5 * MIB);
    residency.upload('a|L512', level(512), 0, () => false);
    const before = residency.get('a|L512');
    uploads.add('a|L512', level(1024));

    uploads.upload(wantsOf(['a|L512']), 1, () => true);

    expect(uploads.size).toBe(0);
    expect(uploaded).toEqual([]);
    expect(residency.get('a|L512')).toBe(before);
  });

  it('keeps a new level refused for the budget queued, to try again', () => {
    const { uploads, residency } = uploadsOf(1.5 * MIB);
    residency.upload('a|L512', level(512), 0, () => false);
    uploads.add('b|L1024', level(1024));

    uploads.upload(wantsOf(['b|L1024']), 1, () => true);

    expect(uploads.size).toBe(1);
  });

  it('holds bytes back for animation frames, evicting idle levels but never needed ones', () => {
    const { uploads, residency } = uploadsOf(4 * MIB);
    residency.upload('a|L512', level(512), 0, () => false);
    const isNeeded = (key: string): boolean => key === 'a|L512';

    expect(uploads.reserve(4 * MIB, isNeeded)).toBe(false);
    expect(residency.budgetBytes).toBe(4 * MIB);
    expect(residency.get('a|L512')).toBeDefined();
    expect(uploads.reserve(2 * MIB, isNeeded)).toBe(true);
    expect(residency.budgetBytes).toBe(2 * MIB);
    expect(uploads.reserve(MIB, isNeeded)).toBe(true);
    expect(uploads.reserve(MIB, isNeeded)).toBe(false);

    // Idle, the level makes room for the rest.
    expect(uploads.reserve(MIB, () => false)).toBe(true);
    expect(residency.get('a|L512')).toBeUndefined();
    uploads.release(4 * MIB);
    expect(residency.budgetBytes).toBe(4 * MIB);
  });

  it('tells of pressure when a needed level does not fit while bytes are held back', () => {
    const { uploads, residency, pressure } = uploadsOf(2 * MIB);
    uploads.add('big|L1024', level(1024));
    uploads.upload(wantsOf(['big|L1024']), 0, () => true);
    expect(pressure).toEqual([]);

    uploads.add('b|L512', level(512));
    uploads.upload(wantsOf(['b|L512']), 1, () => true);
    expect(residency.get('b|L512')).toBeDefined();
    expect(uploads.reserve(0.75 * MIB, () => true)).toBe(true);
    uploads.add('c|L512', level(512));
    uploads.upload(wantsOf(['b|L512', 'c|L512']), 2, () => true);
    expect(pressure).toEqual([1]);
  });

  it('frees whole atlas pages of idle small levels to hold bytes back', () => {
    const { uploads, residency } = uploadsOf(20 * MIB);
    residency.upload('s|L128', level(128), 0, () => false);
    expect(residency.residentBytes).toBe(16 * MIB);

    expect(uploads.reserve(8 * MIB, () => true)).toBe(false);
    expect(residency.get('s|L128')).toBeDefined();
    expect(uploads.reserve(8 * MIB, () => false)).toBe(true);
    expect(residency.get('s|L128')).toBeUndefined();
    expect(residency.residentBytes).toBe(0);
  });

  it('evicts idle levels larger first, stopping once the held-back bytes fit', () => {
    const { uploads, residency } = uploadsOf(20 * MIB);
    residency.upload('big|L512', level(512), 0, () => false);
    residency.upload('small|L128', level(128), 0, () => false);
    residency.upload(
      'tiny|L300',
      { widthPx: 300, heightPx: 1, rgba: new Uint8Array(1200) },
      0,
      () => false,
    );

    expect(uploads.reserve(5 * MIB, () => false)).toBe(true);
    expect(residency.keys()).toEqual(['tiny|L300']);
  });
});
