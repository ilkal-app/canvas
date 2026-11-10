import { describe, expect, it } from 'vitest';

import { createHistory } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { farObjectsNotice } from '../notices/far-notice.js';

import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';
import { EngineDocument } from './engine-document.js';

// The engine's document side and far objects: an arrangement
// skips them and the person is told once; delete still takes them.

const FIRST = 'section-0-rect-0-0' as ObjectId;
const SECOND = 'section-0-rect-1-0' as ObjectId;

/**
 * The demo document with a select tool, the objects selected and the notices collected.
 *
 * @param ids - The objects to select.
 * @returns The store, the document and the notices.
 */
function setUp(ids: readonly ObjectId[]) {
  const store = createDemoDocument();
  const notices: string[] = [];
  const document = new EngineDocument({
    store,
    history: createHistory(store, LOCAL_USER_ORIGIN.principalId),
    origin: LOCAL_USER_ORIGIN,
    environment: { clock: () => 1_790_000_000_000, createId: () => 'new' as ObjectId },
    onChange: () => undefined,
    release: () => undefined,
    onNotice: (message) => notices.push(message),
  });
  document.selectTool.select(ids);
  return { store, document, notices };
}

describe('EngineDocument with objects placed far away', () => {
  it('aligns the objects within the bound and leaves a far one, saying so once', () => {
    const { store, document, notices } = setUp([FIRST, SECOND]);
    store.transact(LOCAL_USER_ORIGIN, (transaction) => {
      transaction.patchObject(SECOND, { x: 1e300 });
    });
    document.runCanvasAction({ type: 'arrange', command: 'alignBottom' }, 1);
    expect(store.get(SECOND)?.x).toBe(1e300);
    expect(notices).toEqual([farObjectsNotice({ ids: [SECOND], isEvery: false })]);
  });

  it('refuses a transform of an all-far selection with the notice, but still deletes it', () => {
    const { store, document, notices } = setUp([FIRST]);
    store.transact(LOCAL_USER_ORIGIN, (transaction) => {
      transaction.patchObject(FIRST, { x: 1e300 });
    });
    document.runCanvasAction({ type: 'arrange', command: 'alignLeft' }, 1);
    expect(store.get(FIRST)?.x).toBe(1e300);
    expect(notices).toEqual([farObjectsNotice({ ids: [FIRST], isEvery: true })]);
    document.runCanvasAction({ type: 'selection', command: 'delete' }, 1);
    expect(store.get(FIRST)).toBeUndefined();
  });

  it('nudges the near objects with an arrow key and leaves a far one, saying so once', () => {
    const { store, document, notices } = setUp([FIRST, SECOND]);
    store.transact(LOCAL_USER_ORIGIN, (transaction) => {
      transaction.patchObject(SECOND, { x: 1e300 });
    });
    const firstX = store.get(FIRST)?.x ?? Number.NaN;
    expect(document.runCanvasAction({ type: 'nudge', direction: 'right', isLarge: false }, 1)).toBe(
      true,
    );
    expect(store.get(FIRST)?.x).toBeGreaterThan(firstX);
    expect(store.get(SECOND)?.x).toBe(1e300);
    expect(notices).toEqual([farObjectsNotice({ ids: [SECOND], isEvery: false })]);
  });
});
