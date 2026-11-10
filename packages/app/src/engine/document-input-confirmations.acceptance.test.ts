// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { BUSY_NOTICE } from '../index.js';

import { mountOnFakeHost } from './__fixtures__/fake-engine-host.js';
import { mountComponentBoard } from './__fixtures__/mounted-component-board.js';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('keeps goToMain page switch, selection and framing together after a run', async () => {
  const fixture = mountComponentBoard(true);
  const { store, firstPageId, instancePageId } = fixture;
  const { engine } = await mountOnFakeHost({ options: { store } });
  const pages = engine.pages;
  if (pages === undefined) throw new Error('pages missing');
  pages.show(instancePageId);
  engine.board.select(['inst' as ObjectId]);
  const run = store.beginRun();
  engine.runCanvasAction({ type: 'component', command: 'goToMain', id: 'card' as ObjectId });
  expect(pages.current()).toBe(instancePageId);
  expect(engine.inspect().selectedIds).toEqual(['inst']);
  run.close();
  await vi.waitFor(() => {
    expect(pages.current()).toBe(firstPageId);
  });
  expect(engine.inspect().selectedIds).toEqual(['card']);
  engine.destroy();
  fixture.document.destroy();
  store.destroy();
});

it('refuses a deletion confirmation answered during a run', () => {
  const fixture = mountComponentBoard();
  const { store, document, onNotice } = fixture;
  const stop = document.panels.deletions.subscribe(() => undefined);
  document.selectTool.select(['card' as ObjectId]);
  document.runCanvasAction({ type: 'selection', command: 'delete' }, 1);
  const pending = document.panels.deletions.current();
  expect(pending).toBeDefined();
  const run = store.beginRun();
  pending?.confirm();
  expect(store.get('card' as ObjectId)).toMatchObject({ retired: false });
  expect(onNotice).toHaveBeenCalledWith(BUSY_NOTICE);
  run.close();
  stop();
  document.destroy();
  store.destroy();
});

it('refuses a confirmed cut removal at its write point', () => {
  const fixture = mountComponentBoard();
  const { store, document, clipboard, onNotice } = fixture;
  const stop = document.panels.deletions.subscribe(() => undefined);
  document.selectTool.select(['card' as ObjectId]);
  const cut = clipboard.prepareCut();
  if (cut.kind !== 'ready') throw new Error('cut was not ready');
  cut.remove();
  const pending = document.panels.deletions.current();
  expect(pending).toBeDefined();
  const run = store.beginRun();
  pending?.confirm();
  expect(store.get('card' as ObjectId)).toMatchObject({ retired: false });
  expect(onNotice).toHaveBeenCalledWith(BUSY_NOTICE);
  run.close();
  stop();
  document.destroy();
  store.destroy();
});

it('refuses a component drop during a run', () => {
  const fixture = mountComponentBoard();
  const { store, clipboard, onNotice, document } = fixture;
  const before = store.read().objects.size;
  const run = store.beginRun();
  clipboard.placeInstance('card' as ObjectId, { x: 200, y: 200 });
  expect(store.read().objects.size).toBe(before);
  expect(onNotice).toHaveBeenCalledWith(BUSY_NOTICE);
  run.close();
  document.destroy();
  store.destroy();
});
