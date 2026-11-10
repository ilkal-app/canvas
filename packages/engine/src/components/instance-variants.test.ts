// Variant sets in the engine: an instance shows its main's presets for the values it
// selects, so a preset or axis edit on the main, a switch of the instance's selection, or a
// preset edit on a nested main re-resolves exactly the instances it reaches, and a child edit
// under a preset still patches through the effective overrides. Each step's scene equals the
// oracle's full resolution.
import { describe, expect, it } from 'vitest';

import {
  cardMain,
  component,
  ComponentBoard,
  ExpansionHarness,
  instance,
  shape,
} from './__fixtures__/component-scene.js';
import { expectedExport } from './__fixtures__/expected-api.js';

const RED: [number, number, number, number] = [1, 0, 0, 1];
const BLUE: [number, number, number, number] = [0, 0, 1, 1];
const AXES = [{ name: 'state', values: ['rest', 'hover'] }];

/**
 * The card main with a `state` axis whose `hover` preset turns the title red, an instance on
 * `hover` and one on the default `rest`, shown.
 *
 * @returns The harness, attached.
 */
function variantBoard(): ExpansionHarness {
  const [main, ...children] = cardMain();
  const objects = [
    {
      ...main,
      variantAxes: AXES,
      variantPresets: { 'state=rest': {}, 'state=hover': { title: { fill: RED } } },
    },
    ...children,
    instance('hovered', 'main', { x: 400, variant: { state: 'hover' } }),
    instance('resting', 'main', { x: 800 }),
  ];
  const harness = new ExpansionHarness(
    new ComponentBoard(objects as never),
    expectedExport('InstanceExpansion'),
  );
  harness.step();
  return harness;
}

describe('InstanceExpansion with variants', () => {
  it('shows each instance its selected preset', () => {
    const harness = variantBoard();
    harness.expectScene();
    expect(harness.mirror.get('hovered/title')).toMatchObject({ fill: RED });
    expect(harness.mirror.get('resting/title')).not.toMatchObject({ fill: RED });
  });

  it('re-resolves the instances a preset edit reaches', () => {
    const harness = variantBoard();
    harness.board.update('main', {
      variantPresets: { 'state=rest': {}, 'state=hover': { title: { fill: BLUE } } },
    });
    harness.step();
    harness.expectScene();
    expect(harness.mirror.get('hovered/title')).toMatchObject({ fill: BLUE });
  });

  it('re-resolves an instance whose selection switches', () => {
    const harness = variantBoard();
    harness.board.update('resting', { variant: { state: 'hover' } });
    harness.step();
    harness.expectScene();
    expect(harness.mirror.get('resting/title')).toMatchObject({ fill: RED });
    harness.board.update('hovered', { variant: { state: 'rest' } });
    harness.step();
    harness.expectScene();
    expect(harness.mirror.get('hovered/title')).not.toMatchObject({ fill: RED });
  });

  it('patches a child edit through the effective overrides', () => {
    const harness = variantBoard();
    harness.board.update('title', { width: 150 });
    harness.step();
    harness.expectScene();
    expect(harness.mirror.get('hovered/title')).toMatchObject({ fill: RED, width: 150 });
  });

  it('re-resolves nothing for a main edit resolution does not read', () => {
    const harness = variantBoard();
    const before = harness.outputs.length;
    harness.board.update('main', { name: 'Renamed' });
    harness.step();
    harness.expectScene();
    expect([...harness.listedSince(before)].filter((key) => key.includes('/'))).toEqual([]);
  });

  it('follows a preset edit on a nested main', () => {
    const objects = [
      component('inner', {
        variantAxes: AXES,
        variantPresets: { 'state=rest': {}, 'state=hover': { leaf: { fill: RED } } },
      }),
      shape('leaf', 'inner', { x: 0, y: 0, width: 40, height: 40 }),
      component('outer', { x: 1000 }),
      instance('nested', 'inner', { parentId: 'outer', x: 0, y: 0, variant: { state: 'hover' } }),
      instance('root', 'outer', { x: 2000 }),
    ];
    const harness = new ExpansionHarness(
      new ComponentBoard(objects),
      expectedExport('InstanceExpansion'),
    );
    harness.step();
    harness.expectScene();
    expect(harness.mirror.get('root/nested/leaf')).toMatchObject({ fill: RED });
    harness.board.update('inner', {
      variantPresets: { 'state=rest': {}, 'state=hover': { leaf: { fill: BLUE } } },
    });
    harness.step();
    harness.expectScene();
    expect(harness.mirror.get('root/nested/leaf')).toMatchObject({ fill: BLUE });
  });

  it('patches only the children a preset edit changed', () => {
    const harness = variantBoard();
    const before = harness.outputs.length;
    harness.board.update('main', {
      variantPresets: { 'state=rest': {}, 'state=hover': { title: { fill: BLUE } } },
    });
    harness.step();
    harness.expectScene();
    // The hovered instance's title alone changed; the resting instance shows no hover preset.
    expect([...harness.listedSince(before)].filter((key) => key.includes('/'))).toEqual([
      'hovered/title',
    ]);
  });

  it.each(['hovered', 'resting'])(
    'carries a preset edit to every instance when %s changes in the same step',
    (edited) => {
      // The edited instance resolves against the new main first; the other must still see the
      // preset edit against the main it last read, not the one its neighbour just read.
      const harness = variantBoard();
      harness.board.update('main', {
        variantPresets: {
          'state=rest': { title: { fill: BLUE } },
          'state=hover': { title: { fill: BLUE } },
        },
      });
      harness.board.update(edited, { width: 300 });
      harness.step();
      harness.expectScene();
      expect(harness.mirror.get('hovered/title')).toMatchObject({ fill: BLUE });
      expect(harness.mirror.get('resting/title')).toMatchObject({ fill: BLUE });
    },
  );

  it('re-resolves when a preset hides or shows a child', () => {
    const harness = variantBoard();
    harness.board.update('main', {
      variantPresets: {
        'state=rest': {},
        'state=hover': { title: { fill: RED }, note: { isHidden: true } },
      },
    });
    harness.step();
    harness.expectScene();
    expect(harness.mirror.has('hovered/note')).toBe(false);
    harness.board.update('main', {
      variantPresets: { 'state=rest': {}, 'state=hover': { title: { fill: RED } } },
    });
    harness.step();
    harness.expectScene();
    expect(harness.mirror.has('hovered/note')).toBe(true);
  });

  it('re-resolves when an axis changes, not only a preset', () => {
    const harness = variantBoard();
    harness.board.update('main', {
      variantAxes: [{ name: 'state', values: ['hover', 'rest'] }],
    });
    harness.step();
    harness.expectScene();
    // `hover` is now the default: the instance with no choice shows it.
    expect(harness.mirror.get('resting/title')).toMatchObject({ fill: RED });
  });
});
