import { expect, it, vi } from 'vitest';

import { copySelection, createHistory, planPaste, type NewObject } from '@canvas/document';
import { createSeededIdGenerator, type ObjectId } from '@canvas/schema';

import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';
import { DocumentClipboard } from './document-clipboard.js';
import { EngineDocument } from './engine-document.js';

it('selects top-level new objects only when creation finishes and gives ids once', async () => {
  const store = createDemoDocument();
  const environment = { clock: () => 1_790_000_000_000, createId: createSeededIdGenerator(57) };
  const document = new EngineDocument({
    store,
    history: createHistory(store, LOCAL_USER_ORIGIN.principalId),
    origin: LOCAL_USER_ORIGIN,
    environment,
    onChange: vi.fn(),
  });
  const clipboard = new DocumentClipboard({
    store,
    origin: LOCAL_USER_ORIGIN,
    environment,
    controller: document.selectTool,
  });
  const marker = store.get('section-0-rect-0-0' as ObjectId);
  if (marker === undefined) throw new Error('missing marker');
  const copied = copySelection(store.read(), [marker.id]);
  if (copied === undefined) throw new Error('copy failed');
  const listed = planPaste(copied, undefined)[0];
  if (listed === undefined) throw new Error('copy has no object');
  const objects = Array.from({ length: 501 }, (unused, index) => ({
    ...listed,
    id: `callback-${String(index)}` as ObjectId,
    x: listed.x + index * 20,
  }));
  const created = vi.fn();
  const location = clipboard.pasteTarget(undefined, { x: 0, y: 0 }) as unknown as {
    createObjects: (
      objects: readonly NewObject[],
      onCreated: (ids: readonly ObjectId[]) => void,
    ) => boolean;
  };
  const isAccepted = location.createObjects(objects, created);
  expect(isAccepted).toBe(true);
  expect(document.inspect().selectedIds).toEqual([]);
  await vi.waitFor(() => {
    expect(created).toHaveBeenCalledOnce();
  });
  const [ids] = created.mock.lastCall as [readonly ObjectId[]];
  expect(ids).toHaveLength(501);
  expect(document.inspect().selectedIds).toEqual(ids);
  store.destroy();
});
