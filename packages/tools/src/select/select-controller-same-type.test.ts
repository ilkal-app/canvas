import { describe, expect, it } from 'vitest';

import { createHistory, type ChangeSet } from '@canvas/document';
import type { ObjectId, Point } from '@canvas/schema';

import { sameTypeBoardObjects } from './__fixtures__/same-type-board.js';
import { id, indexOf } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { SelectController } from './select-controller.js';
import { createSelectHitTester } from './select-hit-tester.js';

function setUp() {
  const objects = sameTypeBoardObjects();
  const store = createSelectStore(objects);
  const changeSets: ChangeSet[] = [];
  store.subscribe((changes) => changeSets.push(changes));
  let notifications = 0;
  const controller = new SelectController({
    store,
    origin: ADA,
    environment: ENVIRONMENT,
    hitTester: createSelectHitTester(indexOf(objects), storeSource(store)),
    onChange: () => {
      notifications += 1;
    },
  });
  const press = (kind: 'pointerDown' | 'pointerMove', point: Point) => {
    controller.handle(
      { kind, screen: point, world: point, isShiftPressed: false, isModPressed: false },
      1,
    );
  };
  return { store, controller, changeSets, press, notifications: () => notifications };
}

function sorted(ids: readonly ObjectId[]): string[] {
  return [...ids].sort();
}

describe('SelectController: select same type', () => {
  it('selects every sticky note and nothing else, writing nothing', () => {
    const { controller, changeSets, notifications } = setUp();
    controller.select([id('sticky-a')]);
    const before = notifications();
    controller.selectSameType();
    expect(controller.selection.primaryId).toBe('sticky-a');
    expect(sorted(controller.selection.ids)).toEqual([
      'sticky-a',
      'sticky-b',
      'sticky-c',
      'sticky-d',
      'sticky-e',
    ]);
    expect(notifications()).toBe(before + 1);
    expect(changeSets).toEqual([]);
  });

  it('makes no undo step', () => {
    const { store, controller } = setUp();
    const history = createHistory(store, ADA.principalId);
    controller.select([id('sticky-a')]);
    controller.selectSameType();
    expect(controller.selection.ids).toHaveLength(5);
    expect(history.canUndo()).toBe(false);
    history.destroy();
  });

  it('takes the entered group’s children when given the group as its scope', () => {
    const { controller } = setUp();
    controller.select([id('sticky-g')]);
    controller.selectSameType(id('group-g'));
    expect(sorted(controller.selection.ids)).toEqual(['sticky-g', 'sticky-h']);
  });

  it('takes the entered group as its scope by default once a group is entered', () => {
    const { controller } = setUp();
    controller.enterGroup(id('group-g'));
    controller.select([id('sticky-g')]);
    controller.selectSameType();
    expect(sorted(controller.selection.ids)).toEqual(['sticky-g', 'sticky-h']);
  });

  it('does nothing with nothing selected', () => {
    const { controller, notifications } = setUp();
    controller.selectSameType();
    expect(controller.selection.ids).toEqual([]);
    expect(notifications()).toBe(0);
  });

  it('does nothing mid-drag', () => {
    const { controller, press } = setUp();
    press('pointerDown', { x: 10, y: 10 });
    press('pointerMove', { x: 40, y: 10 });
    controller.selectSameType();
    expect(controller.selection.ids).toEqual(['sticky-a']);
  });
});
