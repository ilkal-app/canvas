// @vitest-environment jsdom
// The engine host mount against a fake host. In Chrome, with the real worker and main-thread
// hosts: tooling/scenario/specs/engine/engine-host-frames.real-clock.spec.ts, and the whole
// scenario suite, since the worker host is the shell's default (specs/app/default-engine.spec.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BenchmarkSample, Camera } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';

import { DEFAULT_VIEW_PREFERENCES } from '../state/view-preferences.js';

import {
  mountOnFakeHost,
  MARKER,
  START_CAMERA,
  VIEWPORT,
} from './__fixtures__/fake-engine-host.js';
import { createDemoBoard } from './demo-board.js';
import { createDemoDocument } from './demo-document.js';
import type { EngineDocument } from './engine-document.js';
import { FIT_TRANSITION_MS, GLIDE_SETTLE_SLACK_MS } from './engine-glide.js';
import { createEngineHostMount } from './mount-engine-host.js';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('createEngineHostMount', () => {
  it('sizes the host, gives it the document, the overlay and the camera, and is ready after its first frame', async () => {
    const { host, engine } = await mountOnFakeHost();
    expect(host.calls.slice(0, 3)).toEqual([
      ['resize', 400, 200, 1],
      ['applyChangeSet', 284],
      ['setCamera', 1],
    ]);
    expect(host.overlays).toEqual([expect.objectContaining({ frame: undefined })]);
    expect(engine.camera()).toMatchObject({ zoom: 1, viewportWidthPx: 400, viewportHeightPx: 200 });
  });

  it('shows the grid in the host as the view preferences say, from the start', async () => {
    const { host, engine } = await mountOnFakeHost();
    expect(host.gridStates).toEqual([false]);
    engine.setViewPreferences({ ...DEFAULT_VIEW_PREFERENCES, isGridVisible: true });
    engine.setViewPreferences({ ...DEFAULT_VIEW_PREFERENCES, isSnappingOn: false });
    expect(host.gridStates).toEqual([false, true, false]);
  });

  it('selects and drags on the page, sending the host the preview, the overlay and the command', async () => {
    const { host, engine, pointer } = await mountOnFakeHost();
    pointer('pointerdown', 60, 60);
    expect(engine.inspect().selectedIds).toEqual([MARKER]);
    expect(host.overlays.at(-1)?.frame).toMatchObject({ x: 50, y: 50, width: 70, height: 60 });
    pointer('pointermove', 80, 70);
    engine.inspect();
    // The preview reaches the host serialised: the marker 20 × 10 further on in its section.
    expect(host.changeSets.at(-1)?.updated).toEqual([MARKER]);
    expect(host.changeSets.at(-1)?.translation).toEqual({ ids: [MARKER], x: 20, y: 10 });
    expect(host.overlays.at(-1)?.frame).toMatchObject({ x: 70, y: 60 });
    pointer('pointerup', 90, 80);
    const { selectedObjects, changeSets } = engine.inspect();
    expect(selectedObjects[0]).toMatchObject({ x: 40, y: 30 });
    expect(changeSets).toEqual([
      { originKind: 'user', created: [], updated: [MARKER], deleted: [] },
    ]);
    expect(host.changeSets.at(-1)?.objects[MARKER]).toMatchObject({ x: 40, y: 30 });
  });

  it('runs the selection, nudge and history shortcuts against the document', async () => {
    const { host, engine } = await mountOnFakeHost();
    engine.runCanvasAction({ type: 'selection', command: 'selectAll' });
    expect(engine.inspect().selectedIds).toHaveLength(4);
    host.calls.length = 0;
    engine.runCanvasAction({ type: 'nudge', direction: 'down', isLarge: true });
    expect(engine.inspect().selectedObjects[0]).toMatchObject({ y: 50 });
    expect(host.calls.map(([method]) => method)).toEqual(['applyChangeSet']);
    engine.runCanvasAction({ type: 'history', command: 'undo' });
    expect(engine.inspect().selectedObjects[0]).toMatchObject({ y: 40 });
    engine.runCanvasAction({ type: 'selection', command: 'delete' });
    engine.inspect();
    expect(host.changeSets.at(-1)?.deleted.length).toBeGreaterThan(4);
    expect(engine.inspect().selectedIds).toEqual([]);
  });

  it('copies the selection and pastes at the pointer on the page, one command the host is sent', async () => {
    const { host, engine, canvas, pointer } = await mountOnFakeHost();
    pointer('pointerdown', 60, 60);
    pointer('pointerup', 60, 60);
    expect(engine.copySelection()?.get('text/plain')).toBe('');
    pointer('pointermove', 300, 150);
    const target = engine.pasteTarget();
    // The view is 400 × 200 at the origin at 100%.
    expect(target).toMatchObject({ pointer: { x: 300, y: 150 }, viewCentre: { x: 200, y: 100 } });
    engine.runCanvasAction({ type: 'selection', command: 'duplicate' });
    const [duplicate] = engine.inspect().selectedIds;
    expect(duplicate).not.toBe(MARKER);
    expect(host.changeSets.at(-1)?.created).toEqual([duplicate]);
    canvas.dispatchEvent(new PointerEvent('pointerleave'));
    expect(engine.pasteTarget().pointer).toBeUndefined();
    // The duplicate is selected: a cut writes its flavours, then deletes it.
    const cut = engine.prepareCut();
    if (cut.kind !== 'ready') throw new Error('the cut is ready');
    expect(cut.flavours.has('application/x-canvas-objects+json')).toBe(true);
    cut.remove();
    engine.inspect();
    expect(host.changeSets.at(-1)?.deleted).toEqual([duplicate]);
  });

  it('gives the panels its board view: the document and the select tool’s selection', async () => {
    const { engine } = await mountOnFakeHost();
    const marker = MARKER as ObjectId;
    engine.board.select([marker]);
    expect(engine.inspect().selectedIds).toEqual([marker]);
    expect(engine.board.state().selectedIds).toEqual([marker]);
    expect(engine.board.board.get(marker)?.type).toBe('shape');
    engine.setToolStyle('shape', { fill: null });
    // The document side is the mount's own; a tool's mode reads its style from there.
    const { document } = engine as unknown as { document: EngineDocument };
    expect(document.panels.toolStyle('shape')).toEqual({ fill: null });
    expect(document.panels.toolStyle('text')).toEqual({});
    expect(engine.board.state().documentVersion).toBe(0);
  });

  it('tells onNotice, in a sentence, when the document refuses a restyle', async () => {
    const onNotice = vi.fn();
    const { engine } = await mountOnFakeHost({ options: { onNotice } });
    const missing = 'missing' as ObjectId;
    engine.runCanvasAction({ type: 'style', changes: [{ id: missing, style: { opacity: 1 } }] });
    expect(onNotice).toHaveBeenCalledTimes(1);
    expect(onNotice.mock.calls[0]?.[0]).toMatch(/^That change could not be made: /);
  });

  it('hands the ready callback a loader into its document, whose objects the select tool can pick', async () => {
    const { host, engine, loaders, pointer } = await mountOnFakeHost({
      options: { board: [] },
    });
    const [demo] = createDemoBoard();
    const loadDocument = loaders[0];
    if (demo === undefined || loadDocument === undefined) throw new Error('Nothing to load.');
    const section = { ...demo, x: 0, y: 0 };
    loadDocument([section]);
    expect(host.changeSets.at(-1)?.created).toEqual([section.id]);
    // Its title band, 24 px above its top edge.
    pointer('pointerdown', 20, -10);
    pointer('pointerup', 20, -10);
    expect(engine.inspect().selectedIds).toEqual([section.id]);
  });

  it('leaves primary-button input alone while another tool is active', async () => {
    const { engine, pointer } = await mountOnFakeHost();
    engine.setActiveTool('connector');
    pointer('pointerdown', 60, 60);
    pointer('pointerup', 60, 60);
    expect(engine.inspect().selectedIds).toEqual([]);
  });

  it('pans the view against a hand-tool drag, selecting nothing', async () => {
    const { engine, pointer } = await mountOnFakeHost();
    engine.setActiveTool('hand');
    pointer('pointerdown', 60, 60);
    pointer('pointermove', 90, 100);
    pointer('pointerup', 90, 100);
    expect(engine.camera()).toMatchObject({ x: -30, y: -40, zoom: 1 });
    expect(engine.inspect().selectedIds).toEqual([]);
  });

  it('drives the host camera from the shell: a zoom jumps, a fit glides on the engine frames', async () => {
    const { host, engine } = await mountOnFakeHost();
    host.calls.length = 0;
    engine.runCanvasAction({ type: 'navigate', command: 'zoomIn' });
    engine.runCanvasAction({ type: 'navigate', command: 'zoomToFit' });
    engine.runCanvasAction({ type: 'navigate', command: 'toggleGrid' });
    expect(host.calls.map(([method]) => method)).toEqual(['setCamera', 'animateCamera']);
    expect(host.calls[1]?.[2]).toBe(FIT_TRANSITION_MS);
  });

  it('reports the camera mid-glide from the engine frames, and the target once drawn', async () => {
    const { host, engine } = await mountOnFakeHost();
    const start = engine.camera();
    engine.runCanvasAction({ type: 'navigate', command: 'zoomToFit' });
    const target = host.animatedTo;
    if (target === undefined) throw new Error('The fit did not glide.');
    // Nothing drawn yet: the canvas still shows where the glide starts.
    expect(engine.camera()).toBe(start);
    const midway: Camera = { ...start, x: 10, y: 5, zoom: 0.5 };
    host.emitFrame(midway);
    expect(engine.camera()).toEqual(midway);
    host.emitFrame({ ...target });
    expect(engine.camera()).toBe(target);
    // Once the glide is over, late reports no longer move the camera.
    host.emitFrame(midway);
    expect(engine.camera()).toBe(target);
  });

  it('settles on its target, not a frame on the way, when no frame draws it in time', async () => {
    // On a slow GPU the target's frame was still in flight; settling on the frame before
    // it sent the engine back there, and the fit stopped short for good.
    const { host, engine } = await mountOnFakeHost();
    engine.runCanvasAction({ type: 'navigate', command: 'zoomToFit' });
    const target = host.animatedTo;
    if (target === undefined) throw new Error('The fit did not glide.');
    const midway: Camera = { ...START_CAMERA, x: 10, y: 5, zoom: 0.5 };
    host.emitFrame(midway);
    host.calls.length = 0;
    await vi.advanceTimersByTimeAsync(FIT_TRANSITION_MS + GLIDE_SETTLE_SLACK_MS - 1);
    expect(host.calls).toEqual([]);
    expect(engine.camera()).toEqual(midway);
    await vi.advanceTimersByTimeAsync(1);
    expect(host.calls).toEqual([['setCamera', target.zoom]]);
    expect(engine.camera()).toBe(target);
    // The late frames of the glide no longer move it.
    host.emitFrame({ ...target });
    host.emitFrame(midway);
    expect(engine.camera()).toBe(target);
  });

  it('continues new input from the camera mid-glide, which ends the glide', async () => {
    const { host, engine } = await mountOnFakeHost();
    engine.runCanvasAction({ type: 'navigate', command: 'zoomToFit' });
    const midway: Camera = { ...engine.camera(), x: 10, y: 5, zoom: 0.5 };
    host.emitFrame(midway);
    host.calls.length = 0;
    engine.runCanvasAction({ type: 'nudge', direction: 'right', isLarge: false });
    expect(host.calls).toEqual([['setCamera', 0.5]]);
    const panned = engine.camera();
    expect(panned).toMatchObject({ zoom: 0.5, y: 5 });
    host.emitFrame(midway);
    expect(engine.camera()).toBe(panned);
  });

  it('jumps instead of gliding under reduced motion', async () => {
    const { host, engine } = await mountOnFakeHost({ isReducedMotion: true });
    host.calls.length = 0;
    engine.runCanvasAction({ type: 'navigate', command: 'zoomToFit' });
    expect(host.calls.map(([method]) => method)).toEqual(['setCamera']);
  });

  it('resizes the host and keeps the camera in step, ending a glide at its target', async () => {
    const { host, engine } = await mountOnFakeHost();
    engine.runCanvasAction({ type: 'navigate', command: 'zoomToFit' });
    const targetZoom = host.calls.at(-1)?.[1];
    host.emitFrame({ ...START_CAMERA, zoom: 0.9 });
    host.calls.length = 0;
    engine.resize({ ...VIEWPORT, cssWidthPx: 200, widthPx: 400, dpr: 2 });
    expect(host.calls).toEqual([
      ['resize', 400, 200, 2],
      ['setCamera', targetZoom],
    ]);
    expect(engine.camera()).toMatchObject({ viewportWidthPx: 200, dpr: 2, zoom: targetZoom });
  });

  it('reports the drawing buffer the latest frame drew into, and its ratio', async () => {
    const { host, engine } = await mountOnFakeHost();
    expect(engine.drawingBuffer()).toEqual({ widthPx: 400, heightPx: 200, dpr: 1 });
    host.emitFrame({ ...START_CAMERA, dpr: 2 }, { widthPx: 800, heightPx: 400 });
    expect(engine.drawingBuffer()).toEqual({ widthPx: 800, heightPx: 400, dpr: 2 });
    host.emitFrame(undefined);
    expect(engine.drawingBuffer()).toBeUndefined();
  });

  it('captures pixels through the host frame, with straight alpha, inside the size last sent', async () => {
    const { engine } = await mountOnFakeHost();
    const block = await engine.capturePixels({ xPx: 0, yPx: 0, widthPx: 2, heightPx: 1 });
    expect([...block.rgba]).toEqual([128, 0, 0, 128, 0, 0, 0, 0]);
    await expect(
      engine.capturePixels({ xPx: 399, yPx: 0, widthPx: 2, heightPx: 1 }),
    ).rejects.toThrow(RangeError);
    // A worker's canvas element keeps its hand-over size; the buffer is the size last sent.
    engine.resize({ ...VIEWPORT, widthPx: 800, heightPx: 400, dpr: 2 });
    await expect(
      engine.capturePixels({ xPx: 799, yPx: 0, widthPx: 1, heightPx: 1 }),
    ).resolves.toMatchObject({ widthPx: 1 });
  });

  it('records frame statistics where the engine runs, started before the host if asked', async () => {
    const { host, engine } = await mountOnFakeHost({
      beforeStart: (mounted) => {
        mounted.startFrameStats();
        void mounted.readFrameStats().catch(() => undefined);
      },
    });
    expect(host.calls).toContainEqual(['startFrameStats']);
    await expect(engine.readFrameStats()).rejects.toThrow('not started');
    host.sample = { frames: 3 } as BenchmarkSample;
    await expect(engine.readFrameStats()).resolves.toEqual({ frames: 3 });
    engine.stopFrameStats();
    expect(host.calls.at(-1)).toEqual(['stopFrameStats']);
    engine.destroy();
    await expect(engine.readFrameStats()).rejects.toThrow(/not running/);
  });

  it('hands engine faults to the shell', async () => {
    const onFault = vi.fn();
    const { host } = await mountOnFakeHost({ options: { onFault } });
    const fault = new Error('the worker crashed');
    host.emitFault(fault);
    expect(onFault).toHaveBeenCalledWith(fault);
  });

  it('keeps frame diagnostics scoped to the mounted host lifetime', async () => {
    const { host, engine } = await mountOnFakeHost({
      beforeStart: (mounted) => {
        expect(mounted.frameTimesMs()).toEqual([]);
      },
    });
    expect(engine.frameTimesMs()).toEqual([0]);
    host.emitFrame(START_CAMERA);
    expect(engine.frameTimesMs()).toEqual([0, 0]);
    engine.destroy();
    host.emitFrame(START_CAMERA);
    expect(engine.frameTimesMs()).toEqual([0, 0]);
  });

  it("hands engine faults to the page's reportError when the shell gives no handler", async () => {
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    const { host } = await mountOnFakeHost();
    const fault = new Error('the frame threw');
    host.emitFault(fault);
    expect(reportError).toHaveBeenCalledWith(fault);
  });

  it('rejects ready and captures when the host cannot start', async () => {
    const failure = new Error('no GPU');
    const mount = createEngineHostMount({
      prefer: 'worker',
      startHost: () => Promise.reject(failure),
    });
    const engine = mount(document.createElement('canvas'), { viewport: VIEWPORT });
    const capture = engine.capturePixels({ xPx: 0, yPx: 0, widthPx: 1, heightPx: 1 });
    await expect(engine.ready).rejects.toBe(failure);
    await expect(capture).rejects.toBe(failure);
    engine.destroy();
  });

  it('edits a given document with a given history, which it leaves alive when unmounted', async () => {
    const store = createDemoDocument();
    const history = {
      undo: vi.fn(() => true),
      redo: vi.fn(() => true),
      canUndo: () => true,
      canRedo: () => false,
    };
    const { engine } = await mountOnFakeHost({ options: { store, history } });
    engine.runCanvasAction({ type: 'history', command: 'undo' });
    engine.runCanvasAction({ type: 'history', command: 'redo' });
    expect([history.undo.mock.calls.length, history.redo.mock.calls.length]).toEqual([1, 1]);
    engine.destroy();
    expect(store.read().objects.size).toBeGreaterThan(0);
    store.destroy();
  });

  it('sends no camera when a fit would not move it', async () => {
    const { host, engine } = await mountOnFakeHost({ isReducedMotion: true });
    engine.runCanvasAction({ type: 'navigate', command: 'zoomToFit' });
    const fitted = engine.camera();
    host.calls.length = 0;
    engine.runCanvasAction({ type: 'navigate', command: 'zoomToFit' });
    expect(host.calls).toEqual([]);
    expect(engine.camera()).toBe(fitted);
  });

  it('forwards pointer events, and on destroy stops everything and frees the host', async () => {
    const { host, engine, canvas, cleanupReady } = await mountOnFakeHost();
    canvas.dispatchEvent(new PointerEvent('pointerdown', { buttons: 1 }));
    engine.inspect();
    expect(host.inputs.map(({ type }) => type)).toEqual(['down']);
    engine.destroy();
    engine.destroy();
    expect(cleanupReady).toHaveBeenCalledTimes(1);
    expect(host.listeners.size).toBe(0);
    expect(host.faultListeners.size).toBe(0);
    canvas.dispatchEvent(new PointerEvent('pointerdown', { buttons: 1 }));
    engine.inspect();
    expect(host.inputs).toHaveLength(1);
    await vi.runAllTimersAsync();
    expect(host.isDestroyed).toBe(true);
    await expect(engine.capturePixels({ xPx: 0, yPx: 0, widthPx: 1, heightPx: 1 })).rejects.toThrow(
      /unmounted/,
    );
  });

  it('measures the canvas when the shell gives no size yet', async () => {
    const { host } = await mountOnFakeHost({ isViewportGiven: false });
    expect(host.calls[0]).toEqual(['resize', 400, 200, window.devicePixelRatio]);
  });

  it("pans the host's camera from the canvas's own wheel input", async () => {
    const { host, engine, canvas } = await mountOnFakeHost();
    host.calls.length = 0;
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 30, deltaY: 40, cancelable: true }));
    expect(host.calls.map(([method]) => method)).toEqual(['setCamera']);
    expect(engine.camera()).toMatchObject({ x: 30, y: 40 });
  });
});
