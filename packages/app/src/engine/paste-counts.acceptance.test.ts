import { expect, it, vi } from 'vitest';

import { copySelection, planPaste, subscribeStoreRuns, type NewObject } from '@canvas/document';
import { createSeededIdGenerator, type ObjectId } from '@canvas/schema';

import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';
import { DocumentClipboard } from './document-clipboard.js';

function setUp() {
  const store = createDemoDocument();
  const source = store.get('section-0-rect-0-0' as ObjectId);
  if (source === undefined) throw new Error('missing source shape');
  const copied = copySelection(store.read(), [source.id]);
  if (copied === undefined) throw new Error('copy failed');
  const listed = planPaste(copied, undefined)[0];
  if (listed === undefined) throw new Error('copy has no object');
  const onNotice = vi.fn();
  const controller = {
    selection: { ids: [] },
    isGesturing: false,
    enteredGroupId: null,
    select: vi.fn(),
  } as unknown as ConstructorParameters<typeof DocumentClipboard>[0]['controller'];
  const clipboard = new DocumentClipboard({
    store,
    origin: LOCAL_USER_ORIGIN,
    environment: { clock: () => 1_790_000_000_000, createId: createSeededIdGenerator(89) },
    controller,
    onNotice,
  });
  const location = clipboard.pasteTarget(undefined, { x: 0, y: 0 }) as unknown as {
    createObjects: (objects: readonly NewObject[]) => boolean;
  };
  return { store, listed, location, onNotice };
}

it('names committed and planned object counts when a paste stops after its first part', async () => {
  const { store, listed, location, onNotice } = setUp();
  const objects = Array.from({ length: 501 }, (unused, index) => ({
    ...listed,
    id: `stop-${String(index)}` as ObjectId,
    x: listed.x + index * 20,
  }));
  const unsubscribe = subscribeStoreRuns(store, (state) => {
    if (state?.progress?.done === 1) store.requestStop('revoked');
  });
  location.createObjects(objects);
  await vi.waitFor(() => {
    expect(onNotice).toHaveBeenCalledWith('Pasted 250 of 501 objects before it stopped.');
  });
  unsubscribe();
  store.destroy();
});

it('names the attempted count when the create command refuses the paste', async () => {
  const { store, listed, location, onNotice } = setUp();
  const before = store.read().objects.size;
  location.createObjects([{ ...listed, width: -1 } as never]);
  await vi.waitFor(() => {
    expect(onNotice.mock.calls[0]?.[0]).toMatch(/^None of the 1 objects were pasted: /);
  });
  expect(store.read().objects.size).toBe(before);
  store.destroy();
});
