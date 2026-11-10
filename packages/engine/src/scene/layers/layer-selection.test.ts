import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { Camera } from '../../camera/camera.js';

import { layerScratchBytes, layerTargetBytes } from './layer-budget.js';
import { LayerSelection, type LayerCandidate } from './layer-selection.js';

/**
 * The scratch at the default (worst) rate for a square extent.
 *
 * @param edge - The extent's edge, device pixels.
 * @returns The bytes.
 */
const scratchAt = (edge: number) => layerScratchBytes({ width: edge, height: edge });

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };
const PLENTY = 1024 * 1024 * 1024;

function square(id: string, size: number, depth = 0, x = 0): LayerCandidate {
  return {
    id: id as ObjectId,
    depth,
    bounds: { minX: x, minY: 0, maxX: x + size, maxY: size },
  };
}

function fallbacksOf(selection: LayerSelection, candidates: LayerCandidate[], zoom = 1) {
  return [...selection.select(candidates, { ...CAMERA, zoom }).fallbacks].sort();
}

describe('LayerSelection', () => {
  it('takes a new layer’s form at 64 px, then holds it through the band on both sides', () => {
    const selection = new LayerSelection({ byteBudget: PLENTY, tile: 1024 });
    expect(fallbacksOf(selection, [square('a', 63), square('b', 64)])).toEqual(['a']);
    // Small stays small until 80 px; composited stays composited down to 51.2 px.
    expect(fallbacksOf(selection, [square('a', 79), square('b', 52)])).toEqual(['a']);
    expect(fallbacksOf(selection, [square('a', 80), square('b', 51)])).toEqual(['b']);
    const choice = selection.select([square('a', 70), square('b', 70)], CAMERA);
    expect(choice).toMatchObject({ small: 1, limit: 0, budget: 0 });
    expect([...choice.fallbacks]).toEqual(['b']);
  });

  it('measures on screen: zoom and device pixel ratio scale the edge', () => {
    const selection = new LayerSelection({ byteBudget: PLENTY, tile: 1024 });
    expect(fallbacksOf(selection, [square('a', 40)], 2)).toEqual([]);
    expect([...selection.select([square('b', 40)], { ...CAMERA, dpr: 2 }).fallbacks]).toEqual([]);
  });

  it('forgets the band of a layer that is gone, and reports it leaving the fallbacks', () => {
    const selection = new LayerSelection({ byteBudget: PLENTY, tile: 1024 });
    expect(fallbacksOf(selection, [square('a', 50), square('b', 100)])).toEqual(['a']);
    const without = selection.select([square('b', 100)], CAMERA);
    expect(without).toMatchObject({ added: [], removed: ['a'], isExcludedChanged: true });
    expect(fallbacksOf(selection, [square('a', 70), square('b', 100)])).toEqual([]);
    expect(fallbacksOf(selection, [square('a', 52), square('b', 100)])).toEqual([]);
  });

  it('keeps forms by index while the layout holds, and reports only what changed', () => {
    const selection = new LayerSelection({ byteBudget: PLENTY, tile: 1024 });
    const layout = {};
    const first = selection.select([square('a', 50), square('b', 100)], CAMERA, layout);
    expect(first).toMatchObject({ added: ['a'], removed: [], isExcludedChanged: true });
    const same = selection.select([square('a', 50), square('b', 100)], CAMERA, layout);
    expect(same).toMatchObject({ added: [], removed: [], isExcludedChanged: false, small: 1 });
    const grown = selection.select([square('a', 90), square('b', 100)], CAMERA, layout);
    expect(grown).toMatchObject({ added: [], removed: ['a'], isExcludedChanged: true });
    expect(grown.fallbacks.size).toBe(0);
    // The same candidates, camera and holdings: the same choice, with nothing to change.
    const candidates = [square('a', 90), square('b', 100)];
    selection.select(candidates, CAMERA, layout);
    expect(selection.select(candidates, CAMERA, layout)).toMatchObject({ added: [], removed: [] });
  });

  it('forgets everything on a reset, naming the layers it drew in the multiply form', () => {
    const selection = new LayerSelection({ byteBudget: PLENTY, tile: 1024 });
    selection.select([square('a', 50)], CAMERA);
    expect(selection.reset()).toEqual(['a']);
    expect(selection.select([square('a', 70)], CAMERA).fallbacks.size).toBe(0);
  });

  it('leaves out a layer off the canvas, counting it nowhere', () => {
    const selection = new LayerSelection({ byteBudget: PLENTY, tile: 1024, limit: 1 });
    const choice = selection.select([square('far', 100, 0, 5000), square('near', 100)], CAMERA);
    expect(choice).toMatchObject({ small: 0, limit: 0, budget: 0 });
    expect(choice.fallbacks.size).toBe(0);
  });

  it('keeps the outermost, then the larger, then the lower id under the limit', () => {
    const selection = new LayerSelection({ byteBudget: PLENTY, tile: 1024, limit: 3 });
    const choice = selection.select(
      [
        square('inner-big', 300, 1),
        square('c', 100),
        square('b', 100),
        square('a', 120),
        square('d', 90),
      ],
      CAMERA,
    );
    expect([...choice.fallbacks].sort()).toEqual(['d', 'inner-big']);
    expect(choice).toMatchObject({ small: 0, limit: 2, budget: 0 });
  });

  it('keeps a layer’s last form while it is off the canvas, counting it nowhere', () => {
    const big = layerTargetBytes({ x: 0, y: 0, width: 402, height: 402 }, 1024);
    const byteBudget = scratchAt(448) + big / 2;
    const selection = new LayerSelection({ byteBudget, tile: 1024 });
    const first = selection.select([square('big', 400), square('small', 70)], CAMERA);
    expect([...first.inline]).toEqual(['big']);
    const away = selection.select([square('big', 400), square('small', 70)], {
      ...CAMERA,
      x: 5000,
    });
    expect([...away.fallbacks]).toEqual(['big']);
    expect([...away.inline]).toEqual(['big']);
    expect(away).toMatchObject({ small: 0, limit: 0, budget: 0 });
    const gone = selection.select([square('small', 70)], { ...CAMERA, x: 5000 });
    expect(gone.fallbacks.size).toBe(0);
  });

  it('composites a layer that fell back for the budget again only within the band', () => {
    const atOne = layerTargetBytes({ x: 0, y: 0, width: 202, height: 202 }, 1024);
    const byteBudget = scratchAt(256) + atOne * 1.1;
    const selection = new LayerSelection({ byteBudget, tile: 1024 });
    expect([...selection.select([square('a', 200)], { ...CAMERA, zoom: 1.5 }).inline]).toEqual([
      'a',
    ]);
    // It fits the budget at 1×, but not with a fifth of the targets' share to spare.
    expect([...selection.select([square('a', 200)], CAMERA).inline]).toEqual(['a']);
    const fresh = new LayerSelection({ byteBudget, tile: 1024 });
    expect(fresh.select([square('a', 200)], CAMERA).fallbacks.size).toBe(0);
    selection.retain(() => false);
    expect(selection.select([square('a', 200)], CAMERA).fallbacks.size).toBe(0);
  });

  it('costs a layer what its targets hold when that is more than it needs', () => {
    const big = layerTargetBytes({ x: 0, y: 0, width: 402, height: 402 }, 1024);
    const byteBudget = scratchAt(128) + big;
    const held = new Map([['a', big + 1]]);
    const selection = new LayerSelection({ byteBudget, tile: 1024, heldBytes: () => held });
    expect([...selection.select([square('a', 100)], CAMERA).inline]).toEqual(['a']);
  });

  it('falls back a layer that would pass the budget, and still takes a smaller one after it', () => {
    const big = layerTargetBytes({ x: 0, y: 0, width: 402, height: 402 }, 1024);
    const small = layerTargetBytes({ x: 0, y: 0, width: 102, height: 102 }, 1024);
    const byteBudget = scratchAt(448) + small + big / 2;
    const selection = new LayerSelection({ byteBudget, tile: 1024 });
    const choice = selection.select([square('big', 400), square('small', 100, 0, 500)], CAMERA);
    expect([...choice.fallbacks]).toEqual(['big']);
    expect([...choice.inline]).toEqual(['big']);
    expect(choice).toMatchObject({ small: 0, limit: 0, budget: 1 });
  });

  it('charges the scratch at the chosen targets’ extent, not a whole tile', () => {
    const big = layerTargetBytes({ x: 0, y: 0, width: 402, height: 402 }, 1024);
    // Both fit with the scratch at their 448 px extent; with a whole tile's, neither would.
    const byteBudget = 2 * big + scratchAt(448) + 1;
    expect(byteBudget).toBeLessThan(scratchAt(1024));
    const selection = new LayerSelection({ byteBudget, tile: 1024 });
    const choice = selection.select([square('a', 400), square('b', 400, 0, 500)], CAMERA);
    expect(choice.fallbacks.size).toBe(0);
    // At the backend's own rate, which a smaller budget then holds.
    const webgpu = new LayerSelection({
      byteBudget: 2 * big + layerScratchBytes({ width: 448, height: 448 }, 24) + 1,
      tile: 1024,
      scratchBytesPerTexel: 24,
    });
    expect(webgpu.select([square('a', 400), square('b', 400, 0, 500)], CAMERA).fallbacks.size).toBe(
      0,
    );
  });

  it('grows the scratch for a larger target a layer keeps', () => {
    const small = layerTargetBytes({ x: 0, y: 0, width: 102, height: 102 }, 1024);
    const byteBudget = small + scratchAt(128) + 1000;
    const kept = new Map([['a', { width: 1024, height: 1024 }]]);
    const plain = new LayerSelection({ byteBudget, tile: 1024 });
    expect(plain.select([square('a', 100)], CAMERA).fallbacks.size).toBe(0);
    const keeping = new LayerSelection({ byteBudget, tile: 1024, heldExtent: () => kept });
    expect([...keeping.select([square('a', 100)], CAMERA).inline]).toEqual(['a']);
  });

  it('keeps an incumbent’s slot just off the canvas, and frees it a canvas away', () => {
    const selection = new LayerSelection({ byteBudget: PLENTY, tile: 1024, limit: 1 });
    const layers = [square('a', 100), square('b', 100, 0, 900)];
    expect(selection.select(layers, CAMERA).fallbacks.size).toBe(0);
    // 'a' is just left of the canvas, within a canvas's reach: it keeps the one slot.
    const near = selection.select(layers, { ...CAMERA, x: 850 });
    expect([...near.fallbacks]).toEqual(['b']);
    expect(near).toMatchObject({ small: 0, limit: 1, budget: 0 });
    // More than a canvas away, 'a' lets the slot go and 'b' takes it.
    expect(selection.select(layers, { ...CAMERA, x: 1000 }).fallbacks.size).toBe(0);
  });

  it('keeps the limit’s layers through a slow pan: no swap while nothing leaves the canvas', () => {
    // 24 layers 70 units wide every 80 units, the right ones first by id, so each one entering
    // on the right would outrank every incumbent if the order alone decided.
    const layers = Array.from({ length: 24 }, (unused, index) =>
      square(`l${String(23 - index).padStart(2, '0')}`, 70, 0, index * 80),
    );
    // About ten on the canvas at a time, six slots.
    const selection = new LayerSelection({ byteBudget: PLENTY, tile: 1024, limit: 6 });
    selection.select(layers, CAMERA);
    let changes = 0;
    // A slow pan to the right and back, four units a frame, a layer's width each way, 30 times:
    // layers cross the canvas's right edge again and again.
    for (let frame = 0; frame < 1200; frame += 1) {
      const step = frame % 40;
      const x = 4 * (step < 20 ? step : 40 - step);
      const choice = selection.select(layers, { ...CAMERA, x });
      changes += choice.added.length + choice.removed.length;
    }
    expect(changes).toBeLessThanOrEqual(4);
  });
});
