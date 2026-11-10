// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import { findCommand, runCommand } from '@canvas/document';
import type { ObjectId, PageId, Rgba } from '@canvas/schema';
import { FrameNameMode, LONG_PRESS_MS } from '@canvas/tools';

import { BUSY_NOTICE, INPUT_CHANGED_NOTICE } from '../index.js';

import { MARKER, mountOnFakeHost } from './__fixtures__/fake-engine-host.js';
import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';
import type { EngineDocument } from './engine-document.js';

const ID = MARKER as ObjectId;
const OTHER = 'section-0-rect-1-0' as ObjectId;
const RED: Rgba = [1, 0, 0, 1];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('queues a delete until the run closes', async () => {
  const store = createDemoDocument();
  const { engine } = await mountOnFakeHost({ options: { store } });
  engine.board.select([ID]);
  const run = store.beginRun();
  engine.runCanvasAction({ type: 'selection', command: 'delete' });
  expect(store.get(ID)).toBeDefined();
  run.close();
  await vi.waitFor(() => {
    expect(store.get(ID)).toBeUndefined();
  });
  engine.destroy();
  store.destroy();
});

it('drops a queued delete when the selection changes', async () => {
  const store = createDemoDocument();
  const onNotice = vi.fn();
  const { engine } = await mountOnFakeHost({ options: { store, onNotice } });
  engine.board.select([ID]);
  const run = store.beginRun();
  engine.runCanvasAction({ type: 'selection', command: 'delete' });
  engine.board.select([OTHER]);
  run.close();
  await vi.waitFor(() => {
    expect(onNotice).toHaveBeenCalledWith(INPUT_CHANGED_NOTICE);
  });
  expect(store.get(ID)).toBeDefined();
  expect(store.get(OTHER)).toBeDefined();
  engine.destroy();
  store.destroy();
});

it('drops a queued restyle when its named object is deleted before replay', async () => {
  const store = createDemoDocument();
  const onNotice = vi.fn();
  const { engine } = await mountOnFakeHost({ options: { store, onNotice } });
  const run = store.beginRun();
  engine.runCanvasAction({ type: 'style', changes: [{ id: ID, style: { fill: RED } }] });
  run.enter(() => store.transact(LOCAL_USER_ORIGIN, (t) => t.deleteObject(ID)));
  run.close();
  await vi.waitFor(() => {
    expect(onNotice).toHaveBeenCalledWith(INPUT_CHANGED_NOTICE);
  });
  expect(store.get(ID)).toBeUndefined();
  engine.destroy();
  store.destroy();
});

it('applies camera-only frame, zoom and an empty-selection nudge during the run', async () => {
  const store = createDemoDocument();
  const { engine, host } = await mountOnFakeHost({ options: { store } });
  const run = store.beginRun();
  engine.runCanvasAction({ type: 'navigate', command: 'zoomIn' });
  engine.runCanvasAction({ type: 'frame', bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } });
  engine.runCanvasAction({ type: 'nudge', direction: 'right', isLarge: false });
  expect(
    host.calls.filter(([name]) => name === 'setCamera' || name === 'animateCamera').length,
  ).toBeGreaterThan(1);
  run.close();
  engine.destroy();
  store.destroy();
});

it('keeps a held panel restyle behind an idle drag and enqueues its busy release', async () => {
  const store = createDemoDocument();
  const onNotice = vi.fn();
  const { engine, pointer } = await mountOnFakeHost({ options: { store, onNotice } });
  pointer('pointerdown', 60, 60);
  pointer('pointermove', 90, 90);
  engine.runCanvasAction({ type: 'style', changes: [{ id: ID, style: { fill: RED } }] });
  const run = store.beginRun();
  pointer('pointerup', 90, 90);
  expect(store.get(ID)).not.toMatchObject({ fill: RED });
  expect(store.get(ID)).toMatchObject({ x: 10, y: 10 });
  expect(onNotice).toHaveBeenCalledWith(BUSY_NOTICE);
  run.close();
  await vi.waitFor(() => {
    expect(store.get(ID)).toMatchObject({ fill: RED });
  });
  engine.destroy();
  store.destroy();
});

it('orders an earlier queued panel restyle before a later queued delete', async () => {
  const store = createDemoDocument();
  const { engine } = await mountOnFakeHost({ options: { store } });
  engine.board.select([ID]);
  const run = store.beginRun();
  engine.runCanvasAction({ type: 'style', changes: [{ id: ID, style: { fill: RED } }] });
  engine.runCanvasAction({ type: 'selection', command: 'delete' });
  run.close();
  await vi.waitFor(() => {
    expect(store.get(ID)).toBeUndefined();
  });
  const changes = engine.inspect().changeSets;
  expect(
    changes.map(({ updated, deleted }) => [updated.includes(ID), deleted.includes(ID)]),
  ).toContainEqual([true, false]);
  engine.destroy();
  store.destroy();
});

it('drops queued edits when permission is revoked', async () => {
  const store = createDemoDocument();
  const { engine } = await mountOnFakeHost({ options: { store } });
  engine.board.select([ID]);
  const run = store.beginRun();
  engine.runCanvasAction({ type: 'selection', command: 'delete' });
  engine.setEditable(false);
  run.close();
  await Promise.resolve();
  expect(store.get(ID)).toBeDefined();
  engine.destroy();
  store.destroy();
});

it('refuses a press during a run, swallows its move and release, and still routes hover', async () => {
  const store = createDemoDocument();
  const onNotice = vi.fn();
  const { engine, pointer } = await mountOnFakeHost({ options: { store, onNotice } });
  const hostDocument = (engine as unknown as { document: EngineDocument }).document;
  const routed = vi.spyOn(hostDocument, 'handlePointer');
  const run = store.beginRun();
  pointer('pointerdown', 60, 60);
  pointer('pointermove', 90, 90);
  pointer('pointerup', 90, 90);
  expect(engine.inspect().selectedIds).toEqual([]);
  expect(store.get(ID)).toMatchObject({ x: 10, y: 10 });
  expect(onNotice).toHaveBeenCalledWith(BUSY_NOTICE);
  expect(routed).not.toHaveBeenCalled();
  pointer('pointermove', 60, 60);
  expect(routed).toHaveBeenCalledTimes(1);
  run.close();
  engine.destroy();
  store.destroy();
});

it('ends a refused touch press on hold so a later hover move reaches the tool', async () => {
  const store = createDemoDocument();
  const onNotice = vi.fn();
  const { engine, canvas } = await mountOnFakeHost({ options: { store, onNotice } });
  const hostDocument = (engine as unknown as { document: EngineDocument }).document;
  const routed = vi.spyOn(hostDocument, 'handlePointer');
  const run = store.beginRun();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  canvas.dispatchEvent(
    new PointerEvent('pointerdown', {
      pointerId: 7,
      pointerType: 'touch',
      button: 0,
      clientX: 60,
      clientY: 60,
    }),
  );
  expect(onNotice).toHaveBeenCalledWith(BUSY_NOTICE);
  expect(routed).not.toHaveBeenCalled();
  vi.advanceTimersByTime(LONG_PRESS_MS);
  expect(routed).not.toHaveBeenCalled();
  canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 80, clientY: 80 }));
  expect(routed).toHaveBeenCalledOnce();
  expect(routed).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'pointerMove' }),
    engine.camera(),
  );
  run.close();
  engine.destroy();
  store.destroy();
});

it('routes a secondary context press during a refused primary press', async () => {
  const store = createDemoDocument();
  const { engine, canvas, pointer } = await mountOnFakeHost({ options: { store } });
  const hostDocument = (engine as unknown as { document: EngineDocument }).document;
  const routed = vi.spyOn(hostDocument, 'handlePointer');
  const run = store.beginRun();
  pointer('pointerdown', 60, 60);
  expect(routed).not.toHaveBeenCalled();
  canvas.dispatchEvent(
    new MouseEvent('contextmenu', {
      button: 2,
      clientX: 60,
      clientY: 60,
      cancelable: true,
    }),
  );
  expect(routed).toHaveBeenCalledOnce();
  expect(routed).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'contextPress' }),
    engine.camera(),
  );
  pointer('pointerup', 60, 60);
  expect(routed).toHaveBeenCalledOnce();
  run.close();
  engine.destroy();
  store.destroy();
});

it('cancels a shape drag released while busy, creating no object', async () => {
  const store = createDemoDocument();
  const onNotice = vi.fn();
  const { engine, pointer } = await mountOnFakeHost({ options: { store, onNotice } });
  engine.setActiveTool('shape');
  pointer('pointerdown', 200, 150);
  pointer('pointermove', 250, 180);
  const before = store.read().objects.size;
  const run = store.beginRun();
  pointer('pointerup', 250, 180);
  expect(store.read().objects.size).toBe(before);
  expect(onNotice).toHaveBeenCalledWith(BUSY_NOTICE);
  run.close();
  engine.destroy();
  store.destroy();
});

it('queues a tool switch so its frame-name exit commit lands after the run', async () => {
  const store = createDemoDocument();
  const { engine } = await mountOnFakeHost({ options: { store } });
  const hostDocument = (engine as unknown as { document: EngineDocument }).document;
  const frameId = 'section-0' as ObjectId;
  const before = store.get(frameId);
  if (before?.type !== 'frame') throw new Error('frame missing');
  const mode = new FrameNameMode(
    {
      store,
      origin: LOCAL_USER_ORIGIN,
      environment: { clock: () => 1, createId: () => frameId },
      capture: {
        command: (work: () => void) => {
          work();
        },
      },
      requestExit: () => undefined,
      onChange: () => undefined,
    },
    frameId,
  );
  hostDocument.tools.router.enter(mode);
  mode.setDraft('After run');
  const run = store.beginRun();
  engine.setActiveTool('shape');
  expect(store.get(frameId)).toMatchObject({ name: before.name });
  expect(hostDocument.tools.router.activeMode).toBe(mode);
  run.close();
  await vi.waitFor(() => {
    expect(store.get(frameId)).toMatchObject({ name: 'After run' });
  });
  engine.destroy();
  store.destroy();
});

it('drops a queued tool switch when its shown page is deleted during the run', async () => {
  const store = createDemoDocument();
  const onNotice = vi.fn();
  const { engine } = await mountOnFakeHost({ options: { store, onNotice } });
  const pages = engine.pages;
  if (pages === undefined) throw new Error('pages missing');
  const second = pages.run('addPage', {}) as { pageId: PageId };
  pages.show(second.pageId);
  const hostDocument = (engine as unknown as { document: EngineDocument }).document;
  expect(hostDocument.tools.router.activeTool).toBe('select');
  const run = store.beginRun();
  engine.setActiveTool('shape');
  expect(hostDocument.tools.router.activeTool).toBe('select');
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
  await vi.waitFor(() => {
    expect(onNotice).toHaveBeenCalledWith(INPUT_CHANGED_NOTICE);
  });
  expect(hostDocument.tools.router.activeTool).toBe('select');
  engine.destroy();
  store.destroy();
});

it('queues undo from the text editor key path during a run', async () => {
  const store = createDemoDocument();
  const { engine, canvas, pointer } = await mountOnFakeHost({ options: { store } });
  engine.setActiveTool('sticky');
  pointer('pointerdown', 300, 150);
  pointer('pointerup', 300, 150);
  const textarea = document.querySelector('textarea[data-text-input]');
  if (textarea === null) throw new Error('text editor missing');
  textarea.dispatchEvent(
    new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: 'x',
      bubbles: true,
      cancelable: true,
    }),
  );
  const before = engine.inspect().textEditing?.text;
  expect(before).toBe('x');
  const run = store.beginRun();
  textarea.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      metaKey: true,
      bubbles: true,
    }),
  );
  expect(engine.inspect().textEditing?.text).toBe(before);
  run.close();
  await vi.waitFor(() => {
    expect(engine.inspect().textEditing?.text).not.toBe(before);
  });
  engine.destroy();
  canvas.remove();
  store.destroy();
});
