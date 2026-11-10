import { describe, expect, it, vi } from 'vitest';

import type { FrameObject } from '@canvas/schema';

import { GLYPH_ATLAS_OWNER } from '../../diagnostics/glyph-atlas-memory.js';
import { MemoryLedger } from '../../diagnostics/memory-ledger.js';
import { reportSceneMemory } from '../../diagnostics/scene-memory.js';
import { shapeObject } from '../../scene/__fixtures__/scene-objects.js';
import { GlyphAtlas } from '../atlas/glyph-atlas.js';

import { CAMERA, createTextSetUp, textObject } from './__fixtures__/text-objects.js';
import { FRAME_TITLE_PASS } from './frame-title-pass.js';
import { TEXT_PASS } from './text-pass.js';

describe('text pass atlas measurements', () => {
  it('counts every lookup and miss, including a shared layout replay in the same frame', async () => {
    const lookup = vi.spyOn(GlyphAtlas.prototype, 'lookup');
    const { renderer, document, settle } = createTextSetUp();
    const frames: {
      lookups: number;
      misses: number;
      reported: Record<string, unknown>;
      calls: string[];
    }[] = [];
    let previousCalls = 0;
    renderer.frame.insertStage('after', 'submit', {
      name: 'capture-atlas-lookups',
      run: ({ stats }) => {
        const calls = lookup.mock.calls.slice(previousCalls).map((args) => JSON.stringify(args));
        const results = lookup.mock.results.slice(previousCalls);
        frames.push({
          lookups: calls.length,
          misses: results.filter(({ value }) => value === undefined).length,
          reported: { ...stats },
          calls,
        });
        previousCalls = lookup.mock.calls.length;
      },
    });
    try {
      document.create(textObject('a', 'ABC'), textObject('b', 'ABC', { x: 120 }));
      renderer.enqueue(document.takeChanges());
      await settle();
      const replayed = frames.find(
        ({ calls }) => calls.length >= 6 && new Set(calls).size < calls.length,
      );
      expect(replayed).toBeDefined();
      expect(replayed?.reported).toMatchObject({
        atlasLookups: replayed?.lookups,
        atlasMisses: replayed?.misses,
      });
      expect(replayed?.misses).toBeGreaterThan(0);
      document.delete('a');
      document.delete('b');
      renderer.enqueue(document.takeChanges());
      renderer.renderFrame({ timeMs: 1_000, camera: CAMERA });
      expect(frames.at(-1)?.reported).toMatchObject({ atlasLookups: 0, atlasMisses: 0 });
    } finally {
      lookup.mockRestore();
      renderer.destroy();
    }
  });

  it('reports scene text and frame title atlas bytes under separate owners', async () => {
    const { renderer, document, settle } = createTextSetUp(CAMERA, true, false, {
      passes: [TEXT_PASS, FRAME_TITLE_PASS],
    });
    const frame = {
      ...shapeObject('f'),
      type: 'frame',
      y: 80,
      width: 200,
      height: 100,
      name: 'Title',
      clip: false,
      background: null,
    } as unknown as FrameObject;
    document.create(frame, textObject('t', 'Body'));
    renderer.enqueue(document.takeChanges());
    await settle();
    const ledger = new MemoryLedger();
    renderer.frame.insertStage('after', 'submit', {
      name: 'capture-atlas-memory',
      run: (context) => {
        reportSceneMemory(context, ledger);
      },
    });
    renderer.renderFrame({ timeMs: 1_000, camera: CAMERA });
    const owners = ledger.ownersOf('atlases');
    expect(owners.get(GLYPH_ATLAS_OWNER)).toBeGreaterThan(0);
    expect(owners.get('frame-title-atlas')).toBeGreaterThan(0);
    expect(ledger.bytesOf('atlases')).toBe(
      (owners.get(GLYPH_ATLAS_OWNER) ?? 0) + (owners.get('frame-title-atlas') ?? 0),
    );
    renderer.renderFrame({ timeMs: 1_016, camera: CAMERA });
    expect(ledger.ownersOf('atlases').size).toBe(2);
    renderer.destroy();
  });
});
