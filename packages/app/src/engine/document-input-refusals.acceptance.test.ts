// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import { findCommand, runCommand, type NewObject } from '@canvas/document';
import type { ObjectId, PageId, Rgba } from '@canvas/schema';

import { BUSY_NOTICE, INPUT_CHANGED_NOTICE } from '../index.js';

import { MARKER, mountOnFakeHost } from './__fixtures__/fake-engine-host.js';
import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';

const ID = MARKER as ObjectId;
const OTHER = 'section-0-rect-1-0' as ObjectId;
const RED: Rgba = [1, 0, 0, 1];

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('holds a person-initiated page switch and drops a vanished target', async () => {
  const store = createDemoDocument();
  const { engine } = await mountOnFakeHost({ options: { store } });
  const pages = engine.pages;
  if (pages === undefined) throw new Error('pages missing');
  const second = pages.run('addPage', {}) as { pageId: PageId };
  const initial = pages.current();
  const firstRun = store.beginRun();
  pages.show(second.pageId);
  expect(pages.current()).toBe(initial);
  firstRun.close();
  await vi.waitFor(() => {
    expect(pages.current()).toBe(second.pageId);
  });
  pages.show(initial);
  const secondRun = store.beginRun();
  pages.show(second.pageId);
  const command = findCommand('deletePage');
  if (command === undefined) throw new Error('deletePage missing');
  secondRun.enter(() => {
    runCommand(
      store,
      LOCAL_USER_ORIGIN,
      command,
      { pageId: second.pageId },
      { clock: () => 1, createId: () => ID },
    );
  });
  secondRun.close();
  await Promise.resolve();
  expect(pages.current()).toBe(initial);
  engine.destroy();
  store.destroy();
});

it('immediately follows the deletion of the currently shown page during a run', async () => {
  const store = createDemoDocument();
  const { engine } = await mountOnFakeHost({ options: { store } });
  const pages = engine.pages;
  if (pages === undefined) throw new Error('pages missing');
  const second = pages.run('addPage', {}) as { pageId: PageId };
  pages.show(second.pageId);
  const run = store.beginRun();
  const command = findCommand('deletePage');
  if (command === undefined) throw new Error('deletePage missing');
  run.enter(() => {
    runCommand(
      store,
      LOCAL_USER_ORIGIN,
      command,
      { pageId: second.pageId },
      { clock: () => 1, createId: () => ID },
    );
  });
  expect(pages.current()).not.toBe(second.pageId);
  run.close();
  engine.destroy();
  store.destroy();
});

it('refuses page commands and text style outside a session while busy', async () => {
  const store = createDemoDocument();
  const onNotice = vi.fn();
  const { engine } = await mountOnFakeHost({ options: { store, onNotice } });
  const pages = engine.pages;
  if (pages === undefined) throw new Error('pages missing');
  engine.board.select([ID]);
  const before = store.encodeState();
  const run = store.beginRun();
  expect(pages.run('addPage', {})).toBeUndefined();
  engine.applyTextStyle?.({ kind: 'toggleBold' });
  expect(store.encodeState()).toEqual(before);
  expect(onNotice).toHaveBeenCalledWith(BUSY_NOTICE);
  run.close();
  engine.destroy();
  store.destroy();
});

it('prepares native cut copy but refuses removal, object paste and component drop', async () => {
  const store = createDemoDocument();
  const onNotice = vi.fn();
  const { engine } = await mountOnFakeHost({ options: { store, onNotice } });
  engine.board.select([ID]);
  const before = store.read().objects.size;
  const run = store.beginRun();
  const cut = engine.prepareCut();
  expect(cut.kind).toBe('ready');
  if (cut.kind === 'ready') {
    expect(cut.flavours.has('application/x-canvas-objects+json')).toBe(true);
    cut.remove();
  }
  const pasted: NewObject = {
    type: 'shape',
    id: 'pasted' as ObjectId,
    parentId: null,
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    rotation: 0,
    z: 'a0',
    locked: false,
    kind: 'rectangle',
    cornerRadius: 0,
    sides: 4,
    label: null,
    stroke: null,
    fill: RED,
  };
  engine.pasteTarget().createObjects([pasted]);
  engine.runCanvasAction({
    type: 'component',
    command: 'placeInstanceAt',
    id: OTHER,
    at: { x: 30, y: 30 },
  });
  expect(store.read().objects.size).toBe(before);
  expect(store.get(ID)).toBeDefined();
  expect(onNotice).toHaveBeenCalledWith(BUSY_NOTICE);
  run.close();
  engine.destroy();
  store.destroy();
});

it('refuses a previously prepared cut when its remove is confirmed during a run', async () => {
  const store = createDemoDocument();
  const onNotice = vi.fn();
  const { engine } = await mountOnFakeHost({ options: { store, onNotice } });
  engine.board.select([ID]);
  const cut = engine.prepareCut();
  if (cut.kind !== 'ready') throw new Error('expected ready cut');
  const run = store.beginRun();
  cut.remove();
  expect(store.get(ID)).toBeDefined();
  expect(onNotice).toHaveBeenCalledWith(BUSY_NOTICE);
  run.close();
  engine.destroy();
  store.destroy();
});

it('drops a queued panel action naming a deleted object before a later delete', async () => {
  const store = createDemoDocument();
  const onNotice = vi.fn();
  const { engine } = await mountOnFakeHost({ options: { store, onNotice } });
  engine.board.select([OTHER]);
  const run = store.beginRun();
  engine.runCanvasAction({ type: 'style', changes: [{ id: ID, style: { fill: RED } }] });
  engine.runCanvasAction({ type: 'selection', command: 'delete' });
  run.enter(() => store.transact(LOCAL_USER_ORIGIN, (tx) => tx.deleteObject(ID)));
  run.close();
  await vi.waitFor(() => {
    expect(store.get(OTHER)).toBeUndefined();
  });
  expect(onNotice).toHaveBeenCalledWith(INPUT_CHANGED_NOTICE);
  engine.destroy();
  store.destroy();
});
