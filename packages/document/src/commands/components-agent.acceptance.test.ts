// Acceptance, the agent rule at the
// command layer: an agent (`kind: 'agent'`, principal `agent:scout`, operated by Ada) may create,
// place, move, override and resize instances of any main, and may create mains; it may edit,
// constrain, reparent into or out of, or retire only objects whose every component ancestor,
// before and after the write, it created itself (`not-own-main`). Retiring its own main is
// refused `not-own-object` when detaching an instance would replace another principal's entry.
import { describe, expect, it } from 'vitest';

import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, mustGet, testEnvironment } from './__fixtures__/command-fixtures.js';
import {
  createChild,
  newSticky,
  placeInstance,
  seedMainWithChildren,
} from './__fixtures__/component-boards.js';
import {
  AGENT_FOR_ADA,
  codesOf,
  expectRefusedBy,
  fieldOf,
  mustFindCommand,
} from './__fixtures__/component-fixtures.js';
import { deleteObjectsCommand } from './delete-objects.js';
import { moveObjectsCommand } from './move-objects.js';
import { setStyleCommand } from './set-style.js';

/** The agent's command environment: its own seeded ids. */
const AGENT_ENVIRONMENT = testEnvironment(41);

/**
 * Ada's card, and a sticky the agent made at the root.
 *
 * @param store - The store.
 * @returns The card's ids and the agent's sticky.
 */
function seedAdaMainAndAgentSticky(store: YjsDocumentStore) {
  const card = seedMainWithChildren(store);
  const ownSticky = createChild(
    store,
    newSticky('scout-note', null, { x: 2000, y: 2000, width: 100, height: 100 }),
    AGENT_FOR_ADA,
    AGENT_ENVIRONMENT,
  );
  return { ...card, ownSticky };
}

/**
 * A main the agent created from its own stickies, at (3000, 0).
 *
 * @param store - The store.
 * @returns The main's and its child's ids.
 */
function seedAgentMain(store: YjsDocumentStore) {
  const childId = createChild(
    store,
    newSticky('scout-child', null, { x: 3000, y: 0, width: 160, height: 160 }),
    AGENT_FOR_ADA,
    AGENT_ENVIRONMENT,
  );
  applyCommand(
    store,
    mustFindCommand('createComponent'),
    { ids: [childId], name: 'Scout card', componentId: 'main-scout' },
    AGENT_FOR_ADA,
    AGENT_ENVIRONMENT,
  );
  expect(mustGet(store, 'main-scout')).toMatchObject({
    type: 'component',
    createdBy: AGENT_FOR_ADA.principalId,
  });
  return { mainId: 'main-scout', childId };
}

describe('an agent on another person’s main', () => {
  it('may create, override, move and resize instances of it', () => {
    const store = new YjsDocumentStore();
    const { mainId, noteId } = seedAdaMainAndAgentSticky(store);
    const instanceId = placeInstance(
      store,
      mainId,
      { x: 1000, y: 0, instanceId: 'scout-inst' },
      AGENT_FOR_ADA,
      AGENT_ENVIRONMENT,
    );
    expect(mustGet(store, instanceId)).toMatchObject({
      type: 'instance',
      mainId,
      createdBy: AGENT_FOR_ADA.principalId,
    });
    applyCommand(
      store,
      mustFindCommand('setInstanceOverride'),
      { id: instanceId, path: noteId, override: { color: [0.2, 0.9, 0.2, 1] } },
      AGENT_FOR_ADA,
      AGENT_ENVIRONMENT,
    );
    expect(fieldOf(store, instanceId, 'overrides')).toEqual({
      [noteId]: { color: [0.2, 0.9, 0.2, 1] },
    });
    applyCommand(
      store,
      moveObjectsCommand,
      { moves: [{ id: instanceId, by: { x: 10, y: 20 } }] },
      AGENT_FOR_ADA,
      AGENT_ENVIRONMENT,
    );
    expect(mustGet(store, instanceId)).toMatchObject({ x: 1010, y: 20 });
    applyCommand(
      store,
      mustFindCommand('resizeObjects'),
      { resizes: [{ id: instanceId, to: { width: 200, height: 150 } }] },
      AGENT_FOR_ADA,
      AGENT_ENVIRONMENT,
    );
    expect(mustGet(store, instanceId)).toMatchObject({ width: 200, height: 150 });
  });

  it('may not restyle or constrain its children, move anything in or out, or retire it', () => {
    const store = new YjsDocumentStore();
    const { mainId, boxId, noteId, ownSticky } = seedAdaMainAndAgentSticky(store);
    const refuse = (command: Parameters<typeof expectRefusedBy>[2], input: unknown) =>
      codesOf(expectRefusedBy(store, AGENT_FOR_ADA, command, input));
    expect(
      refuse(setStyleCommand, { changes: [{ id: boxId, style: { fill: [0, 1, 0, 1] } }] }),
    ).toEqual(['not-own-main']);
    expect(refuse(mustFindCommand('setConstraints'), { ids: [boxId], x: 'stretch' })).toEqual([
      'not-own-main',
    ]);
    // Into the main: the sticky's component ancestor after the write would be Ada's.
    expect(
      refuse(moveObjectsCommand, {
        moves: [{ id: ownSticky, to: { x: 110, y: 110 }, parentId: mainId }],
      }),
    ).toEqual(['not-own-main']);
    // Out of the main: the note's component ancestor before the write is Ada's.
    expect(
      refuse(moveObjectsCommand, {
        moves: [{ id: noteId, to: { x: 2500, y: 2500 }, parentId: null }],
      }),
    ).toEqual(['not-own-main']);
    expect(refuse(deleteObjectsCommand, { ids: [mainId] })).toEqual(['not-own-main']);
    expect(mustGet(store, mainId)).toMatchObject({ retired: false });
    // Ada herself may take the agent's sticky into her main, keeping it where it is.
    applyCommand(store, moveObjectsCommand, {
      moves: [{ id: ownSticky, to: { x: 110, y: 110 }, parentId: mainId }],
    });
    expect(mustGet(store, ownSticky)).toMatchObject({ parentId: mainId, x: 10, y: 10 });
  });
});

describe('an agent on a main it created', () => {
  it('may restyle and constrain its children, move objects in, and retire it', () => {
    const store = new YjsDocumentStore();
    const { ownSticky } = seedAdaMainAndAgentSticky(store);
    const { mainId, childId } = seedAgentMain(store);
    applyCommand(
      store,
      setStyleCommand,
      { changes: [{ id: childId, style: { color: [0.2, 0.9, 0.2, 1] } }] },
      AGENT_FOR_ADA,
      AGENT_ENVIRONMENT,
    );
    expect(mustGet(store, childId)).toMatchObject({ color: [0.2, 0.9, 0.2, 1] });
    applyCommand(
      store,
      mustFindCommand('setConstraints'),
      { ids: [childId], x: 'stretch' },
      AGENT_FOR_ADA,
      AGENT_ENVIRONMENT,
    );
    expect(fieldOf(store, childId, 'constraints')).toEqual({ x: 'stretch', y: 'start' });
    applyCommand(
      store,
      moveObjectsCommand,
      { moves: [{ id: ownSticky, to: { x: 3010, y: 10 }, parentId: mainId }] },
      AGENT_FOR_ADA,
      AGENT_ENVIRONMENT,
    );
    expect(mustGet(store, ownSticky)).toMatchObject({ parentId: mainId, x: 10, y: 10 });
    // Its own instance only: the retirement detaches it, replacing its own entry.
    const own = placeInstance(
      store,
      mainId,
      { x: 4000, y: 0, instanceId: 'scout-own-inst' },
      AGENT_FOR_ADA,
      AGENT_ENVIRONMENT,
    );
    const { result } = applyCommand(
      store,
      deleteObjectsCommand,
      { ids: [mainId] },
      AGENT_FOR_ADA,
      AGENT_ENVIRONMENT,
    );
    expect(result).toMatchObject({ retiredIds: [mainId], detachedIds: [own] });
    expect(mustGet(store, mainId)).toMatchObject({ type: 'component', retired: true });
    expect(mustGet(store, own).type).toBe('frame');
  });

  it('may not retire it while another principal’s instance of it would be detached', () => {
    const store = new YjsDocumentStore();
    const { mainId } = seedAgentMain(store);
    const adas = placeInstance(store, mainId, { x: 4000, y: 0, instanceId: 'ada-inst' });
    expect(mustGet(store, adas).createdBy).toBe(ADA.principalId);
    expect(
      codesOf(expectRefusedBy(store, AGENT_FOR_ADA, deleteObjectsCommand, { ids: [mainId] })),
    ).toEqual(['not-own-object']);
    expect(mustGet(store, mainId)).toMatchObject({ retired: false });
  });

  it('loses its rights over its own main once that main sits inside a foreign main', () => {
    const store = new YjsDocumentStore();
    const { mainId: adaMain } = seedMainWithChildren(store);
    const { mainId, childId } = seedAgentMain(store);
    // Ada takes the agent's main into hers; the agent's own children now have a foreign ancestor.
    applyCommand(store, moveObjectsCommand, {
      moves: [{ id: mainId, to: { x: 120, y: 120 }, parentId: adaMain }],
    });
    expect(mustGet(store, mainId)).toMatchObject({ type: 'component', parentId: adaMain });
    expect(
      codesOf(
        expectRefusedBy(store, AGENT_FOR_ADA, setStyleCommand, {
          changes: [{ id: childId, style: { color: [0.2, 0.9, 0.2, 1] } }],
        }),
      ),
    ).toEqual(['not-own-main']);
    expect(
      codesOf(
        expectRefusedBy(store, AGENT_FOR_ADA, mustFindCommand('setConstraints'), {
          ids: [childId],
          x: 'stretch',
        }),
      ),
    ).toEqual(['not-own-main']);
    expect(
      codesOf(expectRefusedBy(store, AGENT_FOR_ADA, deleteObjectsCommand, { ids: [mainId] })),
    ).toEqual(['not-own-main']);
  });
});
