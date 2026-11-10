import { expect, it, vi } from 'vitest';

import { DEFAULT_PAGE, createSeededIdGenerator, type ObjectId } from '@canvas/schema';

import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';
import { DocumentClipboard } from './document-clipboard.js';

it('refuses a duplicate above 5,000 copied objects before creating anything', () => {
  const store = createDemoDocument();
  const marker = store.get('section-0-rect-0-0' as ObjectId);
  if (marker?.type !== 'shape') throw new Error('missing source shape');
  const ids = Array.from({ length: 5_001 }, (unused, index) => `bulk-${String(index)}` as ObjectId);
  store.transact(LOCAL_USER_ORIGIN, (transaction) => {
    ids.forEach((id, index) => {
      transaction.setObject({
        ...marker,
        id,
        parentId: null,
        pageId: DEFAULT_PAGE.id,
        x: (index % 100) * 4,
        y: Math.floor(index / 100) * 4,
        width: 3,
        height: 3,
        z: 'a0',
      });
    });
  });
  const onNotice = vi.fn();
  const controller = {
    selection: { ids },
    isGesturing: false,
    enteredGroupId: null,
    select: vi.fn(),
  } as unknown as ConstructorParameters<typeof DocumentClipboard>[0]['controller'];
  const clipboard = new DocumentClipboard({
    store,
    origin: LOCAL_USER_ORIGIN,
    environment: { clock: () => 1_790_000_000_000, createId: createSeededIdGenerator(99) },
    controller,
    onNotice,
  });
  const before = store.read().objects.size;
  clipboard.duplicateSelection();
  expect(onNotice).toHaveBeenCalledWith(
    'A duplicate creates at most 5,000 objects; this selection holds 5001.',
  );
  expect(store.read().objects.size).toBe(before);
  store.destroy();
});
