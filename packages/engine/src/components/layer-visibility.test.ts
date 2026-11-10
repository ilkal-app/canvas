// A layer stored hidden, and everything inside it, never reaches the scene; showing
// it again brings the subtree back. An instance draws a main's hidden child only where a record
// shows it.
import { describe, expect, it } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import {
  cardMain,
  ComponentBoard,
  ExpansionHarness,
  instance,
} from './__fixtures__/component-scene.js';
import { expectedExport } from './__fixtures__/expected-api.js';

/**
 * A harness over the objects, stepped once.
 *
 * @param objects - The board's objects.
 * @returns The harness.
 */
function attached(objects: readonly BoardObject[]): ExpansionHarness {
  const harness = new ExpansionHarness(
    new ComponentBoard(objects),
    expectedExport('InstanceExpansion'),
  );
  harness.step();
  return harness;
}

describe('InstanceExpansion: stored layer visibility', () => {
  it('leaves a hidden layer and its subtree out of the scene, and shows them again', () => {
    const harness = attached([...cardMain(), instance('inst', 'main', { x: 400 })]);
    expect(harness.mirror.has('badge')).toBe(true);
    harness.board.update('badge', { isHidden: true });
    harness.step();
    for (const key of ['badge', 'dot']) expect(harness.mirror.has(key)).toBe(false);
    expect(harness.mirror.has('title')).toBe(true);
    // The main's hidden group is hidden in its instance too.
    for (const key of ['inst/badge', 'inst/dot']) expect(harness.mirror.has(key)).toBe(false);
    harness.board.update('badge', { isHidden: false });
    harness.step();
    for (const key of ['badge', 'dot', 'inst/badge', 'inst/dot'])
      expect(harness.mirror.has(key)).toBe(true);
  });

  it('draws a main’s hidden child in an instance whose record shows it', () => {
    const objects = cardMain().map((object) =>
      object.id === 'title' ? ({ ...object, isHidden: true } as BoardObject) : object,
    );
    const harness = attached([
      ...objects,
      instance('shown', 'main', { x: 400, overrides: { title: { isHidden: false } } }),
      instance('plain', 'main', { x: 800 }),
    ]);
    expect(harness.mirror.has('title')).toBe(false);
    expect(harness.mirror.get('shown/title')).toBeDefined();
    expect(harness.mirror.get('shown/title')).not.toHaveProperty('isHidden');
    expect(harness.mirror.has('plain/title')).toBe(false);
  });
});
