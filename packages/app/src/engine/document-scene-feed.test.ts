import { describe, expect, it, vi } from 'vitest';

import {
  moveObjectsCommand,
  runCommand,
  setColorTokenCommand,
  SYSTEM_ORIGIN,
} from '@canvas/document';
import { SceneRenderer, type SceneSource } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { FakeGpuBackend } from './__fixtures__/fake-gpu-backend.js';
import { createDemoDocument } from './demo-document.js';
import { DocumentHitIndex } from './document-hit-index.js';
import { DocumentSceneFeed } from './document-scene-feed.js';

const MARKER = 'section-0-rect-0-0' as ObjectId;
const CAMERA = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };
const ENVIRONMENT = { clock: () => 1_790_000_000_000, createId: () => 'new' as ObjectId };

function setUp() {
  const store = createDemoDocument();
  const preview = new Map<ObjectId, BoardObject>();
  const source: SceneSource = { get: (id) => preview.get(id) ?? store.get(id) };
  const onChange = vi.fn();
  const feed = new DocumentSceneFeed(store, source, new DocumentHitIndex(store), onChange);
  const backend = new FakeGpuBackend();
  const renderer = new SceneRenderer(backend);
  const moveMarker = () =>
    runCommand(
      store,
      SYSTEM_ORIGIN,
      moveObjectsCommand,
      { moves: [{ id: MARKER, by: { x: 1000, y: 0 } }] },
      ENVIRONMENT,
    );
  return { store, preview, feed, renderer, onChange, moveMarker };
}

describe('DocumentSceneFeed', () => {
  it('replaces a cached scene with current live objects and removes cached-only ids', () => {
    const { store, feed, renderer, moveMarker } = setUp();
    const deleted = 'cached-only' as ObjectId;
    moveMarker();
    feed.attach(renderer, [MARKER, deleted]);
    const changes = renderer.changes.drain();
    expect(changes?.deleted).toEqual([deleted]);
    expect(changes?.created).not.toContain(MARKER);
    expect(changes?.updated).toContain(MARKER);
    expect(changes?.get(MARKER)).toBe(store.get(MARKER));
    moveMarker();
    expect(renderer.changes.drain()?.updated).toEqual([MARKER]);
    feed.destroy();
    store.destroy();
  });

  it('keeps the hit-test index in step with the document at once, without a frame', () => {
    const { feed, onChange, moveMarker } = setUp();
    expect(feed.hitIndex.searchPoint({ x: 60, y: 60 })).toContain(MARKER);
    moveMarker();
    expect(feed.hitIndex.searchPoint({ x: 60, y: 60 })).not.toContain(MARKER);
    expect(feed.hitIndex.searchPoint({ x: 1060, y: 60 })).toContain(MARKER);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('logs every change set as plain data', () => {
    const { feed, moveMarker } = setUp();
    moveMarker();
    expect(feed.changes).toEqual([
      { originKind: 'system', created: [], updated: [MARKER], deleted: [] },
    ]);
  });

  it('feeds the renderer the whole document, then changes and previews through the source', () => {
    const { store, preview, feed, renderer, moveMarker } = setUp();
    moveMarker();
    feed.attach(renderer);
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    expect(renderer.scene.objectCount).toBe(store.read().objects.size);
    moveMarker();
    const moved = renderer.changes.drain();
    expect(moved?.updated).toEqual([MARKER]);
    expect(moved?.get(MARKER)).toBe(store.get(MARKER));
    const marker = store.get(MARKER);
    if (marker === undefined) throw new Error('no marker');
    const previewed = { ...marker, x: 0 };
    preview.set(MARKER, previewed);
    feed.previewChanged([MARKER]);
    feed.previewChanged([]);
    const drained = renderer.changes.drain();
    expect(drained?.updated).toEqual([MARKER]);
    expect(drained?.get(MARKER)).toBe(previewed);
  });

  it('creates a preview of an object the document lacks, then updates, deletes or adopts it', () => {
    const { store, preview, feed, renderer } = setUp();
    feed.attach(renderer);
    renderer.changes.drain();
    const marker = store.get(MARKER);
    if (marker === undefined) throw new Error('no marker');
    const draft = { ...marker, id: 'draft' as ObjectId };
    preview.set(draft.id, draft);
    feed.previewChanged([draft.id]);
    expect(renderer.changes.drain()).toMatchObject({ created: [draft.id], updated: [] });
    feed.previewChanged([draft.id]);
    expect(renderer.changes.drain()).toMatchObject({ created: [], updated: [draft.id] });
    preview.delete(draft.id);
    feed.previewChanged([draft.id]);
    expect(renderer.changes.drain()).toMatchObject({ created: [], deleted: [draft.id] });
    // Shown again, then created in the document: the renderer has it, so it is an update.
    preview.set(draft.id, draft);
    feed.previewChanged([draft.id]);
    renderer.changes.drain();
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.setObject(draft);
    });
    expect(renderer.changes.drain()).toMatchObject({ created: [], updated: [draft.id] });
  });

  it('removes a previewed object the document deleted once its preview ends', () => {
    const { store, preview, feed, renderer } = setUp();
    feed.attach(renderer);
    renderer.changes.drain();
    const marker = store.get(MARKER);
    if (marker === undefined) throw new Error('no marker');
    // The eraser fades a stroke through a preview under its id; a peer deletes it meanwhile.
    preview.set(MARKER, { ...marker, x: marker.x + 1 });
    feed.previewChanged([MARKER]);
    renderer.changes.drain();
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.deleteObject(MARKER);
    });
    renderer.changes.drain();
    preview.delete(MARKER);
    feed.previewChanged([MARKER]);
    const ended = renderer.changes.drain();
    expect(ended?.deleted).toEqual([MARKER]);
    expect(ended?.get(MARKER)).toBeUndefined();
  });

  it('takes a stored object a preview hides out of the scene, holding its edits until shown', () => {
    const store = createDemoDocument();
    const hidden = new Set<ObjectId>();
    const source: SceneSource = { get: (id) => (hidden.has(id) ? undefined : store.get(id)) };
    const feed = new DocumentSceneFeed(store, source, new DocumentHitIndex(store), vi.fn());
    const renderer = new SceneRenderer(new FakeGpuBackend());
    feed.attach(renderer);
    renderer.changes.drain();
    hidden.add(MARKER);
    feed.previewChanged([MARKER]);
    expect(renderer.changes.drain()).toMatchObject({ deleted: [MARKER], updated: [] });
    // Hidden again: nothing more to remove. A document edit to it waits.
    feed.previewChanged([MARKER]);
    expect(renderer.changes.drain()?.deleted ?? []).toEqual([]);
    runCommand(
      store,
      SYSTEM_ORIGIN,
      moveObjectsCommand,
      { moves: [{ id: MARKER, by: { x: 10, y: 0 } }] },
      ENVIRONMENT,
    );
    expect(renderer.changes.drain()?.updated ?? []).not.toContain(MARKER);
    // Shown again: back in the scene as the document holds it.
    hidden.delete(MARKER);
    feed.previewChanged([MARKER]);
    const shown = renderer.changes.drain();
    expect(shown?.created).toEqual([MARKER]);
    expect(shown?.get(MARKER)).toBe(store.get(MARKER));
  });

  it('keeps an object a preview hides out of hit testing until it shows again', () => {
    const store = createDemoDocument();
    const hidden = new Set<ObjectId>();
    const source: SceneSource = { get: (id) => (hidden.has(id) ? undefined : store.get(id)) };
    const hits = new DocumentHitIndex(store);
    const feed = new DocumentSceneFeed(store, source, hits, vi.fn());
    hidden.add(MARKER);
    feed.previewChanged([MARKER]);
    expect(hits.get(MARKER)).toBeUndefined();
    expect(hits.isDrawable(MARKER)).toBe(false);
    hidden.delete(MARKER);
    feed.previewChanged([MARKER]);
    expect(hits.get(MARKER)).toBe(store.get(MARKER));
    expect(hits.isDrawable(MARKER)).toBe(true);
  });

  it('does not delete twice an object deleted while a preview hides it', () => {
    const store = createDemoDocument();
    const hidden = new Set<ObjectId>([MARKER]);
    const source: SceneSource = { get: (id) => (hidden.has(id) ? undefined : store.get(id)) };
    const feed = new DocumentSceneFeed(store, source, new DocumentHitIndex(store), vi.fn());
    const renderer = new SceneRenderer(new FakeGpuBackend());
    feed.attach(renderer);
    renderer.changes.drain();
    feed.previewChanged([MARKER]);
    renderer.changes.drain();
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.deleteObject(MARKER);
    });
    expect(renderer.changes.drain()?.deleted ?? []).not.toContain(MARKER);
  });

  it('leaves an object past the drawable extent, and its children, out of the hit-test index', () => {
    const { store, feed } = setUp();
    const marker = store.get(MARKER);
    if (marker === undefined) throw new Error('no marker');
    const before = feed.hitIndex.bounds;
    // A place no command makes (bounds them), as a peer can write it past the commands.
    const far: BoardObject = {
      id: 'far' as ObjectId,
      parentId: null,
      x: 1e308,
      y: marker.y,
      rotation: 0,
      z: marker.z,
      locked: false,
      createdBy: marker.createdBy,
      createdAt: marker.createdAt,
      updatedAt: marker.updatedAt,
      type: 'frame',
      width: 100,
      height: 100,
      name: 'Far',
      clip: false,
      background: null,
    };
    const child = { ...marker, id: 'far-child' as ObjectId, parentId: far.id, x: 10, y: 10 };
    store.transact(SYSTEM_ORIGIN, (transaction) => {
      transaction.setObject(far);
      transaction.setObject(child);
    });
    expect(store.get(far.id)).toBeDefined();
    expect(feed.hitIndex.boundsOf(far.id)).toBeUndefined();
    expect(feed.hitIndex.boundsOf(child.id)).toBeUndefined();
    // Zoom to fit still frames the honest board.
    expect(feed.hitIndex.bounds).toEqual(before);
    // Moved back within reach, the frame and its child are indexed again.
    runCommand(
      store,
      SYSTEM_ORIGIN,
      moveObjectsCommand,
      { moves: [{ id: far.id, by: { x: -1e308, y: 0 } }] },
      ENVIRONMENT,
    );
    expect(feed.hitIndex.boundsOf(far.id)).toBeDefined();
    expect(feed.hitIndex.boundsOf(child.id)).toBeDefined();
  });

  it('stops following the document once destroyed', () => {
    const { feed, onChange, moveMarker } = setUp();
    feed.destroy();
    moveMarker();
    expect(onChange).not.toHaveBeenCalled();
    expect(feed.changes).toEqual([]);
  });
});

it('certifies only immutable authoritative objects and invalidates on previews, edits or teardown', () => {
  const { store, preview, feed, moveMarker } = setUp();
  const captured = feed.captureProjectionSource();
  expect(captured?.isCurrent()).toBe(true);
  const marker = store.get(MARKER);
  if (marker === undefined) throw new Error('Missing marker.');
  preview.set(MARKER, { ...marker, x: marker.x + 10 });
  feed.previewChanged([MARKER]);
  expect(captured?.isCurrent()).toBe(false);
  expect(feed.captureProjectionSource()).toBeUndefined();
  preview.delete(MARKER);
  feed.previewChanged([MARKER]);
  const restored = feed.captureProjectionSource();
  expect(restored?.isCurrent()).toBe(true);
  const draft = { ...marker, id: 'draft-preview' as ObjectId };
  preview.set(draft.id, draft);
  feed.previewChanged([draft.id]);
  expect(feed.captureProjectionSource()).toBeUndefined();
  preview.delete(draft.id);
  feed.previewChanged([draft.id]);
  const beforeEdit = feed.captureProjectionSource();
  moveMarker();
  expect(beforeEdit?.isCurrent()).toBe(false);
  expect(beforeEdit?.board.objects.get(MARKER)).toBe(marker);
  const beforeDestroy = feed.captureProjectionSource();
  feed.destroy();
  expect(beforeDestroy?.isCurrent()).toBe(false);
  store.destroy();
});

it('sends the board’s colour tokens on attach and after a change set naming tokens', () => {
  const { store, feed, renderer, onChange } = setUp();
  const setColorTokens = vi.spyOn(renderer, 'setColorTokens');
  feed.attach(renderer);
  expect(setColorTokens).toHaveBeenCalledTimes(1);
  expect(setColorTokens.mock.calls[0]?.[0].size).toBe(0);
  onChange.mockClear();
  runCommand(
    store,
    SYSTEM_ORIGIN,
    setColorTokenCommand,
    { id: 'accent', name: 'accent', light: [1, 0, 0, 1], dark: [0, 0, 1, 1] },
    ENVIRONMENT,
  );
  expect(setColorTokens).toHaveBeenCalledTimes(2);
  expect(setColorTokens.mock.calls[1]?.[0].get('accent')).toMatchObject({ light: [1, 0, 0, 1] });
  expect(onChange).toHaveBeenCalled();
  feed.destroy();
  store.destroy();
});
