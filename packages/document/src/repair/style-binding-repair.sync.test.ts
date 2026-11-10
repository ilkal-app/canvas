// A run's typography fields and its style id are separate
// attributes, so concurrent edits can merge into a run naming a style it no longer holds. The
// style binding repair rewrites it to the style's value on every writer, so both converge with
// every bound run holding its style.
import { describe, expect, it } from 'vitest';

import type { BoardObject, Shadow, TextStyleValue } from '@canvas/schema';

import {
  applyCommand,
  mustGet,
  testEnvironment,
} from '../commands/__fixtures__/command-fixtures.js';
import { seedLeafMain } from '../commands/__fixtures__/component-boards.js';
import { setStyleCommand } from '../commands/set-style.js';
import { setEffectStyleCommand, setTextStyleCommand } from '../commands/styles/set-named-style.js';
import { SCOUT_FOR_ADA } from '../history/__fixtures__/history-fixtures.js';
import { ADA, BOB, createSyncedPair, exchange } from '../store/__fixtures__/store-fixtures.js';
import type { YjsDocumentStore } from '../store/yjs-document-store.js';

const BODY: TextStyleValue = { fontFamily: 'Inter', fontSize: 24, weight: 400, italic: false };
const LOW: Shadow = { x: 0, y: 8, blur: 24, spread: 0, color: [0, 0, 0, 0.34] };
const HIGH: Shadow = { x: 0, y: 1, blur: 2, spread: 0, color: [0, 0, 0, 0.2] };

/**
 * The runs of a text, failing on anything else.
 *
 * @param object - The object.
 * @returns Its runs.
 * @throws {Error} When the object is not a text.
 */
function runsOf(object: BoardObject) {
  if (object.type !== 'text') throw new Error(`${object.id} is not a text`);
  return object.runs;
}

/**
 * Ada and Bob holding the fixture board, with a text style bound to `text-title`.
 *
 * @returns The stores and the style's id.
 */
function boundPair(): { ada: YjsDocumentStore; bob: YjsDocumentStore; id: string } {
  const [ada, bob] = createSyncedPair();
  const id = applyCommand(ada, setTextStyleCommand, { name: 'Body', value: BODY }, ADA).result.id;
  applyCommand(ada, setStyleCommand, {
    changes: [{ id: 'text-title', style: { textStyle: { textStyleId: id } } }],
  });
  exchange(ada, bob);
  return { ada, bob, id };
}

/**
 * Checks both stores converged with every run of `text-title` holding its style's value.
 *
 * @param ada - Ada's store.
 * @param bob - Bob's store.
 * @param id - The style.
 */
function expectBoundAndConverged(ada: YjsDocumentStore, bob: YjsDocumentStore, id: string): void {
  expect(ada.get('text-title' as never)).toEqual(bob.get('text-title' as never));
  expect(ada.readTextStyles()).toEqual(bob.readTextStyles());
  const value = ada.readTextStyles().get(id)?.value;
  for (const run of runsOf(mustGet(ada, 'text-title'))) {
    expect(run.style).toMatchObject({ ...value, textStyleId: id });
  }
}

describe('the style binding repair', () => {
  for (const isReversed of [false, true]) {
    it(`converges two concurrent updates of one text style on its value (reversed: ${String(isReversed)})`, () => {
      const { ada, bob, id } = boundPair();
      applyCommand(
        ada,
        setTextStyleCommand,
        { id, name: 'Body', value: { ...BODY, fontSize: 30 } },
        ADA,
      );
      applyCommand(
        bob,
        setTextStyleCommand,
        { id, name: 'Body', value: { ...BODY, weight: 700 } },
        BOB,
      );
      if (isReversed) exchange(bob, ada);
      else exchange(ada, bob);
      exchange(ada, bob);
      expectBoundAndConverged(ada, bob, id);
    });
  }

  it('gives a style update precedence over a concurrent direct restyle of a bound run', () => {
    const { ada, bob, id } = boundPair();
    applyCommand(
      ada,
      setTextStyleCommand,
      { id, name: 'Body', value: { ...BODY, fontSize: 30 } },
      ADA,
    );
    applyCommand(
      bob,
      setStyleCommand,
      {
        changes: [{ id: 'text-title', style: { textStyle: { weight: 700 } } }],
      },
      BOB,
    );
    exchange(ada, bob);
    exchange(ada, bob);
    // Bob's restyle detached his runs, Ada's update bound them again; the merge keeps the id,
    // so the style wins and the runs take its value.
    expectBoundAndConverged(ada, bob, id);
  });

  it('converges two concurrent updates of one effect style on its layers', () => {
    const [ada, bob] = createSyncedPair();
    const id = applyCommand(
      ada,
      setEffectStyleCommand,
      { name: 'Float', value: { shadows: [LOW] } },
      ADA,
      testEnvironment(5),
    ).result.id;
    applyCommand(ada, setStyleCommand, {
      changes: [{ id: 'shape-box', style: { effectStyleId: id } }],
    });
    exchange(ada, bob);
    applyCommand(
      ada,
      setEffectStyleCommand,
      { id, name: 'Float', value: { shadows: [LOW, HIGH] } },
      ADA,
    );
    applyCommand(
      bob,
      setEffectStyleCommand,
      { id, name: 'Float', value: { shadows: [HIGH] } },
      BOB,
    );
    exchange(ada, bob);
    exchange(ada, bob);
    expect(ada.get('shape-box' as never)).toEqual(bob.get('shape-box' as never));
    const shadows = ada.readEffectStyles().get(id)?.value.shadows;
    expect(mustGet(ada, 'shape-box')).toMatchObject({ effectStyleId: id, shadow: shadows });
  });

  it('repairs a concurrent bind to a style an agent changed, on a main the agent may not write', () => {
    // Ada binds a main's text while the agent changes the style
    // on a board where nothing names it yet. Ada's incoming update touches no object, and the
    // agent may not write the main's content; Ada repairs it, as the style changed.
    const [ada, scout] = createSyncedPair();
    scout.setRepairMode('agent-write');
    const leaf = seedLeafMain(ada, 'main-one', { x: 900, y: 0 });
    const id = applyCommand(
      scout,
      setTextStyleCommand,
      { name: 'Body', value: BODY },
      SCOUT_FOR_ADA,
    ).result.id;
    exchange(ada, scout);
    applyCommand(ada, setStyleCommand, {
      changes: [{ id: leaf, style: { textStyle: { textStyleId: id } } }],
    });
    applyCommand(
      scout,
      setTextStyleCommand,
      { id, name: 'Body', value: { ...BODY, fontSize: 30 } },
      SCOUT_FOR_ADA,
    );
    exchange(ada, scout);
    exchange(ada, scout);
    expect(ada.get(leaf)).toEqual(scout.get(leaf));
    const sticky = mustGet(ada, leaf);
    if (sticky.type !== 'sticky') throw new Error('the leaf is a sticky');
    for (const run of sticky.runs)
      expect(run.style).toMatchObject({ fontSize: 30, textStyleId: id });
  });
});
