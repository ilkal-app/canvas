import { bench, describe, expect } from 'vitest';

import { shapeObject } from '../../scene/__fixtures__/scene-objects.js';
import { isPassPipelineLabel } from '../../scene/pass-pipeline-label.js';
import { SDF_SHAPE_PASS } from '../../shapes/shape-pass.js';

import { CAMERA, createTextSetUp, STYLE } from './__fixtures__/text-objects.js';
import { TEXT_PASS, TEXT_PASS_NAME } from './text-pass.js';

// Exercise the complete CPU preparation/culling/planning path for dragging a large
// labelled selection. Real GPU costs are excluded; the fake backend still records every upload.
// No benchmark reference or performance threshold is changed by this diagnostic benchmark.
const LABEL = 'A readable label with forty glyphs repeated twice. '.repeat(2);
const COUNT = 500;
const camera = { ...CAMERA, viewportWidthPx: 4_000, viewportHeightPx: 4_000 };

const selections = await Promise.all([1, 3].map((repeat) => readySelection(LABEL.repeat(repeat))));

async function readySelection(label: string) {
  const setup = createTextSetUp(camera, true, true, { passes: [SDF_SHAPE_PASS, TEXT_PASS] });
  const shapes = Array.from({ length: COUNT }, (unused, index) =>
    shapeObject(`label-${String(index)}`, {
      x: (index % 25) * 150,
      y: Math.floor(index / 25) * 150,
      width: 140,
      height: 100,
      label: { text: label, runs: [{ length: label.length, style: STYLE }] },
    }),
  );

  setup.document.create(...shapes);
  setup.renderer.enqueue(setup.document.takeChanges());
  await setup.settle(40);
  const records = setup.records();
  for (const shape of shapes) {
    const slots = setup.renderer.scene.slotsOf(shape.id, TEXT_PASS_NAME);
    expect(slots.length).toBeGreaterThan(0);
    // Every glyph must have landed: missing glyph records have zero-sized drawn bounds.
    for (const slot of slots) {
      const record = records[slot];
      expect(record?.[6]).toBeGreaterThan(0);
      expect(record?.[7]).toBeGreaterThan(0);
    }
  }
  setup.backend.resetCalls();
  setup.renderer.renderFrame({ timeMs: 1_000, camera });
  let isTextPipeline = false;
  let drawnGlyphs = 0;
  for (const call of setup.backend.calls) {
    // The text pass's page-count variants draw its glyphs too.
    if (call.method === 'setPipeline')
      isTextPipeline = isPassPipelineLabel(call.label, TEXT_PASS_NAME);
    if (call.method === 'draw' && isTextPipeline) drawnGlyphs += call.instanceCount;
  }
  expect(drawnGlyphs).toBeGreaterThan(0);
  setup.backend.resetCalls();
  return { ...setup, shapes, label };
}

for (const setup of selections) {
  let frame = 0;
  describe(`dragging 500 labelled shapes (${String(setup.label.length)} characters each)`, () => {
    bench(
      'prepare, index and plan one drag frame',
      () => {
        frame += 1;
        for (const shape of setup.shapes)
          setup.document.update(shape.id, { x: shape.x + (frame % 2) });
        setup.renderer.enqueue(setup.document.takeChanges());
        setup.renderer.renderFrame({ timeMs: frame * 16, camera });
        setup.backend.resetCalls();
      },
      { iterations: 100, time: 0, warmupIterations: 20, warmupTime: 0, throws: true },
    );
  });
}
