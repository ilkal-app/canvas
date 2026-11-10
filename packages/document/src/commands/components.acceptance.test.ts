// Acceptance, first slice: the
// `createComponent` and `createInstance` commands, the reference rules they refuse on, the
// client-side limit of 10,000 stored instances, and `BoardReferences.instancesOf`. Written before
// the product code; every case fails on the base for a named reason. The overrides, constraints,
// resize, detach, retirement and agent cases are in the sibling `components-*.acceptance` files
// (one file holds at most 400 lines).
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';
import { generateNKeysBetween } from '../z-order/fractional-key.js';

import { boardPlacement, expectSamePlacement } from './__fixtures__/board-geometry.js';
import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
} from './__fixtures__/command-fixtures.js';
import {
  CARD_BOX,
  CARD_CHILD_BOXES,
  createChild,
  newFrame,
  newSticky,
  placeInstance,
  seedLeafMain,
  seedMainWithChildren,
} from './__fixtures__/component-boards.js';
import {
  codesOf,
  fieldOf,
  instanceObject,
  instancesOf,
  mustFindCommand,
} from './__fixtures__/component-fixtures.js';
import { deleteObjectsCommand } from './delete-objects.js';
import { addPageCommand } from './pages/add-page.js';

const MAX_INSTANCES = 10_000;

describe('createComponent', () => {
  it('creates the component at the selection’s bounds and takes the members in where they are', () => {
    const store = new YjsDocumentStore();
    createChild(store, newSticky('note', null, { x: 100, y: 100, width: 160, height: 160 }));
    createChild(store, newSticky('other', null, { x: 300, y: 250, width: 200, height: 150 }));
    const before = store.read();
    const placements = ['note', 'other'].map((id) => boardPlacement(before, id));
    const { result, changes } = applyCommand(store, mustFindCommand('createComponent'), {
      ids: ['note', 'other'],
      name: 'Card',
      componentId: 'main-card',
    });
    expect(result).toEqual({ componentId: 'main-card' });
    expectDiff(before, store.read(), changes, {
      created: ['main-card'],
      updated: ['note', 'other'],
    });
    expect(mustGet(store, 'main-card')).toMatchObject({
      type: 'component',
      parentId: null,
      x: 100,
      y: 100,
      rotation: 0,
      width: 400,
      height: 300,
      name: 'Card',
      retired: false,
      createdBy: ADA.principalId,
    });
    ['note', 'other'].forEach((id, index) => {
      expect(mustGet(store, id).parentId).toBe('main-card');
      const expected = placements[index];
      if (expected === undefined) throw new Error(`no placement recorded for ${id}`);
      expectSamePlacement(boardPlacement(store.read(), id), expected, (a, b) => {
        expect(a).toBeCloseTo(b, 9);
      });
    });
    expect(mustGet(store, 'other')).toMatchObject({ x: 200, y: 150 });
  });

  it('refuses members with different parents and a name over 200 characters', () => {
    const store = new YjsDocumentStore();
    createChild(store, newFrame('frame-f', null, { x: 0, y: 0, width: 500, height: 500 }));
    createChild(store, newSticky('inner', 'frame-f', { x: 10, y: 10, width: 100, height: 100 }));
    createChild(store, newSticky('outer', null, { x: 700, y: 10, width: 100, height: 100 }));
    const command = mustFindCommand('createComponent');
    expect(codesOf(expectRejected(store, command, { ids: ['inner', 'outer'], name: 'X' }))).toEqual(
      ['mixed-parents'],
    );
    expect(
      codesOf(expectRejected(store, command, { ids: ['outer'], name: 'x'.repeat(201) })),
    ).toEqual(['invalid-input']);
  });

  it('generates the component id when none is given', () => {
    const store = new YjsDocumentStore();
    createChild(store, newSticky('note', null, { x: 0, y: 0, width: 100, height: 100 }));
    const { result } = applyCommand(store, mustFindCommand('createComponent'), {
      ids: ['note'],
      name: 'Card',
    });
    const { componentId } = result as { componentId: string };
    expect(mustGet(store, componentId).type).toBe('component');
    expect(mustGet(store, 'note').parentId).toBe(componentId);
  });
});

describe('createInstance', () => {
  it('creates an instance with the main’s size at the point given', () => {
    const store = new YjsDocumentStore();
    const { mainId } = seedMainWithChildren(store);
    const before = store.read();
    const { result, changes } = applyCommand(store, mustFindCommand('createInstance'), {
      componentId: mainId,
      x: 1000,
      y: 50,
      instanceId: 'inst-1',
    });
    expect(result).toEqual({ instanceId: 'inst-1' });
    expectDiff(before, store.read(), changes, { created: ['inst-1'] });
    expect(mustGet(store, 'inst-1')).toMatchObject({
      type: 'instance',
      parentId: null,
      x: 1000,
      y: 50,
      rotation: 0,
      width: CARD_BOX.width,
      height: CARD_BOX.height,
      mainId,
      overrides: {},
      createdBy: ADA.principalId,
    });
  });

  it('honours width, height, rotation, parentId, pageId and instanceId', () => {
    const store = new YjsDocumentStore();
    const { mainId } = seedMainWithChildren(store);
    createChild(store, newFrame('frame-f', null, { x: 1000, y: 0, width: 600, height: 600 }));
    placeInstance(store, mainId, {
      x: 1020,
      y: 30,
      width: 200,
      height: 150,
      rotation: 0.5,
      parentId: 'frame-f',
      instanceId: 'inst-custom',
    });
    expect(mustGet(store, 'inst-custom')).toMatchObject({
      type: 'instance',
      parentId: 'frame-f',
      x: 20,
      y: 30,
      width: 200,
      height: 150,
      rotation: 0.5,
    });
    const { pageId } = applyCommand(store, addPageCommand, {}).result;
    const onPage = placeInstance(store, mainId, { x: 0, y: 0, pageId });
    expect(mustGet(store, onPage)).toMatchObject({ parentId: null, pageId });
  });

  it('refuses a missing main, a retired main and a parent that is not a container', () => {
    const store = new YjsDocumentStore();
    const { mainId, noteId } = seedMainWithChildren(store);
    createChild(store, newSticky('loose', null, { x: 900, y: 900, width: 100, height: 100 }));
    const command = mustFindCommand('createInstance');
    const refuse = (input: Record<string, unknown>) =>
      codesOf(expectRejected(store, command, { x: 0, y: 0, ...input }));
    expect(refuse({ componentId: 'nobody' })).toEqual(['missing-main']);
    expect(refuse({ componentId: noteId })).toEqual(['missing-main']);
    expect(refuse({ componentId: mainId, parentId: 'loose' })).toEqual(['invalid-parent']);
    applyCommand(store, deleteObjectsCommand, { ids: [mainId] });
    expect(fieldOf(store, mainId, 'retired')).toBe(true);
    expect(refuse({ componentId: mainId })).toEqual(['retired-main']);
  });

  it('refuses an instance that would close a reference cycle', () => {
    const store = new YjsDocumentStore();
    const a = seedMainWithChildren(store, { prefix: 'a' }).mainId;
    const b = seedMainWithChildren(store, { prefix: 'b', at: { x: 1000, y: 100 } }).mainId;
    const command = mustFindCommand('createInstance');
    // Inside its own subtree: A in A, and A in a frame inside A.
    createChild(store, newFrame('frame-in-a', a, { x: 10, y: 10, width: 100, height: 100 }));
    expect(
      codesOf(expectRejected(store, command, { componentId: a, x: 0, y: 0, parentId: a })),
    ).toEqual(['instance-cycle']);
    expect(
      codesOf(
        expectRejected(store, command, { componentId: a, x: 0, y: 0, parentId: 'frame-in-a' }),
      ),
    ).toEqual(['instance-cycle']);
    // B holds an instance of A, so an instance of B inside A would resolve back to A.
    placeInstance(store, a, { x: 10, y: 10, parentId: b, instanceId: 'a-in-b' });
    expect(
      codesOf(expectRejected(store, command, { componentId: b, x: 0, y: 0, parentId: a })),
    ).toEqual(['instance-cycle']);
  });

  it('allows a chain of five nested instances and refuses a sixth level', () => {
    const store = new YjsDocumentStore();
    // M1 is a leaf; M(k) holds an instance of M(k-1): an instance of M5 resolves five deep.
    const mains = [1, 2, 3, 4, 5, 6].map((level) => {
      const mainId = `main-${String(level)}`;
      seedLeafMain(store, mainId, { x: level * 300, y: 0 });
      return mainId;
    });
    for (let level = 1; level < 5; level += 1) {
      placeInstance(store, mains[level - 1] ?? '', {
        x: 0,
        y: 0,
        parentId: mains[level],
        instanceId: `chain-${String(level)}`,
      });
    }
    const five = placeInstance(store, mains[4] ?? '', { x: 0, y: 2000, instanceId: 'five-deep' });
    expect(mustGet(store, five).type).toBe('instance');
    const command = mustFindCommand('createInstance');
    // M6 has an instance at the root: placing M5 into M6 makes that instance six deep.
    placeInstance(store, mains[5] ?? '', { x: 0, y: 3000, instanceId: 'of-six' });
    expect(
      codesOf(
        expectRejected(store, command, { componentId: mains[4], x: 0, y: 0, parentId: mains[5] }),
      ),
    ).toEqual(['instance-depth']);
    // Without that instance the placement applies, and an instance of M6 is then refused.
    applyCommand(store, deleteObjectsCommand, { ids: ['of-six'] });
    placeInstance(store, mains[4] ?? '', { x: 0, y: 0, parentId: mains[5], instanceId: 'chain-5' });
    expect(
      codesOf(expectRejected(store, command, { componentId: mains[5], x: 0, y: 4000 })),
    ).toEqual(['instance-depth']);
  });

  it(`refuses the ${String(MAX_INSTANCES + 1)}th stored instance`, () => {
    const store = new YjsDocumentStore();
    const { mainId } = seedMainWithChildren(store);
    const seeded = MAX_INSTANCES - 1;
    const keys = generateNKeysBetween(null, null, seeded);
    // Seeded with direct writes, in a few transactions, so the test stays well under 30 s.
    const batch = 2_500;
    for (let start = 0; start < seeded; start += batch) {
      store.transact(ADA, (transaction) => {
        for (let index = start; index < Math.min(seeded, start + batch); index += 1) {
          const box = { x: 1000 + (index % 100) * 10, y: 1000 + Math.floor(index / 100) * 10 };
          transaction.setObject(
            instanceObject(
              `seed-${String(index)}`,
              mainId,
              { ...box, ...CARD_BOX },
              {},
              keys[index],
            ),
          );
        }
      });
    }
    expect(instancesOf(store, mainId).size).toBe(seeded);
    const last = placeInstance(store, mainId, { x: 0, y: 5000, instanceId: 'the-ten-thousandth' });
    expect(mustGet(store, last).type).toBe('instance');
    expect(instancesOf(store, mainId).size).toBe(MAX_INSTANCES);
    const errors = expectRejected(store, mustFindCommand('createInstance'), {
      componentId: mainId,
      x: 0,
      y: 6000,
    });
    expect(codesOf(errors)).toEqual(['too-many-instances']);
  }, 30_000);
});

describe('instancesOf', () => {
  it('tracks creation, detach and deletion of a main’s instances', () => {
    const store = new YjsDocumentStore();
    const { mainId } = seedMainWithChildren(store);
    expect([...instancesOf(store, mainId)]).toEqual([]);
    const first = placeInstance(store, mainId, { x: 1000, y: 0, instanceId: 'inst-1' });
    const second = placeInstance(store, mainId, { x: 2000, y: 0, instanceId: 'inst-2' });
    expect([...instancesOf(store, mainId)].sort()).toEqual([first, second]);
    applyCommand(store, mustFindCommand('detachInstance'), { id: first });
    expect([...instancesOf(store, mainId)]).toEqual([second]);
    applyCommand(store, deleteObjectsCommand, { ids: [second] });
    expect([...instancesOf(store, mainId)]).toEqual([]);
    expect(mustGet(store, mainId)).toMatchObject({ type: 'component', retired: false });
  });

  it('keeps the children of the main where createComponent put them', () => {
    const store = new YjsDocumentStore();
    const { mainId, noteId, boxId, captionId, photoId } = seedMainWithChildren(store);
    expect([...store.references.childrenOf(mainId as ObjectId)].sort()).toEqual(
      [noteId, boxId, captionId, photoId].sort(),
    );
    expect(mustGet(store, boxId)).toMatchObject(CARD_CHILD_BOXES.box);
    expect(mustGet(store, photoId)).toMatchObject(CARD_CHILD_BOXES.photo);
  });
});
