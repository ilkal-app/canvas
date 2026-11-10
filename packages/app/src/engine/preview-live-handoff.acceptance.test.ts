// @vitest-environment jsdom
// Acceptance, owner area "verified handoff before editing is enabled": the cached preview
// is inert; editing stays refused until the live store has taken over and the caller applies the
// authenticated role; after the handoff the scene on the canvas equals the live document, peer
// edits made during hydration included, with no object missing or duplicated; and undo history
// starts empty. These promises already hold; each
// test names what would break it. Driven through the existing mountEnginePreview on a fake host.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  moveObjectsCommand,
  runCommand,
  SYSTEM_ORIGIN,
  type YjsDocumentStore,
} from '@canvas/document';
import type { EngineHost, SceneProjection, SerializableChangeSet } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { FakeHost, MARKER, START_CAMERA, VIEWPORT } from './__fixtures__/fake-engine-host.js';
import { createDemoDocument, writeBoard } from './demo-document.js';
import { mountEnginePreview, type MountedEnginePreview } from './mount-engine-preview.js';
import type { MountedEngine } from './mounted-engine.js';

const previews: MountedEnginePreview[] = [];
const stores: YjsDocumentStore[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
});
afterEach(async () => {
  for (const preview of previews.splice(0)) preview.destroy();
  for (const store of stores.splice(0)) store.destroy();
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

// Folds what the host was told to draw into the scene it shows, noting missing/duplicate ids.
function visibleScene(changeSets: readonly SerializableChangeSet[]) {
  const scene = new Map<string, unknown>();
  const anomalies: string[] = [];
  for (const changes of changeSets) {
    for (const id of changes.deleted) {
      if (!scene.delete(id)) anomalies.push(`deleted missing ${id}`);
    }
    for (const id of changes.created) {
      if (scene.has(id)) anomalies.push(`duplicate ${id}`);
      scene.set(id, changes.objects[id]);
    }
    for (const id of changes.updated) {
      if (!scene.has(id)) anomalies.push(`updated missing ${id}`);
      scene.set(id, changes.objects[id]);
    }
  }
  return { scene, anomalies };
}

function documentScene(store: YjsDocumentStore): Map<string, unknown> {
  return new Map([...store.read().objects].map(([id, object]) => [id, object]));
}

function peerMove(store: YjsDocumentStore, id: ObjectId, x: number, y: number): void {
  const outcome = runCommand(
    store,
    SYSTEM_ORIGIN,
    moveObjectsCommand,
    { moves: [{ id, by: { x, y } }] },
    { clock: () => 1, createId: () => id },
  );
  expect(outcome.status).not.toBe('rejected');
}

// A preview of the snapshot, plus one object a peer has since deleted.
function setup() {
  const host = new FakeHost();
  const pending: ((value: SceneProjection | undefined) => void)[] = [];
  const readProjection = vi.fn(
    () =>
      new Promise<SceneProjection | undefined>((resolve) => {
        pending.push(resolve);
      }),
  );
  const startHost = vi.fn(() =>
    Promise.resolve(Object.assign(host, { readProjection }) as unknown as EngineHost),
  );
  const canvas = document.createElement('canvas');
  Object.assign(canvas, { setPointerCapture: () => undefined });
  document.body.append(canvas);
  const store = createDemoDocument();
  stores.push(store);
  const snapshot = [...store.read().objects.values()];
  const first = snapshot[0];
  if (first === undefined) throw new Error('fixture is empty');
  const deletedByPeer = { ...first, id: 'deleted-by-peer' as ObjectId, parentId: null };
  const preview = mountEnginePreview(
    canvas,
    {
      objects: [...snapshot, deletedByPeer],
      camera: START_CAMERA,
      viewport: VIEWPORT,
      isGridVisible: false,
    },
    { prefer: 'worker', startHost },
  );
  previews.push(preview);
  const acknowledge = async (): Promise<void> => {
    await vi.waitFor(() => {
      expect(pending.length).toBeGreaterThan(0);
    });
    pending.shift()?.({ camera: START_CAMERA, candidates: [], hasPendingWork: false });
  };
  const handOff = async (): Promise<MountedEngine> => {
    const live = preview.attachLive({ store });
    await vi.waitFor(() => {
      expect(pending.length).toBeGreaterThan(0);
    });
    host.emitFrame(START_CAMERA);
    await acknowledge();
    return live;
  };
  const press = () => {
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 60, clientY: 60 }),
    );
  };
  return { host, store, preview, startHost, acknowledge, handOff, press, first };
}

// Breaks if the preview forwards input, or if input queued during the preview is replayed into
// the live document after the handoff.
it('keeps the preview inert and accepts no edit made before the handoff', async () => {
  const { host, store, preview, acknowledge, handOff, press } = setup();
  const before = documentScene(store);
  press();
  await acknowledge();
  await preview.ready;
  press();
  const live = await handOff();
  expect(host.inputs).toEqual([]);
  expect(documentScene(store)).toEqual(before);
  expect(live.inspect().selectedIds).toEqual([]);
  expect(live.inspect().changeSets).toEqual([]);
  // Control: the same press on the live engine does reach it.
  press();
  expect(live.inspect().selectedIds.length).toBeGreaterThan(0);
});

// Breaks if the handoff hands back an engine that already edits.
it('refuses edits from the live engine until the authenticated role enables editing', async () => {
  const { store, acknowledge, handOff } = setup();
  await acknowledge();
  const live = await handOff();
  const count = store.read().objects.size;
  live.runCanvasAction({ type: 'selection', command: 'selectAll' });
  live.runCanvasAction({ type: 'selection', command: 'delete' });
  expect(store.read().objects.size).toBe(count);
  live.setEditable(true);
  live.runCanvasAction({ type: 'selection', command: 'selectAll' });
  live.runCanvasAction({ type: 'selection', command: 'delete' });
  expect(store.read().objects.size).toBeLessThan(count);
});

// Breaks if a peer edit during hydration or before the live frame is dropped, if the cached-only
// object survives, or if any object is drawn twice or updated before it exists.
it('shows exactly the live document after the handoff, with every peer edit and no duplicate', async () => {
  const { host, store, preview, startHost, acknowledge, first } = setup();
  await acknowledge();
  peerMove(store, MARKER as ObjectId, 37, 19);
  const added: BoardObject = { ...first, id: 'added-by-peer' as ObjectId, parentId: null };
  writeBoard(store, [added]);
  const handoff = preview.attachLive({ store });
  // A peer edit between the live scene's submission and its acknowledged frame.
  peerMove(store, first.id, -11, 5);
  await acknowledge();
  await handoff;
  await vi.waitFor(() => {
    expect(visibleScene(host.changeSets).scene).toEqual(documentScene(store));
  });
  expect(visibleScene(host.changeSets).anomalies).toEqual([]);
  expect(visibleScene(host.changeSets).scene.has('deleted-by-peer')).toBe(false);
  expect(startHost).toHaveBeenCalledTimes(1);
});

// Breaks if hydration or the scene swap is recorded as a local, undoable edit.
it('starts undo history empty after the handoff, so undo cannot revert hydrated or peer data', async () => {
  const { store, acknowledge, handOff } = setup();
  await acknowledge();
  peerMove(store, MARKER as ObjectId, 37, 19);
  const live = await handOff();
  const hydrated = documentScene(store);
  live.setEditable(true);
  live.runCanvasAction({ type: 'history', command: 'undo' });
  live.runCanvasAction({ type: 'history', command: 'redo' });
  expect(documentScene(store)).toEqual(hydrated);
  expect(live.inspect().changeSets).toEqual([]);
});
