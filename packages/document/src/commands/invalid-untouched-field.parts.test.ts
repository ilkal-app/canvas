// Fix round 1, with: a paste or a delete past `MAX_OBJECTS_PER_TRANSACTION` runs
// in several transactions, one undo step. Each part's writes go through the store's one write
// rule (`validateObject`, field-scoped, then the door's judgement) against the board as the
// earlier parts left it, and every part's update passes the relay's door, on a board where a
// peer left an object it touches with an invalid untouched field.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { ObjectId } from '@canvas/schema';

import { ADA, BODY, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { OBJECTS_MAP_NAME, YjsDocumentStore } from '../store/yjs-document-store.js';

import { mustGet, testEnvironment } from './__fixtures__/command-fixtures.js';
import { judgedAtDoor } from './__fixtures__/door-judgement.js';
import type { AnyCommand } from './command.js';
import { MAX_OBJECTS_PER_TRANSACTION } from './create-objects-parts.js';
import { COMMANDS, type CommandName } from './registry.js';
import { runCommand, type CommandOutcome } from './run-command.js';

const COUNT = MAX_OBJECTS_PER_TRANSACTION + 200;

/**
 * Runs a command by name with an input built here, as an agent's JSON would come.
 *
 * @param store - The store.
 * @param name - The command.
 * @param input - Its input.
 * @param seed - The id generator's seed.
 * @returns The outcome.
 */
function run(
  store: YjsDocumentStore,
  name: CommandName,
  input: unknown,
  seed: number,
): CommandOutcome<unknown> {
  return runCommand(store, ADA, COMMANDS[name] as AnyCommand, input, testEnvironment(seed));
}
const STROKE = { color: [0, 0, 0, 1], width: 2 };

/**
 * A shape as `createObjects` lists it.
 *
 * @param id - Its id in the list.
 * @param index - Where it goes along the row.
 * @param parentId - Its parent in the list, or none.
 * @returns The shape.
 */
function listedShape(id: string, index: number, parentId?: string) {
  return {
    id,
    type: 'shape',
    ...(parentId === undefined ? {} : { parentId }),
    x: index * 3,
    y: 0,
    width: 2,
    height: 2,
    kind: 'rectangle',
    stroke: STROKE,
    fill: null,
    cornerRadius: 0,
    sides: 4,
    label: null,
  };
}

/**
 * A connector between two objects, as `createObjects` lists it.
 *
 * @param id - Its id in the list.
 * @param from - The object at its start.
 * @param to - The object at its end.
 * @returns The connector.
 */
function listedConnector(id: string, from: string, to: string) {
  return {
    id,
    type: 'connector',
    x: 0,
    y: 0,
    from: { kind: 'object', objectId: from, anchor: null },
    to: { kind: 'object', objectId: to, anchor: null },
    route: 'straight',
    stroke: STROKE,
    startCap: 'none',
    endCap: 'arrow',
    label: null,
  };
}

/**
 * Writes a wrong-kind stroke colour into an object's style, as a peer that skips validation does.
 *
 * @param store - The store.
 * @param id - The object.
 */
function poison(store: YjsDocumentStore, id: string): void {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, store.encodeState());
  peer.transact(() => {
    const map = peer.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME).get(id);
    const style = map?.get('style') as Record<string, unknown>;
    map?.set('style', { ...style, stroke: { color: 'ink', width: 2 } });
  });
  store.applyUpdate(Y.encodeStateAsUpdate(peer, store.encodeStateVector()), RELAY);
  peer.destroy();
}

/**
 * A store holding a shape `box` a peer left with an invalid stroke.
 *
 * @returns The store and the box's id.
 */
function storeWithPoisonedBox(): { readonly store: YjsDocumentStore; readonly box: ObjectId } {
  const store = new YjsDocumentStore();
  const created = run(
    store,
    'createObject',
    {
      object: {
        ...listedShape('box', 0),
        id: 'box',
        label: { text: 'A', runs: [{ length: 1, style: BODY }] },
      },
    },
    7,
  );
  expect(created.status).toBe('applied');
  poison(store, 'box');
  return { store, box: 'box' as ObjectId };
}

describe('a command in several transactions on a board a peer left invalid', () => {
  it('pastes in parts, connectors to the poisoned box included, and every part passes the door', () => {
    const { store, box } = storeWithPoisonedBox();
    const shapes = Array.from({ length: COUNT }, (unused, index) =>
      listedShape(`s${String(index)}`, index + 1),
    );
    const links = [listedConnector('link-0', 's0', box), listedConnector('link-1', 's1', box)];
    const { result, findings, updateCount } = judgedAtDoor(store, () =>
      run(store, 'createObjects', { objects: [...shapes, ...links], parentId: null }, 11),
    );
    expect(result.status).toBe('applied');
    expect(updateCount).toBeGreaterThan(1);
    expect(findings).toEqual([]);
    expect(store.read().objects.size).toBe(COUNT + 3);
    expect((mustGet(store, box) as { readonly stroke: unknown }).stroke).toEqual({
      color: 'ink',
      width: 2,
    });
  });

  it('deletes in parts, detaching a poisoned connector in the first, and every part passes the door', () => {
    const { store, box } = storeWithPoisonedBox();
    const frame = {
      id: 'frame',
      type: 'frame',
      x: 0,
      y: 100,
      width: 5_000,
      height: 50,
      name: 'F',
      clip: false,
      background: null,
    };
    const shapes = Array.from({ length: COUNT }, (unused, index) =>
      listedShape(`s${String(index)}`, index, 'frame'),
    );
    const pasted = run(
      store,
      'createObjects',
      { objects: [frame, ...shapes, listedConnector('link', 's0', box)], parentId: null },
      12,
    );
    if (pasted.status !== 'applied') throw new Error('the paste was refused');
    const frameId = [...store.read().objects.values()].find(({ type }) => type === 'frame')?.id;
    const link = [...store.read().objects.values()].find(({ type }) => type === 'connector');
    if (frameId === undefined || link === undefined)
      throw new Error('the paste wrote no frame or connector');
    poison(store, link.id);
    const { result, findings, updateCount } = judgedAtDoor(store, () =>
      run(store, 'deleteObjects', { ids: [frameId] }, 13),
    );
    expect(result.status).toBe('applied');
    expect(updateCount).toBeGreaterThan(1);
    expect(findings).toEqual([]);
    const detached = mustGet(store, link.id) as {
      readonly from: { readonly kind: string };
      readonly stroke: unknown;
    };
    expect(detached.from.kind).toBe('point');
    expect(detached.stroke).toEqual({ color: 'ink', width: 2 });
  });
});
