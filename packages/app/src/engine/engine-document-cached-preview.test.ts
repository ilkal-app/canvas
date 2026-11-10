// Ruling 9 through `createEngineDocument`, a real store and its page view: a page
// showing an instance of a main on another page captures a cached projection that restores to
// the scene the live feed draws, without storing a virtual id.
import { describe, expect, it, vi } from 'vitest';

import { findCommand, runCommand, YjsDocumentStore, type DocumentStore } from '@canvas/document';
import {
  isVirtualObjectId,
  visibleWorldBounds,
  type Camera,
  type EngineHost,
  type PreviewCertificate,
  type SceneChangeSet,
} from '@canvas/engine';
import type { BoardObject, ObjectId, PageId } from '@canvas/schema';

import { readCachedProjection } from '../collab/cached-projection.js';
import { captureCachedProjection } from '../collab/capture-cached-projection.js';
import { expandPreviewScene } from '../collab/instance-projection.js';

import { createEngineDocument } from './create-engine-document.js';
import { LOCAL_USER_ORIGIN } from './demo-document.js';
import type { EngineDocumentView } from './engine-document.js';
import { enqueueHostScene } from './host-scene-stream.js';

const CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 1200,
  viewportHeightPx: 800,
  dpr: 1,
};
const ENVIRONMENT = { clock: () => 1_790_000_000_000, createId: () => 'unused' as ObjectId };
const IDENTITY = { boardId: 'board', camera: CAMERA, fontSetKey: 'font-sha' };

function run(store: DocumentStore, name: string, input: unknown): unknown {
  const command = findCommand(name);
  if (command === undefined) throw new Error(`no command ${name}`);
  const outcome = runCommand(store, LOCAL_USER_ORIGIN, command, input as never, ENVIRONMENT);
  if (outcome.status !== 'applied') throw new Error(`${name} refused: ${JSON.stringify(outcome)}`);
  return outcome.result;
}

function rect(id: string, x: number, y: number): BoardObject {
  return {
    id: id as ObjectId,
    type: 'shape',
    parentId: null,
    x,
    y,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: LOCAL_USER_ORIGIN.principalId,
    createdAt: 1,
    updatedAt: 1,
    width: 80,
    height: 40,
    kind: 'rectangle',
    cornerRadius: 0,
    sides: 4,
    label: null,
    stroke: null,
    fill: [1, 0, 0, 1],
  };
}

/**
 * The main `main` (`title`, `body`) on the first page; on a second page, shown, the instance
 * `inst` and a plain shape `plain`.
 *
 * @returns The store, the mount and the scene the recorded feed holds.
 */
function mounted() {
  const store = new YjsDocumentStore();
  store.transact(LOCAL_USER_ORIGIN, (tx) => {
    tx.setObject(rect('title', 100, 100));
    tx.setObject(rect('body', 100, 160));
  });
  run(store, 'createComponent', { ids: ['title', 'body'], name: 'Card', componentId: 'main' });
  const { pageId } = run(store, 'addPage', {}) as { pageId: PageId };
  run(store, 'createInstance', { componentId: 'main', x: 400, y: 300, pageId, instanceId: 'inst' });
  store.transact(LOCAL_USER_ORIGIN, (tx) => {
    tx.setObject({ ...rect('plain', 20, 20), pageId });
  });
  const { document, pages } = createEngineDocument({ store }, () => undefined);
  const scene = new Map<string, BoardObject>();
  const view: EngineDocumentView = {
    enqueue: (changes: SceneChangeSet) => {
      for (const id of [...changes.created, ...changes.updated, ...changes.deleted]) {
        const object = changes.get(id);
        if (object === undefined) scene.delete(id);
        else scene.set(id, object);
      }
    },
    showOverlay: () => undefined,
  };
  document.attach(view);
  pages.show(pageId);
  return { store, document, scene };
}

function hostCertifying(candidates: readonly string[]) {
  const host = {
    applyChangeSet: vi.fn(),
    readPreviewCertificate: vi.fn(() => Promise.resolve(certificate)),
  } as unknown as EngineHost;
  const scene = enqueueHostScene(host, { created: [], updated: [], deleted: [], objects: {} });
  const certificate: PreviewCertificate = {
    scene,
    camera: CAMERA,
    coverage: visibleWorldBounds(CAMERA),
    fontSetKey: 'font-sha',
    candidates: candidates as ObjectId[],
    assets: [],
    imagePlanKey: '[]',
    lodPlanKey: '[]',
    frameIndex: 1,
    resourceGeneration: 1,
  };
  return host;
}

describe('the cached preview of a page showing an instance', () => {
  it('restores the scene the live feed draws, the main from another page', async () => {
    const { store, document, scene } = mounted();
    expect(scene.has('inst/title')).toBe(true);
    const source = document.captureProjectionSource();
    expect(source?.definitions?.objects.has('main' as ObjectId)).toBe(true);
    if (source === undefined) throw new Error('no source');
    const bytes = await captureCachedProjection(hostCertifying([...scene.keys()]), {
      ...IDENTITY,
      ...source,
    });
    if (bytes === undefined) throw new Error('nothing captured');
    const text = new TextDecoder().decode(bytes);
    for (const id of scene.keys()) if (isVirtualObjectId(id)) expect(text).not.toContain(`"${id}"`);
    const restored = readCachedProjection(bytes, IDENTITY);
    if (restored === undefined) throw new Error('not restored');
    const changes = expandPreviewScene([...restored.board.objects.values()], restored.shownIds);
    expect(new Map(changes.created.map((id) => [id, changes.get(id)]))).toEqual(scene);
    document.destroy();
    store.destroy();
  });

  it('ends the capture on an edit to the main on another page', () => {
    const { store, document } = mounted();
    const source = document.captureProjectionSource();
    expect(source?.isCurrent()).toBe(true);
    run(store, 'setStyle', { changes: [{ id: 'title', style: { fill: [0, 1, 0, 1] } }] });
    expect(source?.isCurrent()).toBe(false);
    document.destroy();
    store.destroy();
  });

  it('captures no definitions for a page without instances', () => {
    const { store, document } = mounted();
    run(store, 'deleteObjects', { ids: ['inst'] });
    const source = document.captureProjectionSource();
    expect(source?.board.objects.size).toBe(1);
    expect(source && 'definitions' in source).toBe(false);
    document.destroy();
    store.destroy();
  });
});
