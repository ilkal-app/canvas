import { expect, it, vi } from 'vitest';

import { createHistory } from '@canvas/document';
import type { FrameObject, ObjectId } from '@canvas/schema';

import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';
import { EngineDocument } from './engine-document.js';

const FRAME = 'section-0' as ObjectId;
const CHILD = 'section-0-rect-0-0' as ObjectId;

it('runs fitToContent through the engine document as one change and one undo step', () => {
  const store = createDemoDocument();
  const history = createHistory(store, LOCAL_USER_ORIGIN.principalId);
  const document = new EngineDocument({
    store,
    history,
    origin: LOCAL_USER_ORIGIN,
    environment: { clock: () => 1_790_000_000_000, createId: () => 'new' as ObjectId },
    onChange: vi.fn(),
    onCommandRefused: vi.fn(),
    onNotice: vi.fn(),
  });
  const beforeFrame = store.get(FRAME);
  const beforeChild = store.get(CHILD);
  const changes: unknown[] = [];
  store.subscribe((change) => changes.push(change));
  expect(document.runCanvasAction({ type: 'fitToContent', id: FRAME }, 1)).toBe(true);
  expect(store.get(FRAME)).toMatchObject({ x: 10, y: 10, width: 960, height: 620 });
  expect(store.get(CHILD)).toMatchObject({ x: 40, y: 40 });
  expect(changes).toHaveLength(1);
  expect(history.undo()).toBe(true);
  expect(store.get(FRAME)).toMatchObject(beforeFrame as FrameObject);
  expect(store.get(CHILD)).toMatchObject(beforeChild ?? {});
  expect(history.undo()).toBe(false);
  document.destroy();
  history.destroy();
  store.destroy();
});
