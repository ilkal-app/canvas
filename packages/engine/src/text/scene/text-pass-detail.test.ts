// The text pass's level of detail through a real SceneRenderer: greek bars under 4
// device pixels a line, left out under 2.5, each with a 20% band, and tier checks only for the
// text a frame draws.
import { describe, expect, it, vi } from 'vitest';

import { CAMERA, createTextSetUp, textObject } from './__fixtures__/text-objects.js';
import { GREEK_ALPHA } from './greek-quads.js';
import { TEXT_PASS_NAME } from './text-pass.js';

/**
 * Whether a record is a greek bar: its page rectangle is the flat sentinel.
 *
 * @param record - A text record.
 * @returns True for a bar.
 */
const isBar = (record: Float32Array): boolean => (record[8] ?? 0) < 0;

// STYLE is 20 units: 25-unit lines, 4 device px at a scale of 0.16 and 2.5 px at 0.1.
const GREEK = { ...CAMERA, zoom: 0.15 };
const HIDDEN = { ...CAMERA, zoom: 0.09 };

describe('the text pass at a far zoom', () => {
  it('draws text under 4 device px a line as bars at 30% of its colour, with no glyphs', async () => {
    const { renderer, document, settle, records, pool } = createTextSetUp(GREEK);
    const submit = vi.spyOn(pool, 'submit');
    document.create(textObject('t', 'ab c'));
    renderer.enqueue(document.takeChanges());
    await settle();
    const drawn = records();
    expect(drawn).toHaveLength(3);
    expect(drawn.every(isBar)).toBe(true);
    for (const record of drawn) expect(record[15]).toBeCloseTo(GREEK_ALPHA, 6);
    expect(submit.mock.calls.map(([kind]) => kind)).toEqual(['layout']);
  });

  it('returns to glyphs only once the lines are 20% past 4 device px', async () => {
    const { renderer, document, settle, records } = createTextSetUp(GREEK);
    document.create(textObject('t', 'ab'));
    renderer.enqueue(document.takeChanges());
    await settle();
    // 4.5 px: over the threshold, inside its band.
    await settle(12, { ...CAMERA, zoom: 0.18 });
    expect(records().every(isBar)).toBe(true);
    await settle(12, { ...CAMERA, zoom: 0.2 });
    expect(records().some(isBar)).toBe(false);
    // Down again: bars as soon as the lines are under 4 px.
    await settle(12, { ...CAMERA, zoom: 0.17 });
    expect(records().some(isBar)).toBe(false);
    await settle(12, { ...CAMERA, zoom: 0.155 });
    expect(records().every(isBar)).toBe(true);
    const history = renderer.scene.levelOfDetail.historyOf(TEXT_PASS_NAME, 't' as never);
    // Two changes across 4 px, each after the lines traversed its whole band (under 4 px, then
    // at or above 4.8, then under 4 again).
    expect(history.transitions).toBe(2);
    expect(history.bands[0]).toMatchObject({ transitions: 2, traversals: 2 });
  });

  it('leaves text under 2.5 device px a line out of z-ordered frames', async () => {
    const { renderer, document, settle, backend } = createTextSetUp(HIDDEN, true, true);
    document.create(textObject('t', 'ab'));
    renderer.enqueue(document.takeChanges());
    await settle();
    backend.resetCalls();
    renderer.renderFrame({ timeMs: 9_000, camera: HIDDEN });
    expect(backend.draws()).toHaveLength(0);
    // 2.75 px: inside the hidden form's band, still left out; 3 px: shown, as bars.
    renderer.renderFrame({ timeMs: 9_016, camera: { ...CAMERA, zoom: 0.11 } });
    backend.resetCalls();
    renderer.renderFrame({ timeMs: 9_032, camera: { ...CAMERA, zoom: 0.11 } });
    expect(backend.draws()).toHaveLength(0);
    backend.resetCalls();
    renderer.renderFrame({ timeMs: 9_048, camera: { ...CAMERA, zoom: 0.12 } });
    expect(backend.draws()).toHaveLength(1);
  });

  it('checks the tier of off-screen text only once it comes into view', async () => {
    const { renderer, document, settle, records } = createTextSetUp();
    document.create(textObject('near', 'Near'), textObject('far', 'Far', { x: 5_000 }));
    renderer.enqueue(document.takeChanges());
    await settle();
    const farBefore = records()
      .slice(4)
      .map((record) => [...record.slice(8, 12)]);
    // Zoom far into the near text, across the 128 px per em tier edge, the far one off screen.
    const zoomed = { ...CAMERA, zoom: 8 };
    await settle(12, zoomed);
    const rewrite = vi.spyOn(renderer.scene, 'rewriteRecords');
    await settle(12, { ...zoomed, x: 5_000 });
    const rewritten = rewrite.mock.calls.flatMap(([, targets]) =>
      [...targets].map(({ object }) => object.id),
    );
    expect(rewritten).toContain('far');
    expect(
      records()
        .slice(4)
        .map((record) => [...record.slice(8, 12)]),
    ).not.toEqual(farBefore);
  });

  it('spreads a threshold crossing’s rewrites over frames, the rest drawn as before', async () => {
    const { renderer, document, settle, frameRequests, records } = createTextSetUp(
      GREEK,
      true,
      false,
      {},
      { detailRewritesPerFrame: 2 },
    );
    const ids = ['a', 'b', 'c', 'd', 'e'];
    document.create(...ids.map((id, index) => textObject(id, 'ab', { x: index * 300 })));
    renderer.enqueue(document.takeChanges());
    await settle();
    const rewrite = vi.spyOn(renderer.scene, 'rewriteRecords');
    const full = { ...CAMERA, zoom: 0.2 };
    const rewrittenPerFrame: string[][] = [];
    const barsPerFrame: number[] = [records().filter(isBar).length];
    for (let frame = 0; frame < 3; frame += 1) {
      rewrite.mockClear();
      frameRequests.count = 0;
      renderer.renderFrame({ timeMs: 10_000 + frame * 16, camera: full });
      rewrittenPerFrame.push(
        rewrite.mock.calls.flatMap(([, targets]) => [...targets].map(({ object }) => object.id)),
      );
      barsPerFrame.push(records().filter(isBar).length);
      // While any text waits for its rewrite, the pass asks for another frame.
      if (frame < 2) expect(frameRequests.count).toBeGreaterThan(0);
    }
    expect(rewrittenPerFrame.map((frame) => frame.length)).toEqual([2, 2, 1]);
    // The texts not yet rewritten still draw their bars, and the bars go text by text: 5 texts of
    // 2 bars each, then 3, then 1, then none.
    expect(barsPerFrame).toEqual([10, 6, 2, 0]);
    expect(new Set(rewrittenPerFrame.flat())).toEqual(new Set(ids));
  });

  it('drops a waiting rewrite whose text goes back to the form it is drawn in', async () => {
    const { renderer, document, settle, records } = createTextSetUp(
      GREEK,
      true,
      false,
      {},
      { detailRewritesPerFrame: 2 },
    );
    const ids = ['a', 'b', 'c', 'd', 'e'];
    document.create(...ids.map((id, index) => textObject(id, 'ab', { x: index * 300 })));
    renderer.enqueue(document.takeChanges());
    await settle();
    // The pass reuses its targets array: copy the ids at each call.
    const rewritten: string[] = [];
    const original = renderer.scene.rewriteRecords.bind(renderer.scene);
    vi.spyOn(renderer.scene, 'rewriteRecords').mockImplementation((name, targets) => {
      rewritten.push(...[...targets].map(({ object }) => object.id));
      return original(name, targets);
    });
    // Over the threshold for one frame: two of the five are rewritten to glyphs.
    await settle(1, { ...CAMERA, zoom: 0.2 });
    expect(rewritten).toEqual(['a', 'b']);
    rewritten.length = 0;
    // Back under 4 px: only those two are rewritten, to bars; the others never were.
    await settle(12, GREEK);
    expect(rewritten).toEqual(['a', 'b']);
    expect(records().every(isBar)).toBe(true);
  });

  it('refuses a rewrite budget that would never drain the queue', () => {
    for (const budget of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        createTextSetUp(GREEK, true, false, {}, { detailRewritesPerFrame: budget }),
      ).toThrow(RangeError);
    }
    expect(() =>
      createTextSetUp(GREEK, true, false, {}, { detailRewritesPerFrame: Infinity }),
    ).not.toThrow();
  });
});
