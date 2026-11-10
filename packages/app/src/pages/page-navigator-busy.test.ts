import { expect, it } from 'vitest';

import { findCommand, YjsDocumentStore } from '@canvas/document';
import { createSeededIdGenerator, type PageId, type PrincipalId } from '@canvas/schema';

import { PageIndex } from './page-index.js';
import { PageNavigator } from './page-navigator.js';
import { PageScopedStore } from './page-scoped-store.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;

it('shows only the latest page asked for during a stepped run, once it ends', async () => {
  const store = new YjsDocumentStore();
  const view = new PageScopedStore(store, new PageIndex(store), 'page-1' as PageId);
  const environment = { clock: () => 1, createId: createSeededIdGenerator(3) };
  const navigator = new PageNavigator({ store, view, origin: ORIGIN, environment, findCommand });
  const second = navigator.run('addPage', {}) as { pageId: PageId };
  const third = navigator.run('addPage', {}) as { pageId: PageId };
  const shown: PageId[] = [];
  navigator.subscribe(() => shown.push(navigator.current()));
  const run = store.beginRun();
  navigator.show(second.pageId);
  navigator.show(third.pageId);
  expect(navigator.current()).toBe('page-1');
  run.close();
  await store.whenIdle();
  await Promise.resolve();
  expect(navigator.current()).toBe(third.pageId);
  expect(shown).toEqual([third.pageId]);
  navigator.destroy();
  store.destroy();
});
