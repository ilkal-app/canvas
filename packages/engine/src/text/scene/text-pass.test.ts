import { describe, expect, it, vi } from 'vitest';

import { MemoryLedger } from '../../diagnostics/memory-ledger.js';
import { reportSceneMemory } from '../../diagnostics/scene-memory.js';
import { FakeGpuBackend } from '../../scene/__fixtures__/fake-gpu-backend.js';
import { FakeSceneDocument, shapeObject } from '../../scene/__fixtures__/scene-objects.js';
import type { DrawListEntry } from '../../scene/draw-list.js';
import { SceneRenderer } from '../../scene/scene-renderer.js';

import {
  addBundledFaces,
  CAMERA,
  createTextSetUp,
  STYLE,
  textObject,
} from './__fixtures__/text-objects.js';
import { shapeLabelBox } from './shape-label-box.js';
import { TEXT_PASS, TEXT_PASS_NAME, textRecordCount } from './text-pass.js';

/**
 * Whether a record draws: its glyph rectangle has a size.
 *
 * @param record - The record.
 * @returns Whether it draws.
 */
function isDrawn(record: Float32Array): boolean {
  return (record[6] ?? 0) > 0 && (record[7] ?? 0) > 0;
}

describe('textRecordCount', () => {
  it('counts the characters that draw: not spaces, not newlines, a surrogate pair once', () => {
    expect(textRecordCount(textObject('t', 'ab c\nd😀'))).toBe(5);
    expect(textRecordCount(textObject('t', ''))).toBe(0);
    expect(textRecordCount(shapeObject('s'))).toBe(0);
  });

  it('gives more records to a codepoint whose script can shape to more glyphs', () => {
    // A lone Bengali "ো" shapes to 3 glyphs (dotted circle and two parts); Arabic "آ" to 2.
    expect(textRecordCount(textObject('t', 'কো'))).toBe(6);
    expect(textRecordCount(textObject('t', 'ো'))).toBe(3);
    expect(textRecordCount(textObject('t', 'aকb'))).toBe(5);
    expect(textRecordCount(textObject('t', 'ำ'))).toBe(3);
    expect(textRecordCount(textObject('t', 'آ'))).toBe(2);
    expect(textRecordCount(textObject('t', 'office'))).toBe(6);
    // Montserrat and Oswald shape "Ǆ" (U+01C4) to D and Ž.
    expect(textRecordCount(textObject('t', 'Ǆa'))).toBe(3);
  });
});

describe('TEXT_PASS', () => {
  it('draws nothing until the layout lands, then one record per glyph once glyphs land', async () => {
    const { renderer, document, settle, records } = createTextSetUp();
    document.create(textObject('t', 'Hi there'));
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(records()).toHaveLength(7);
    expect(records().some(isDrawn)).toBe(false);
    await settle();
    expect(records().every(isDrawn)).toBe(true);
    // Glyphs sit on the first line's baseline, left to right, in the run's colour.
    const [first, second] = records();
    expect((first?.[4] ?? 0) < (second?.[4] ?? 0)).toBe(true);
    expect([...(first ?? []).slice(12, 16)]).toEqual(STYLE.color);
  });

  it('places glyphs in the object frame and the object in the world, turned with it', async () => {
    const { renderer, document, settle, records } = createTextSetUp();
    document.create(textObject('t', 'A', { x: 30, y: 40, rotation: Math.PI / 2 }));
    renderer.enqueue(document.takeChanges());
    await settle();
    const [record] = records();
    expect([...(record ?? []).slice(0, 4)].map((value) => Math.round(value * 1000) / 1000)).toEqual(
      [30, 40, 0, 1],
    );
  });

  it("draws a sticky note's text inside its padding, centred both ways while it is short", async () => {
    const { renderer, document, settle, records } = createTextSetUp();
    const text = textObject('n', 'A', { width: 200, height: 200, align: 'center' });
    document.create({
      ...text,
      type: 'sticky',
      autoWidth: false,
      verticalAlign: 'middle',
      color: [1, 0.92, 0.55, 1],
    });
    renderer.enqueue(document.takeChanges());
    await settle();
    const [glyph] = records();
    expect(records()).toHaveLength(1);
    // The glyph's box (x, y, width, height in the note's frame) sits about the note's centre.
    const [x = 0, y = 0, width = 0, height = 0] = glyph?.slice(4, 8) ?? [];
    expect(Math.abs(x + width / 2 - 100)).toBeLessThan(4);
    expect(Math.abs(y + height / 2 - 100)).toBeLessThan(12);
  });

  it("draws a star's label centred in the box inscribed in the star", async () => {
    const { renderer, document, settle, records } = createTextSetUp();
    const text = textObject('s', 'A');
    document.create({
      ...shapeObject('s', { kind: 'star', sides: 5, width: 200, height: 200 }),
      label: { text: text.text, runs: text.runs },
    });
    renderer.enqueue(document.takeChanges());
    await settle();
    const [glyph] = records();
    expect(records()).toHaveLength(1);
    // A five-point star's inscribed box is centred left to right and sits below the box's middle.
    const box = shapeLabelBox(
      shapeObject('s', { kind: 'star', sides: 5, width: 200, height: 200 }),
    );
    const [x = 0, y = 0, width = 0, height = 0] = glyph?.slice(4, 8) ?? [];
    expect(Math.abs(x + width / 2 - 100)).toBeLessThan(4);
    expect(Math.abs(y + height / 2 - (box.y + box.height / 2))).toBeLessThan(12);
  });

  it('asks for a layout when the content changes, not when the object only moves', async () => {
    const { renderer, document, settle, records, pool } = createTextSetUp();
    const submit = vi.spyOn(pool, 'submit');
    document.create(textObject('t', 'Hello'));
    renderer.enqueue(document.takeChanges());
    await settle();
    const layouts = (): number => submit.mock.calls.filter(([kind]) => kind === 'layout').length;
    expect(layouts()).toBe(1);
    document.update('t', { x: 50 });
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(layouts()).toBe(1);
    expect(records()[0]?.[0]).toBe(50);
    document.update('t', { text: 'Hello!', runs: [{ length: 6, style: STYLE }] });
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 1000, camera: CAMERA });
    expect(layouts()).toBe(2);
    // The previous layout keeps drawing its glyphs until the new one lands.
    expect(records().slice(0, 5).every(isDrawn)).toBe(true);
    await settle();
    expect(records().every(isDrawn)).toBe(true);
  });

  it('draws one entry per atlas page, binding the page', async () => {
    const { renderer, document, settle, backend } = createTextSetUp();
    const lists: DrawListEntry[][] = [];
    renderer.frame.insertStage('before', 'draw', {
      name: 'capture',
      run: (context) => lists.push(context.drawList.map((entry) => ({ ...entry }))),
    });
    document.create(textObject('t', 'Page'));
    renderer.enqueue(document.takeChanges());
    await settle();
    backend.resetCalls();
    renderer.renderFrame({ timeMs: 2000, camera: CAMERA });
    expect(lists.at(-1)).toEqual([
      { passName: TEXT_PASS_NAME, page: 0, ranges: [{ start: 0, count: 4 }] },
    ]);
    expect(backend.draws()).toHaveLength(1);
  });

  it('rewrites text on screen whose tier changes with the zoom, and forgets deleted text', async () => {
    const { renderer, document, settle, records, pool } = createTextSetUp();
    document.create(textObject('t', 'Zoom'));
    renderer.enqueue(document.takeChanges());
    await settle();
    const before = records()[0]?.slice(8, 12);
    const zoomed = { ...CAMERA, zoom: 20 };
    renderer.renderFrame({ timeMs: 3000, camera: zoomed });
    for (let frame = 0; frame < 12; frame += 1) {
      renderer.renderFrame({ timeMs: 4000 + frame * 16, camera: zoomed });
      pool.drainMainThread(1_000, () => 0);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect([...(records()[0]?.slice(8, 12) ?? [])]).not.toEqual([...(before ?? [])]);
    document.delete('t');
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 5000, camera: zoomed });
    expect(records().some(isDrawn)).toBe(false);
  });

  it("reports the glyph atlas's memory with the scene's", async () => {
    const { renderer, document, settle } = createTextSetUp();
    document.create(textObject('t', 'Memory'));
    renderer.enqueue(document.takeChanges());
    await settle();
    const ledger = new MemoryLedger();
    renderer.frame.insertStage('after', 'submit', {
      name: 'report',
      run: (context) => {
        reportSceneMemory(context, ledger);
      },
    });
    renderer.renderFrame({ timeMs: 6000, camera: CAMERA });
    expect(ledger.bytesOf('atlases')).toBeGreaterThan(0);
    renderer.destroy();
  });

  it('waits for fonts, then lays text out once its faces load', async () => {
    const { renderer, document, settle, records, pool, fonts } = createTextSetUp(CAMERA, false);
    const submit = vi.spyOn(pool, 'submit');
    document.create(textObject('t', 'Late'));
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(submit).not.toHaveBeenCalled();
    expect(records().some(isDrawn)).toBe(false);
    addBundledFaces(fonts);
    await settle();
    expect(records().every(isDrawn)).toBe(true);
  });

  it('wraps fixed-width text at its width', async () => {
    const { renderer, document, settle, records } = createTextSetUp();
    document.create(textObject('t', 'wrap me now', { autoWidth: false, width: 60 }));
    renderer.enqueue(document.takeChanges());
    await settle();
    const baselines = new Set(records().map((record) => Math.round(record[5] ?? 0)));
    expect(baselines.size).toBeGreaterThan(1);
  });

  it('rewrites nothing for a zoom before the layout lands', async () => {
    const { renderer, document, settle, records } = createTextSetUp();
    document.create(textObject('t', 'Soon'));
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    renderer.renderFrame({ timeMs: 16, camera: { ...CAMERA, zoom: 3 } });
    expect(records().some(isDrawn)).toBe(false);
    await settle();
    expect(records().every(isDrawn)).toBe(true);
  });

  it('asks for a layout again when the object changes after one failed', async () => {
    const { renderer, document, settle, records, pool } = createTextSetUp();
    const submit = pool.submit.bind(pool);
    let isFailing = true;
    vi.spyOn(pool, 'submit').mockImplementation((kind, request, options) => {
      if (kind !== 'layout' || !isFailing) return submit(kind, request, options);
      isFailing = false;
      return { id: -1, response: Promise.reject(new Error('The layout failed.')) };
    });
    document.create(textObject('t', 'Retry'));
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(records().some(isDrawn)).toBe(false);
    document.update('t', { x: 1 });
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(records().every(isDrawn)).toBe(true);
  });

  it('draws nothing without text resources', () => {
    const renderer = new SceneRenderer(new FakeGpuBackend(), { passes: [TEXT_PASS] });
    const document = new FakeSceneDocument();
    document.create(textObject('t', 'None'));
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(renderer.scene.instanceBufferOf(TEXT_PASS_NAME).recordCount).toBe(0);
  });
});
