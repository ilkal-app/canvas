// Acceptance: incremental expansion must equal a fresh resolution after preset geometry edits.
import { describe, expect, it } from 'vitest';

import { component, id, shape } from './__fixtures__/component-objects.js';
import { ComponentBoard, ExpansionHarness, instance } from './__fixtures__/component-scene.js';
import { expectedExport } from './__fixtures__/expected-api.js';

const ROW = {
  direction: 'row',
  gap: 10,
  padding: { top: 5, right: 5, bottom: 5, left: 5 },
  align: 'start',
  justify: 'start',
  width: 'fixed',
  height: 'fixed',
} as const;
const RED: [number, number, number, number] = [1, 0, 0, 1];
const AXES = [{ name: 'state', values: ['plain', 'geometry'] }];

function harnessWithPresets(): ExpansionHarness {
  const harness = new ExpansionHarness(
    new ComponentBoard([
      component('main', {
        width: 120,
        height: 40,
        autoLayout: ROW,
        variantAxes: AXES,
        variantPresets: { 'state=plain': {}, 'state=geometry': {} },
      }),
      shape('first', 'main', { width: 20, height: 20, z: 'a0' }),
      shape('last', 'main', { width: 20, height: 20, z: 'a1' }),
      instance('inst', 'main', { width: 120, height: 40, variant: { state: 'geometry' } }),
    ]),
    expectedExport('InstanceExpansion'),
  );
  harness.step();
  harness.expectScene();
  return harness;
}

function preset(harness: ExpansionHarness, geometry: Record<string, unknown>): void {
  harness.board.update('main', {
    variantPresets: { 'state=plain': {}, 'state=geometry': geometry },
  });
}

describe('InstanceExpansion preset geometry', () => {
  it('re-resolves all children when a preset adds x and width, then removes them', () => {
    const harness = harnessWithPresets();
    const initialLast = harness.mirror.get('inst/last');
    const initialStatus = harness.expansion.statusOf(id('inst'));
    preset(harness, { first: { x: 900, width: 40 } });
    harness.step();
    harness.expectScene();
    expect(harness.expansion.statusOf(id('inst'))).not.toBe(initialStatus);
    expect(harness.mirror.get('inst/first')).toMatchObject({ x: 5, width: 40 });
    expect(harness.mirror.get('inst/last')).toMatchObject({ x: 55 });
    expect(harness.mirror.get('inst/last')).not.toEqual(initialLast);

    const geometryStatus = harness.expansion.statusOf(id('inst'));
    preset(harness, {});
    harness.step();
    harness.expectScene();
    expect(harness.expansion.statusOf(id('inst'))).not.toBe(geometryStatus);
    expect(harness.mirror.get('inst/last')).toEqual(initialLast);
  });

  it('re-resolves after a root size record changes the variant box', () => {
    const harness = harnessWithPresets();
    const before = harness.expansion.statusOf(id('inst'));
    preset(harness, { main: { width: 160, height: 60 } });
    harness.step();
    harness.expectScene();
    expect(harness.expansion.statusOf(id('inst'))).not.toBe(before);
  });

  it('switches between a geometry preset and a plain preset through full resolution', () => {
    const harness = harnessWithPresets();
    preset(harness, { first: { width: 40 } });
    harness.step();
    harness.expectScene();
    const geometryLast = harness.mirror.get('inst/last');
    harness.board.update('inst', { variant: { state: 'plain' } });
    harness.step();
    harness.expectScene();
    expect(harness.mirror.get('inst/last')).not.toEqual(geometryLast);
    harness.board.update('inst', { variant: { state: 'geometry' } });
    harness.step();
    harness.expectScene();
    expect(harness.mirror.get('inst/last')).toEqual(geometryLast);
  });

  it('keeps the single-child patch path for a recolour-only preset edit', () => {
    const harness = harnessWithPresets();
    const before = harness.expansion.statusOf(id('inst'));
    const outputIndex = harness.outputs.length;
    preset(harness, { first: { fill: RED } });
    harness.step();
    harness.expectScene();
    expect(harness.expansion.statusOf(id('inst'))).toBe(before);
    expect([...harness.listedSince(outputIndex)].filter((key) => key.startsWith('inst/'))).toEqual([
      'inst/first',
    ]);
    expect(harness.mirror.get('inst/first')).toMatchObject({ fill: RED });
  });
});
