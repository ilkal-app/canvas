// A text style that an object `replaceFontFamily` leaves names stays
// as it is, so a peer's binding repair (`repairStyleBindings`) never rewrites that object; the
// runs the replacement does change are detached from it.
import { describe, expect, it } from 'vitest';

import {
  importBoard,
  type BoardObject,
  type PrincipalId,
  type StyleId,
  type TextStyleValue,
} from '@canvas/schema';

import { createFixtureBoardJson } from '../codec/__fixtures__/fixture-board-json.js';
import { storeWith } from '../layout/__fixtures__/auto-layout-fixtures.js';
import { ADA, exchange } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { replaceFontFamilyCommand } from './replace-font-family.js';
import { setStyleCommand } from './set-style.js';
import { setTextStyleCommand } from './styles/set-named-style.js';

const AGENT = {
  kind: 'agent',
  principalId: 'agent:helper' as PrincipalId,
  operatorId: ADA.principalId,
} as const;

const BODY_STYLE: TextStyleValue = {
  fontFamily: 'Inter',
  fontSize: 24,
  weight: 400,
  italic: false,
};

/**
 * A board whose sticky and title are bound to a text style naming Inter, with a peer holding the
 * same board; `edit` changes objects by id before the binding.
 *
 * @param edit - Changes to objects by id.
 * @param styleOrigin - Who creates the text style; Ada by default.
 * @returns The writer's store, the peer's and the style.
 */
function boundPair(
  edit: Readonly<Record<string, object>> = {},
  styleOrigin: typeof ADA | typeof AGENT = ADA,
) {
  const objects = [...importBoard(createFixtureBoardJson(true)).objects.values()].map(
    (object): BoardObject => ({ ...object, ...edit[object.id] }),
  );
  const store = storeWith(...objects);
  const style: StyleId = applyCommand(
    store,
    setTextStyleCommand,
    { name: 'Body', value: BODY_STYLE },
    styleOrigin,
  ).result.id;
  // Bound while unlocked; a lock or a parent comes after, in `after`.
  applyCommand(store, setStyleCommand, {
    changes: ['sticky-idea', 'text-title'].map((id) => ({
      id,
      style: { textStyle: { textStyleId: style } },
    })),
  });
  const peer = new YjsDocumentStore();
  exchange(store, peer);
  return { store, peer, style };
}

/**
 * The fonts and style ids of an object's runs.
 *
 * @param store - The store.
 * @param id - The object.
 * @returns One `family/style` entry per run.
 * @throws {Error} When the object has no runs of its own.
 */
function runsOf(store: YjsDocumentStore, id: string): string[] {
  const object = mustGet(store, id);
  if (object.type !== 'text' && object.type !== 'sticky') throw new Error(`${id} has no runs`);
  return object.runs.map((run) => `${run.style.fontFamily}/${run.style.textStyleId ?? '-'}`);
}

describe('replaceFontFamily and text style bindings across peers', () => {
  it('leaves a style a locked object names, so a peer never rewrites the locked object', () => {
    const { store, peer, style } = boundPair();
    store.transact(ADA, (transaction) => {
      transaction.patchObject(mustGet(store, 'sticky-idea').id, { locked: true });
    });
    exchange(store, peer);
    const { result } = applyCommand(store, replaceFontFamilyCommand, { from: 'Inter', to: 'Lora' });
    exchange(store, peer);
    for (const replica of [store, peer]) {
      expect(replica.readTextStyles().get(style)?.value.fontFamily).toBe('Inter');
      expect(new Set(runsOf(replica, 'sticky-idea'))).toEqual(new Set([`Inter/${style}`]));
      // The title is rewritten, and no longer names the style it no longer matches.
      expect(new Set(runsOf(replica, 'text-title'))).toEqual(new Set(['Lora/-']));
    }
    expect(result.skipped).toEqual([
      { id: 'sticky-idea', reason: 'locked' },
      { id: style, reason: 'bound-by-left-object' },
    ]);
  });

  it('leaves a style an object under a foreign main names, for an agent', () => {
    // The agent's own style, so only the foreign main can hold it.
    const { store, peer, style } = boundPair(
      { 'sticky-idea': { parentId: 'component-card' } },
      AGENT,
    );
    const { result } = applyCommand(
      store,
      replaceFontFamilyCommand,
      { from: 'Inter', to: 'Lora' },
      AGENT,
    );
    exchange(store, peer);
    for (const replica of [store, peer]) {
      expect(replica.readTextStyles().get(style)?.value.fontFamily).toBe('Inter');
      expect(new Set(runsOf(replica, 'sticky-idea'))).toEqual(new Set([`Inter/${style}`]));
    }
    expect(result.skipped).toContainEqual({ id: 'sticky-idea', reason: 'not-own-main' });
    expect(result.skipped).toContainEqual({ id: style, reason: 'bound-by-left-object' });
  });
});
