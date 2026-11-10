// The inspector's layout fields on the engine's document side: each committed X, Y,
// W, H or rotation runs the existing move, resize or rotate command, as one change set and one
// undo step; a locked object refuses it. In Chrome: specs/app/inspector-layout.spec.ts.
import { describe, expect, it, vi } from 'vitest';

import { createHistory } from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { layoutBoxOf } from '../panels/layout-box.js';

import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';
import { EngineDocument } from './engine-document.js';

const MARKER = 'section-0-rect-0-0' as ObjectId;
const NEIGHBOUR = 'section-0-rect-1-0' as ObjectId;

function setUp() {
  const store = createDemoDocument();
  const history = createHistory(store, LOCAL_USER_ORIGIN.principalId);
  const onCommandRefused = vi.fn();
  const document = new EngineDocument({
    store,
    history,
    origin: LOCAL_USER_ORIGIN,
    environment: { clock: () => 1_790_000_000_000, createId: () => 'new' as ObjectId },
    onChange: vi.fn(),
    onCommandRefused,
    onNotice: vi.fn(),
  });
  const changeSets: unknown[] = [];
  store.subscribe((change) => {
    changeSets.push(change);
  });
  const read = (id: ObjectId): BoardObject => {
    const object = store.get(id);
    if (object === undefined) throw new Error(`no ${id}`);
    return object;
  };
  const box = (id: ObjectId) => layoutBoxOf(store, read(id));
  return { store, history, document, onCommandRefused, changeSets, read, box };
}

describe('the layout fields', () => {
  it.each([
    ['x', 412],
    ['y', 268],
    ['width', 176],
    ['height', 120],
    ['rotation', 30],
  ] as const)('sets %s to %d as one command and one undo step', (field, value) => {
    const { document, history, changeSets, box } = setUp();
    const before = box(MARKER);
    document.runCanvasAction({ type: 'layout', ids: [MARKER], field, value }, 1);
    expect(box(MARKER)?.[field]).toBe(value);
    expect(changeSets).toHaveLength(1);
    history.undo();
    expect(box(MARKER)).toEqual(before);
  });

  it('keeps the other side when one side of the size changes', () => {
    const { document, box } = setUp();
    const before = box(MARKER);
    document.runCanvasAction({ type: 'layout', ids: [MARKER], field: 'width', value: 300 }, 1);
    expect(box(MARKER)).toMatchObject({ width: 300, height: before?.height, x: before?.x });
  });

  it('turns an object about its centre', () => {
    const { document, box } = setUp();
    const before = box(MARKER);
    document.runCanvasAction({ type: 'layout', ids: [MARKER], field: 'rotation', value: 180 }, 1);
    const after = box(MARKER);
    expect(after?.rotation).toBe(180);
    // A half turn about the centre leaves the box where it was.
    expect(after?.x).toBeCloseTo(before?.x ?? NaN, 5);
    expect(after?.y).toBeCloseTo(before?.y ?? NaN, 5);
  });

  it('moves several objects in one step, each to the value', () => {
    const { document, history, changeSets, box } = setUp();
    const neighbour = box(NEIGHBOUR);
    document.runCanvasAction(
      { type: 'layout', ids: [MARKER, NEIGHBOUR], field: 'y', value: 500 },
      1,
    );
    expect([box(MARKER)?.y, box(NEIGHBOUR)?.y]).toEqual([500, 500]);
    expect(changeSets).toHaveLength(1);
    history.undo();
    expect(box(NEIGHBOUR)).toEqual(neighbour);
  });

  it('writes nothing for a value already there', () => {
    const { document, changeSets, box } = setUp();
    const x = box(MARKER)?.x ?? 0;
    document.runCanvasAction({ type: 'layout', ids: [MARKER], field: 'x', value: x }, 1);
    expect(changeSets).toHaveLength(0);
  });

  it('refuses a locked object, writing nothing and reporting why', () => {
    const { document, changeSets, onCommandRefused, read } = setUp();
    document.runCanvasAction({ type: 'toggleLockOf', ids: [MARKER] }, 1);
    expect(read(MARKER).locked).toBe(true);
    changeSets.length = 0;
    for (const field of ['x', 'width', 'rotation'] as const) {
      document.runCanvasAction({ type: 'layout', ids: [MARKER], field, value: 77 }, 1);
    }
    expect(changeSets).toHaveLength(0);
    expect(onCommandRefused).toHaveBeenCalledTimes(3);
  });
});
