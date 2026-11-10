import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { createComponentBoard, createRectangle, mustRun } from './__fixtures__/component-board.js';
import { componentDeletionOf, deletionQuestion } from './component-deletion.js';

const ids = (...names: string[]): ObjectId[] => names as ObjectId[];

describe('componentDeletionOf (ruling 6)', () => {
  it('finds the main deleted and the instances that would become plain objects', () => {
    const { store } = createComponentBoard();
    expect(componentDeletionOf(store, ids('card'))).toEqual({
      name: 'Card',
      mainCount: 1,
      instanceCount: 1,
    });
  });

  it('counts a main nested in what is deleted, and an instance inside another main', () => {
    const { store } = createComponentBoard();
    mustRun(store, 'group', { ids: ['badge'], groupId: 'holder' });
    expect(componentDeletionOf(store, ids('holder'))).toEqual({
      name: 'Badge',
      mainCount: 1,
      instanceCount: 1,
    });
  });

  it('leaves out instances deleted with their main', () => {
    const { store } = createComponentBoard();
    expect(componentDeletionOf(store, ids('card', 'inst'))).toBeUndefined();
  });

  it('asks nothing for a main without instances, nor for plain objects', () => {
    const { store } = createComponentBoard();
    createRectangle(store, 'lone', null, { x: 0, y: 0, width: 10, height: 10 });
    mustRun(store, 'createComponent', { ids: ['lone'], name: 'Lone', componentId: 'solo' });
    expect(componentDeletionOf(store, ids('solo'))).toBeUndefined();
    expect(componentDeletionOf(store, ids('inst'))).toBeUndefined();
    expect(componentDeletionOf(store, ids('missing'))).toBeUndefined();
  });

  it('counts each instance once when two mains are deleted', () => {
    const { store } = createComponentBoard();
    mustRun(store, 'createInstance', { componentId: 'badge', x: 0, y: 900, instanceId: 'b2' });
    expect(componentDeletionOf(store, ids('card', 'badge'))).toEqual({
      name: 'Card',
      mainCount: 2,
      instanceCount: 2,
    });
  });
});

describe('deletionQuestion', () => {
  it('asks about one main by name, with the number of its instances', () => {
    expect(deletionQuestion({ name: 'Card', mainCount: 1, instanceCount: 3 })).toBe(
      'Delete component “Card”? Its 3 instances become plain objects.',
    );
    expect(deletionQuestion({ name: 'Card', mainCount: 1, instanceCount: 1 })).toBe(
      'Delete component “Card”? Its instance becomes a plain object.',
    );
  });

  it('asks about several mains by their number', () => {
    expect(deletionQuestion({ name: 'Card', mainCount: 2, instanceCount: 2 })).toBe(
      'Delete 2 components? Their 2 instances become plain objects.',
    );
  });
});
