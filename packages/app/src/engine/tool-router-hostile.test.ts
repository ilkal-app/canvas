// The Enter path on an object a peer wrote past the command layer: a text with no style
// runs, which the text mode's layout cannot lay out, starts no mode.
import { describe, expect, it } from 'vitest';

import type { ObjectId, PrincipalId, TextObject } from '@canvas/schema';
import type { SelectController, ToolMode } from '@canvas/tools';

import { ToolRouter } from './tool-router.js';

const TEXT: TextObject = {
  id: 'text-1' as ObjectId,
  type: 'text',
  parentId: null,
  x: 0,
  y: 0,
  rotation: 0,
  z: 'a0',
  locked: false,
  createdBy: 'user:ada' as PrincipalId,
  createdAt: 1_790_000_000_000,
  updatedAt: 1_790_000_000_000,
  width: 100,
  height: 25,
  text: 'Hi',
  runs: [
    {
      length: 2,
      style: { fontFamily: 'Inter', fontSize: 20, color: [0, 0, 0, 1], weight: 400, italic: false },
    },
  ],
  align: 'left',
  autoWidth: true,
  verticalAlign: 'top',
};

/** A stand-in mode that does nothing. */
const IDLE_MODE: ToolMode = {
  id: 'text',
  cursor: 'text',
  onPointer: () => ({ isDone: false }),
  onKey: () => false,
  overlay: () => ({}),
  exit: () => undefined,
};

/**
 * A router over one text object, counting the text modes it starts.
 *
 * @param text - The text as stored.
 * @returns The router and the count.
 */
function routerOver(text: TextObject) {
  const started = { count: 0 };
  const router = new ToolRouter({
    select: { canEdit: true } as SelectController,
    getObject: (id) => (id === text.id ? text : undefined),
    onChange: () => undefined,
  });
  router.registerActivation('text', () => {
    started.count += 1;
    return IDLE_MODE;
  });
  return { router, started };
}

describe('ToolRouter on a text with no style runs', () => {
  it('starts the text mode on an honest text', () => {
    const { router, started } = routerOver(TEXT);
    expect(router.canActivate(TEXT.id)).toBe(true);
    router.activate({ type: 'activate', id: TEXT.id, world: { x: 0, y: 0 }, source: 'enter' });
    expect(started.count).toBe(1);
  });

  it('starts nothing on Enter over a text whose runs are empty', () => {
    const { router, started } = routerOver({ ...TEXT, text: '', runs: [] });
    expect(router.canActivate(TEXT.id)).toBe(false);
    router.activate({ type: 'activate', id: TEXT.id, world: { x: 0, y: 0 }, source: 'enter' });
    expect(started.count).toBe(0);
  });
});
