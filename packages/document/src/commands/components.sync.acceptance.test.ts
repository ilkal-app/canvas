// Acceptance, two clients with fixed
// Yjs client ids in both orders: overrides of different paths merge, one path converges whole,
// a main's restyle and an override survive together, constraints and a restyle too, a rename and
// a retirement both land, an instance created offline of a main deleted meanwhile keeps rendering
// from the retained definition, and a reference cycle or a chain past five closed by merge is
// repaired by re-rooting the lowest-id instance, placement only.
import { describe, expect, it } from 'vitest';

import type { Board, BoardObject } from '@canvas/schema';

import { Link } from '../history/__fixtures__/history-fixtures.js';
import {
  BOB_ENVIRONMENT,
  boardOf,
  expectValidAndConverged,
  ORDERS,
  recordRepairs,
} from '../repair/__fixtures__/repair-fixtures.js';
import { BOB, exchange } from '../store/__fixtures__/store-fixtures.js';
import type { YjsDocumentStore } from '../store/yjs-document-store.js';

import { boardPlacement, expectSamePlacement } from './__fixtures__/board-geometry.js';
import { applyCommand, mustGet } from './__fixtures__/command-fixtures.js';
import {
  createComponentPair,
  placeInstance,
  seedLeafMain,
  seedMainWithChildren,
  type SeededMain,
} from './__fixtures__/component-boards.js';
import {
  codesOf,
  expectRefusedBy,
  fieldOf,
  mustFindCommand,
  overridesOf,
  schemaFunction,
} from './__fixtures__/component-fixtures.js';
import { deleteObjectsCommand } from './delete-objects.js';
import { renameFrameCommand } from './rename-frame.js';
import { setStyleCommand } from './set-style.js';

/** What the schema's `resolveInstance` answers. */
interface ResolvedInstance {
  readonly objects: readonly BoardObject[];
  readonly issue?: string;
  readonly isMainRetired: boolean;
}

/** The fields the placement repair writes: the placement group and the stacking key. */
const PLACEMENT_FIELDS: ReadonlySet<string> = new Set([
  'parentId',
  'pageId',
  'x',
  'y',
  'rotation',
  'z',
]);

/**
 * The fields of an object a placement repair never writes.
 *
 * @param object - The object.
 * @returns Every field but the placement's.
 */
function nonPlacementOf(object: BoardObject): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(object).filter(([field]) => !PLACEMENT_FIELDS.has(field)),
  );
}

/**
 * Ada's and Bob's clients, holding the card and one instance of it (`inst-0` at (1000, 0)).
 *
 * @param adaClientId - Ada's Yjs client id.
 * @param bobClientId - Bob's.
 * @returns The two clients and the card's ids.
 * @throws {Error} When the seed did not run.
 */
function cardPair(adaClientId: number, bobClientId: number) {
  let card: SeededMain | undefined;
  const [ada, bob] = createComponentPair(adaClientId, bobClientId, (store) => {
    card = seedMainWithChildren(store);
    placeInstance(store, card.mainId, { x: 1000, y: 0, instanceId: 'inst-0' });
  });
  if (card === undefined) throw new Error('the card was not seeded');
  return { ada, bob, card, instanceId: 'inst-0' };
}

/**
 * Runs an override on a client.
 *
 * @param store - The client.
 * @param instanceId - The instance.
 * @param path - The path.
 * @param record - The record.
 * @param isBob - Whether Bob runs it (his origin and ids).
 */
function override(
  store: YjsDocumentStore,
  instanceId: string,
  path: string,
  record: Record<string, unknown>,
  isBob = false,
): void {
  applyCommand(
    store,
    mustFindCommand('setInstanceOverride'),
    { id: instanceId, path, override: record },
    isBob ? BOB : undefined,
    isBob ? BOB_ENVIRONMENT : undefined,
  );
}

describe.each(ORDERS)(
  'components under concurrent edits ($name)',
  ({ adaClientId, bobClientId }) => {
    it('keeps both clients’ overrides of different paths of one instance', () => {
      const { ada, bob, card, instanceId } = cardPair(adaClientId, bobClientId);
      override(ada, instanceId, card.noteId, { color: [0, 0, 1, 1] });
      override(bob, instanceId, card.boxId, { fill: [0, 1, 0, 1] }, true);
      exchange(ada, bob);
      expectValidAndConverged(ada, bob);
      expect(overridesOf(ada, instanceId)).toEqual({
        [card.noteId]: { color: [0, 0, 1, 1] },
        [card.boxId]: { fill: [0, 1, 0, 1] },
      });
    });

    it('keeps one whole record when both clients override the same path, and converges', () => {
      const { ada, bob, card, instanceId } = cardPair(adaClientId, bobClientId);
      // Both records set the same two permitted fields with different values, so a merge that
      // mixed fields (Ada's text with Bob's colour) would be told apart from one whole record.
      const adas = { text: 'Hi', color: [1, 0, 0, 1] };
      const bobs = { text: 'Yo', color: [0, 0, 1, 1] };
      override(ada, instanceId, card.noteId, adas);
      override(bob, instanceId, card.noteId, bobs, true);
      exchange(ada, bob);
      expectValidAndConverged(ada, bob);
      const merged = overridesOf(ada, instanceId)[card.noteId];
      expect([adas, bobs]).toContainEqual(merged);
      expect(overridesOf(bob, instanceId)[card.noteId]).toEqual(merged);
    });

    it('keeps a restyle of a main child and an override of that child', () => {
      const { ada, bob, card, instanceId } = cardPair(adaClientId, bobClientId);
      applyCommand(ada, setStyleCommand, {
        changes: [{ id: card.boxId, style: { fill: [0, 0, 0, 1] } }],
      });
      override(bob, instanceId, card.boxId, { fill: [0, 1, 0, 1] }, true);
      exchange(ada, bob);
      expectValidAndConverged(ada, bob);
      expect(mustGet(ada, card.boxId)).toMatchObject({ fill: [0, 0, 0, 1] });
      expect(overridesOf(ada, instanceId)).toEqual({ [card.boxId]: { fill: [0, 1, 0, 1] } });
    });

    it('keeps a constraints change and a restyle of one object', () => {
      const { ada, bob, card } = cardPair(adaClientId, bobClientId);
      applyCommand(ada, mustFindCommand('setConstraints'), { ids: [card.boxId], x: 'stretch' });
      applyCommand(
        bob,
        setStyleCommand,
        { changes: [{ id: card.boxId, style: { fill: [0, 0, 0, 1] } }] },
        BOB,
        BOB_ENVIRONMENT,
      );
      exchange(ada, bob);
      expectValidAndConverged(ada, bob);
      expect(mustGet(ada, card.boxId)).toMatchObject({
        fill: [0, 0, 0, 1],
        constraints: { x: 'stretch', y: 'start' },
      });
    });

    it('ends a main retired and renamed when a rename races its deletion', () => {
      const { ada, bob, card } = cardPair(adaClientId, bobClientId);
      applyCommand(ada, renameFrameCommand, { id: card.mainId, name: 'Renamed' });
      applyCommand(bob, deleteObjectsCommand, { ids: [card.mainId] }, BOB, BOB_ENVIRONMENT);
      exchange(ada, bob);
      expectValidAndConverged(ada, bob);
      for (const store of [ada, bob]) {
        expect(mustGet(store, card.mainId)).toMatchObject({
          type: 'component',
          retired: true,
          name: 'Renamed',
        });
      }
    });

    it('keeps an instance created offline of a main deleted meanwhile, rendering from the retained definition', () => {
      const { ada, bob, card, instanceId } = cardPair(adaClientId, bobClientId);
      const link = new Link(ada, bob);
      link.disconnect();
      applyCommand(ada, deleteObjectsCommand, { ids: [card.mainId] });
      expect(mustGet(ada, instanceId).type).toBe('frame');
      const late = placeInstance(
        bob,
        card.mainId,
        { x: 2000, y: 0, instanceId: 'inst-late' },
        BOB,
        BOB_ENVIRONMENT,
      );
      link.reconnect();
      expectValidAndConverged(ada, bob);
      for (const store of [ada, bob]) {
        expect(mustGet(store, late)).toMatchObject({ type: 'instance', mainId: card.mainId });
        expect(fieldOf(store, card.mainId, 'retired')).toBe(true);
      }
      const resolveInstance = schemaFunction('resolveInstance') as (
        board: Board,
        instance: BoardObject,
      ) => ResolvedInstance;
      const resolved = resolveInstance(boardOf(ada), mustGet(ada, late));
      expect(resolved.isMainRetired).toBe(true);
      expect(resolved.issue).toBeUndefined();
      expect(resolved.objects.map((object) => object.type).sort()).toEqual([
        'image',
        'shape',
        'sticky',
        'text',
      ]);
      expect(
        codesOf(
          expectRefusedBy(bob, BOB, mustFindCommand('createInstance'), {
            componentId: card.mainId,
            x: 3000,
            y: 0,
          }),
        ),
      ).toEqual(['retired-main']);
    });

    it('repairs a reference cycle closed by merge: the lowest-id instance is re-rooted where it was', () => {
      const [ada, bob] = createComponentPair(adaClientId, bobClientId, (store) => {
        seedMainWithChildren(store, { prefix: 'a' });
        seedMainWithChildren(store, { prefix: 'b', at: { x: 1000, y: 100 } });
      });
      const link = new Link(ada, bob);
      link.disconnect();
      placeInstance(ada, 'main-b', { x: 150, y: 150, parentId: 'main-a', instanceId: 'inst-a' });
      placeInstance(
        bob,
        'main-a',
        { x: 1050, y: 150, parentId: 'main-b', instanceId: 'inst-b' },
        BOB,
        BOB_ENVIRONMENT,
      );
      const adaBefore = mustGet(ada, 'inst-a');
      const drawnAt = boardPlacement(ada.read(), 'inst-a');
      const bobsInstance = mustGet(bob, 'inst-b');
      const count = ada.read().objects.size + 1;
      const [adaRepairs, bobRepairs] = [recordRepairs(ada), recordRepairs(bob)];
      link.reconnect();
      expectValidAndConverged(ada, bob);
      const repaired = mustGet(ada, 'inst-a');
      expect(repaired.parentId).toBeNull();
      expectSamePlacement(boardPlacement(ada.read(), 'inst-a'), drawnAt, (a, b) => {
        expect(a).toBeCloseTo(b, 9);
      });
      expect(nonPlacementOf(repaired)).toEqual(nonPlacementOf(adaBefore));
      expect(mustGet(ada, 'inst-b')).toEqual(bobsInstance);
      expect(ada.read().objects.size).toBe(count);
      expect(adaRepairs.map(({ changes }) => changes.updated)).toEqual([['inst-a']]);
      expect(bobRepairs.map(({ written }) => written)).toEqual(
        adaRepairs.map(({ written }) => written),
      );
    });

    it('repairs a chain past five closed by merge the same way', () => {
      // M1 is a leaf; M(k) holds z(k-1), an instance of M(k-1); N and P are leaves too.
      const [ada, bob] = createComponentPair(adaClientId, bobClientId, (store) => {
        for (const name of ['m1', 'm2', 'm3', 'm4', 'n', 'p']) {
          seedLeafMain(store, `main-${name}`, { x: 0, y: 0 });
        }
        for (const level of [1, 2, 3]) {
          placeInstance(store, `main-m${String(level)}`, {
            x: 0,
            y: 0,
            parentId: `main-m${String(level + 1)}`,
            instanceId: `inst-z${String(level)}`,
          });
        }
      });
      const link = new Link(ada, bob);
      link.disconnect();
      // Ada: M4 into N (an instance of N would be five deep). Bob: N into P, and P at the root.
      placeInstance(ada, 'main-m4', { x: 20, y: 20, parentId: 'main-n', instanceId: 'inst-a' });
      placeInstance(
        bob,
        'main-n',
        { x: 20, y: 20, parentId: 'main-p', instanceId: 'inst-b' },
        BOB,
        BOB_ENVIRONMENT,
      );
      placeInstance(
        bob,
        'main-p',
        { x: 5000, y: 0, instanceId: 'inst-root' },
        BOB,
        BOB_ENVIRONMENT,
      );
      const adaBefore = mustGet(ada, 'inst-a');
      const drawnAt = boardPlacement(ada.read(), 'inst-a');
      const bobsInstance = mustGet(bob, 'inst-b');
      const count = ada.read().objects.size + 2;
      link.reconnect();
      expectValidAndConverged(ada, bob);
      const repaired = mustGet(ada, 'inst-a');
      expect(repaired.parentId).toBeNull();
      expectSamePlacement(boardPlacement(ada.read(), 'inst-a'), drawnAt, (a, b) => {
        expect(a).toBeCloseTo(b, 9);
      });
      expect(nonPlacementOf(repaired)).toEqual(nonPlacementOf(adaBefore));
      expect(mustGet(ada, 'inst-b')).toEqual(bobsInstance);
      expect(mustGet(ada, 'inst-root')).toMatchObject({ type: 'instance', parentId: null });
      expect(ada.read().objects.size).toBe(count);
      expect(fieldOf(ada, 'inst-z1', 'mainId')).toBe('main-m1');
    });
  },
);
