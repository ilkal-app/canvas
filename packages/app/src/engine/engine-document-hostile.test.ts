// The document side with an object placed past the drawable extent: the selection frame
// reads the hit gate's verdict as soon as the change lands, and no mode edits the object.
import { describe, expect, it } from 'vitest';

import { createHistory, SYSTEM_ORIGIN } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';
import type { ToolMode } from '@canvas/tools';

import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';
import { EngineDocument } from './engine-document.js';

/** The demo board's first rectangle, inside the first section. */
const MARKER = 'section-0-rect-0-0' as ObjectId;

/** A stand-in mode that does nothing. */
const IDLE_MODE: ToolMode = {
  id: 'text',
  cursor: 'text',
  onPointer: () => ({ isDone: false }),
  onKey: () => false,
  overlay: () => ({}),
  exit: () => undefined,
};

function setUp() {
  const store = createDemoDocument();
  const document = new EngineDocument({
    store,
    history: createHistory(store, LOCAL_USER_ORIGIN.principalId),
    origin: LOCAL_USER_ORIGIN,
    environment: { clock: () => 1_790_000_000_000, createId: () => 'new' as ObjectId },
    onChange: () => undefined,
  });
  /**
   * Places an object far past the drawable extent, as a peer writing past the commands can.
   *
   * @param id - The object.
   * @throws {Error} When the document has no such object.
   */
  const sendFar = (id: ObjectId): void => {
    const object = store.get(id);
    if (object === undefined) throw new Error(`no ${id}`);
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.setObject({ ...object, x: 1e308 });
    });
  };
  return { store, document, sendFar };
}

describe('EngineDocument with an object past the drawable extent', () => {
  it('leaves it out of the select-all frame the moment it lands, and keeps it selected', () => {
    const { document, sendFar } = setUp();
    document.runCanvasAction({ type: 'selection', command: 'selectAll' }, 1);
    const [first, ...others] = document.inspect().selectedIds;
    if (first === undefined) throw new Error('the demo board has sections');
    sendFar(first);
    expect(document.inspect().selectedIds).toEqual([first, ...others]);
    const bounds = document.selectionBounds();
    expect(
      bounds && [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite),
    ).toBe(true);
    expect(bounds?.maxX).toBeLessThan(1e6);
    expect(document.contentBounds()?.maxX).toBeLessThan(1e6);
  });

  it('starts no mode on it, by a double press or by Enter', () => {
    const { document, sendFar } = setUp();
    const { router } = document.tools;
    let started = 0;
    router.registerActivation('shape', () => {
      started += 1;
      return IDLE_MODE;
    });
    expect(router.canActivate(MARKER)).toBe(true);
    sendFar(MARKER);
    expect(router.canActivate(MARKER)).toBe(false);
    router.activate({ type: 'activate', id: MARKER, world: { x: 0, y: 0 }, source: 'enter' });
    expect(started).toBe(0);
  });
});
