// A text override's style meets concurrent edits. Two clients exchange updates in both
// client-id orders: a textStyle override beside a concurrent edit of the main's text keeps both,
// and two concurrent records at one path settle on one whole, valid record.
import { describe, expect, it } from 'vitest';

import {
  overrideRecordSchema,
  resolveInstance,
  validateBoard,
  type BoardObject,
  type InstanceObject,
  type TextStyle,
} from '@canvas/schema';

import { ADA, BOB, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import { placeInstance, seedMainWithChildren } from './__fixtures__/component-boards.js';
import { setInstanceOverrideCommand } from './set-instance-override.js';
import { setTextRunsCommand } from './set-text-runs.js';

const RED: [number, number, number, number] = [1, 0, 0, 1];
const AMBER: [number, number, number, number] = [1, 0.75, 0, 1];

/** Two stores holding one main with a caption and one instance of it. */
interface Pair {
  readonly ada: YjsDocumentStore;
  readonly bob: YjsDocumentStore;
  readonly instanceId: string;
  readonly captionId: string;
  readonly body: TextStyle;
}

/**
 * Seeds Ada's store and gives Bob the same state.
 *
 * @param adaId - Ada's Yjs client id.
 * @param bobId - Bob's Yjs client id.
 * @returns The two stores and the ids they share.
 * @throws {Error} When the seeded caption has no runs.
 */
function seededPair(adaId: number, bobId: number): Pair {
  const ada = new YjsDocumentStore({ clientId: adaId });
  const bob = new YjsDocumentStore({ clientId: bobId });
  const { mainId, captionId } = seedMainWithChildren(ada);
  const instanceId = placeInstance(ada, mainId, { x: 1000, y: 0, instanceId: 'inst' });
  bob.applyUpdate(ada.encodeState(), RELAY);
  const caption = mustGet(ada, captionId);
  const body = caption.type === 'text' ? caption.runs[0]?.style : undefined;
  if (body === undefined) throw new Error('the caption has no runs');
  return { ada, bob, instanceId, captionId, body };
}

/**
 * Exchanges both stores' states.
 *
 * @param pair - The stores.
 */
function exchange(pair: Pair): void {
  const fromAda = pair.ada.encodeState();
  const fromBob = pair.bob.encodeState();
  pair.ada.applyUpdate(fromBob, RELAY);
  pair.bob.applyUpdate(fromAda, RELAY);
}

/**
 * The caption's virtual copy in the instance, in one store.
 *
 * @param store - The store.
 * @param pair - The shared ids.
 * @returns The virtual caption.
 * @throws {Error} When the instance does not show it.
 */
function resolvedCaption(store: YjsDocumentStore, pair: Pair): BoardObject {
  const instance = mustGet(store, pair.instanceId) as InstanceObject;
  const found = resolveInstance(store.read(), instance).objects.find(
    (object) => object.id === `${pair.instanceId}/${pair.captionId}`,
  );
  if (found === undefined) throw new Error('the instance does not show the caption');
  return found;
}

describe.each([
  ['Ada first', 1, 2],
  ['Bob first', 2, 1],
])('text override style under concurrency (%s by client id)', (order, adaId, bobId) => {
  it('keeps a textStyle override and a concurrent edit of the main’s text', () => {
    const pair = seededPair(adaId, bobId);
    applyCommand(
      pair.ada,
      setInstanceOverrideCommand,
      { id: pair.instanceId, path: pair.captionId, override: { textStyle: { color: RED } } },
      ADA,
    );
    applyCommand(
      pair.bob,
      setTextRunsCommand,
      { id: pair.captionId, text: 'Edited', runs: [{ length: 6, style: pair.body }] },
      BOB,
    );
    exchange(pair);
    expect(pair.ada.read().objects).toEqual(pair.bob.read().objects);
    for (const store of [pair.ada, pair.bob]) {
      expect(validateBoard(store.read())).toEqual([]);
      expect(resolvedCaption(store, pair)).toMatchObject({
        text: 'Edited',
        runs: [{ length: 6, style: { ...pair.body, color: RED } }],
      });
    }
  });

  it('settles two concurrent records at one path on one whole, valid record', () => {
    const pair = seededPair(adaId, bobId);
    const mention = {
      text: '@Mira hi',
      runs: [
        { length: 5, style: { ...pair.body, color: AMBER } },
        { length: 3, style: pair.body },
      ],
    };
    applyCommand(
      pair.ada,
      setInstanceOverrideCommand,
      { id: pair.instanceId, path: pair.captionId, override: { textStyle: { fontSize: 40 } } },
      ADA,
    );
    applyCommand(
      pair.bob,
      setInstanceOverrideCommand,
      { id: pair.instanceId, path: pair.captionId, override: mention },
      BOB,
    );
    exchange(pair);
    expect(pair.ada.read().objects).toEqual(pair.bob.read().objects);
    const instance = mustGet(pair.ada, pair.instanceId) as InstanceObject;
    const record = instance.overrides[pair.captionId];
    expect(overrideRecordSchema.safeParse(record).success).toBe(true);
    expect([{ textStyle: { fontSize: 40 } }, mention]).toContainEqual(record);
    expect(resolvedCaption(pair.ada, pair)).toEqual(resolvedCaption(pair.bob, pair));
  });
});
