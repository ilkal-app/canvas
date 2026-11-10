import { describe, expect, it } from 'vitest';

import { BODY, component, frame, id, shape } from './__fixtures__/component-objects.js';
import {
  cardMain,
  ComponentBoard,
  ExpansionHarness,
  instance,
} from './__fixtures__/component-scene.js';
import { InstanceExpansion } from './instance-expansion.js';

// An instance's content follows its main's auto-layout, so a change to the main's
// layout alone (no child written) re-resolves every shown instance, and the mirror stays equal to
// a full resolve.

/** A row that hugs both axes, 10 apart, padded 5 all round. */
const ROW = {
  direction: 'row',
  gap: 10,
  padding: { top: 5, right: 5, bottom: 5, left: 5 },
  align: 'start',
  justify: 'start',
  width: 'hug',
  height: 'hug',
} as const;

/**
 * The card main and one instance of it, on one shown page.
 *
 * @returns The harness, attached.
 */
function cardWithInstance(): ExpansionHarness {
  const harness = new ExpansionHarness(
    new ComponentBoard(
      [...cardMain('page-a'), instance('i1', 'main', { pageId: 'page-a', x: 400 })],
      'page-a',
    ),
    InstanceExpansion,
  );
  harness.step();
  return harness;
}

describe('InstanceExpansion: a main’s auto-layout', () => {
  it('re-resolves its instances when only the main’s layout changes', () => {
    const harness = cardWithInstance();
    const before = harness.mirror.get('i1/note');
    harness.board.update('main', { autoLayout: ROW });
    harness.step();
    harness.expectScene();
    expect(harness.mirror.get('i1/note')).not.toEqual(before);
    harness.board.update('main', { autoLayout: { ...ROW, gap: 30 } });
    harness.step();
    harness.expectScene();
  });
});

/**
 * The card main laid out as a hugging row, with one instance, on one shown page.
 *
 * @returns The harness, attached and laid out.
 */
function laidOutCard(): ExpansionHarness {
  const harness = cardWithInstance();
  harness.board.update('main', { autoLayout: ROW });
  harness.step();
  return harness;
}

describe('InstanceExpansion: main edits the layout does not read', () => {
  it('patches a recoloured child in place, as a full resolve places it', () => {
    const harness = laidOutCard();
    const status = harness.expansion.statusOf(id('i1'));
    const from = harness.outputs.length;
    harness.board.update('title', { fill: [1, 0, 0, 1] });
    harness.step();
    harness.expectScene();
    // Patched, not resolved again: resolution would record a new status.
    expect(harness.expansion.statusOf(id('i1'))).toBe(status);
    // The instance lists only the recoloured copy; the main itself is on the page too.
    const copies = [...harness.listedSince(from)].filter((listed) => listed.startsWith('i1/'));
    expect(copies).toEqual(['i1/title']);
  });

  it('patches new text at the same size in place', () => {
    const harness = laidOutCard();
    const status = harness.expansion.statusOf(id('i1'));
    harness.board.update('caption', { text: 'Ho', runs: [{ length: 2, style: BODY }] });
    harness.step();
    harness.expectScene();
    expect(harness.expansion.statusOf(id('i1'))).toBe(status);
  });

  it.each([
    { change: 'a size', child: 'title', fields: { width: 120 } },
    { change: 'the order', child: 'title', fields: { z: 'a9' } },
    { change: 'a fill along the row', child: 'note', fields: { layoutChild: { fill: true } } },
    { change: 'a place', child: 'note', fields: { x: 500 } },
  ])('resolves the instance again when $change changes', ({ child, fields }) => {
    const harness = laidOutCard();
    const status = harness.expansion.statusOf(id('i1'));
    harness.board.update(child, fields);
    harness.step();
    harness.expectScene();
    expect(harness.expansion.statusOf(id('i1'))).not.toBe(status);
  });

  it('keeps patching after a patch, and resolves on the next layout edit', () => {
    const harness = laidOutCard();
    harness.board.update('title', { fill: [1, 0, 0, 1] });
    harness.step();
    harness.board.update('title', { fill: [0, 1, 0, 1] });
    harness.step();
    harness.expectScene();
    harness.board.update('title', { fill: [0, 0, 1, 1], width: 60 });
    harness.step();
    harness.expectScene();
  });

  it('patches a child of a laid-out frame inside a main that is not laid out', () => {
    const harness = new ExpansionHarness(
      new ComponentBoard(
        [
          component('main', { pageId: 'page-a' }),
          frame('row', 'main', { x: 20, y: 10, width: 150, height: 60, autoLayout: ROW }),
          shape('a', 'row', { width: 30, height: 30, z: 'a1' }),
          shape('b', 'row', { width: 40, height: 20, z: 'a2' }),
          instance('i1', 'main', { pageId: 'page-a', x: 400, width: 300, height: 150 }),
        ],
        'page-a',
      ),
      InstanceExpansion,
    );
    harness.step();
    const status = harness.expansion.statusOf(id('i1'));
    harness.board.update('b', { fill: [1, 0, 0, 1] });
    harness.step();
    harness.expectScene();
    expect(harness.expansion.statusOf(id('i1'))).toBe(status);
    harness.board.update('a', { height: 50 });
    harness.step();
    harness.expectScene();
    expect(harness.expansion.statusOf(id('i1'))).not.toBe(status);
  });
});
