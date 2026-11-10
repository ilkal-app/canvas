import { describe, expect, it } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';
import type { ObjectId, PageId } from '@canvas/schema';

import { INPUT_CHANGED_NOTICE } from '../notices/busy-notices.js';
import type { CanvasAction } from '../state/shell-action.js';

import { canvasActionEntry, namedObjectsOf } from './canvas-input-checks.js';

const A = 'a' as ObjectId;
const B = 'b' as ObjectId;
const C = 'c' as ObjectId;

describe('namedObjectsOf', () => {
  it('lists every object an action names', () => {
    const cases: [CanvasAction, readonly ObjectId[]][] = [
      [{ type: 'style', changes: [{ id: A, style: {} }] }, [A]],
      [{ type: 'layout', ids: [A, B], field: 'x', value: 1 }, [A, B]],
      [{ type: 'toggleLockOf', ids: [B] }, [B]],
      [{ type: 'autoLayout', ids: [C], change: { kind: 'set', autoLayout: null } }, [C]],
      [{ type: 'placeLayers', ids: [A], parentId: null }, [A]],
      [{ type: 'placeLayers', ids: [A], parentId: B, belowId: C }, [A, B, C]],
      [{ type: 'component', command: 'detach', id: A }, [A]],
      [{ type: 'component', command: 'resetOverrides', id: A, path: 'b/c' }, [A, B, C]],
      [{ type: 'component', command: 'setSwapOptions', id: A, options: [B] }, [A, B]],
      [{ type: 'component', command: 'setSwapOptions', id: A, options: null }, [A]],
      [{ type: 'selection', command: 'delete' }, []],
    ];
    for (const [action, ids] of cases) expect(namedObjectsOf(action)).toEqual(ids);
  });
});

describe('canvasActionEntry', () => {
  const setUp = () => {
    const board = new YjsDocumentStore();
    let page = 'page-1' as PageId;
    let selection: readonly ObjectId[] = [];
    const context = { board, page: () => page, selection: () => selection };
    return {
      board,
      context,
      setPage: (next: PageId) => (page = next),
      select: (ids: readonly ObjectId[]) => (selection = ids),
    };
  };

  it('drops an action after a page switch, or a selection change it acts on', () => {
    const { board, context, setPage, select } = setUp();
    const nudge = canvasActionEntry(
      { type: 'nudge', direction: 'up', isLarge: false },
      context,
      () => undefined,
    );
    const zoom = canvasActionEntry(
      { type: 'navigate', command: 'zoomIn' },
      context,
      () => undefined,
    );
    expect(nudge.check()).toBeUndefined();
    select([A]);
    expect(nudge.check()).toBe(INPUT_CHANGED_NOTICE);
    expect(zoom.check()).toBeUndefined();
    setPage('page-2' as PageId);
    expect(zoom.check()).toBe(INPUT_CHANGED_NOTICE);
    board.destroy();
  });

  it('drops a token change whose custom token is gone, never a built-in one', () => {
    const { board, context } = setUp();
    const custom: CanvasAction = {
      type: 'colorToken',
      command: 'delete',
      id: 'custom-1',
    };
    const builtIn: CanvasAction = {
      type: 'colorToken',
      command: 'setValue',
      id: 'accent',
      mode: 'light',
      value: [0, 0, 0, 1],
    };
    const created: CanvasAction = {
      type: 'colorToken',
      command: 'set',
      name: 'New',
      light: [0, 0, 0, 1],
      dark: [1, 1, 1, 1],
    };
    const check = (action: CanvasAction) =>
      canvasActionEntry(action, context, () => undefined).check();
    expect(check(custom)).toBe(INPUT_CHANGED_NOTICE);
    expect(check(builtIn)).toBeUndefined();
    expect(check(created)).toBeUndefined();
    board.destroy();
  });
});
