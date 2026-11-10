import { expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';
import { layoutText } from '@canvas/engine';
import type { ObjectId, PrincipalId, TextObject } from '@canvas/schema';

import { DEFAULT_TEXT_STYLE } from '../text-input/font-catalogue.js';

import { MONO } from './__fixtures__/text-document.js';
import { TextSizeFollower } from './text-size-follower.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const ENVIRONMENT = { clock: () => 1, createId: () => 'unused' as ObjectId };

function textObject(id: string): TextObject {
  return {
    id: id as ObjectId,
    type: 'text',
    parentId: null,
    x: 0,
    y: 0,
    rotation: 0,
    z: id === 'a' ? 'a0' : 'a1',
    locked: false,
    createdBy: ORIGIN.principalId,
    createdAt: 1,
    updatedAt: 1,
    width: 1,
    height: 1,
    text: 'abcd',
    runs: [{ length: 4, style: DEFAULT_TEXT_STYLE }],
    align: 'left',
    autoWidth: true,
    verticalAlign: 'top',
  };
}

it('keeps all pending text IDs while busy, then measures each once', async () => {
  const store = new YjsDocumentStore();
  store.transact(ORIGIN, (tx) => {
    tx.setObject(textObject('a'));
    tx.setObject(textObject('b'));
  });
  const follower = new TextSizeFollower({
    store,
    environment: ENVIRONMENT,
    editedId: () => undefined,
    layout: {
      layout: ({ text, runs, wrapWidth, align }) => layoutText(text, runs, wrapWidth, MONO, align),
    },
  });
  const writes = vi.fn();
  store.subscribe((change) => {
    if (change.isLocal && change.origin.kind === 'system') writes();
  });
  const run = store.beginRun();
  const queued: VoidFunction[] = [];
  const enqueue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((work) => {
    queued.push(work);
  });
  follower.remeasure(['a' as ObjectId, 'b' as ObjectId]);
  try {
    expect(queued).toHaveLength(1);
    expect(() => queued[0]?.()).not.toThrow();
    expect(writes).not.toHaveBeenCalled();
    expect((store.get('a' as ObjectId) as TextObject).width).toBe(1);
    expect((store.get('b' as ObjectId) as TextObject).width).toBe(1);
  } finally {
    enqueue.mockRestore();
    run.close();
  }
  await vi.waitFor(() => {
    expect(writes).toHaveBeenCalledTimes(2);
  });
  expect((store.get('a' as ObjectId) as TextObject).width).toBeCloseTo(57.6);
  expect((store.get('b' as ObjectId) as TextObject).width).toBeCloseTo(57.6);
  follower.destroy();
  store.destroy();
});
