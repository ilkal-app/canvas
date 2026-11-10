// @vitest-environment jsdom
// Ruling 9: a restored projection with instances draws the scene the live feed draws,
// and the live handoff takes over its virtual objects as updates.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';
import {
  isVirtualObjectId,
  type EngineHost,
  type SceneProjection,
  type SerializableChangeSet,
} from '@canvas/engine';
import { DEFAULT_PAGE, type Board, type BoardObject, type ObjectId } from '@canvas/schema';

import { instanceBoard, liveScene, MAINS_PAGE } from '../collab/__fixtures__/instance-board.js';

import { FakeHost, START_CAMERA, VIEWPORT } from './__fixtures__/fake-engine-host.js';
import { LOCAL_USER_ORIGIN } from './demo-document.js';
import { mountEnginePreview, type MountedEnginePreview } from './mount-engine-preview.js';

const previews: MountedEnginePreview[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
});
afterEach(async () => {
  for (const preview of previews.splice(0)) preview.destroy();
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** The restored projection: the page's drawn owners plus the mains' closure. */
const SHOWN = new Set(['plain', 'inst', 'nest', 'late'] as ObjectId[]);
const CLOSURE = ['gone', 'old', 'shelf', 'main', 'title', 'photo', 'outer', 'inner'];

function restored(board: Board): BoardObject[] {
  return [...board.objects.values()].filter(
    (object) => SHOWN.has(object.id) || CLOSURE.includes(object.id),
  );
}

function setup(objects: readonly BoardObject[], shownIds?: ReadonlySet<ObjectId>) {
  const host = new FakeHost();
  const pending: ((value: SceneProjection | undefined) => void)[] = [];
  const readProjection = vi.fn(
    () =>
      new Promise<SceneProjection | undefined>((resolve) => {
        pending.push(resolve);
      }),
  );
  const engineHost = Object.assign(host, { readProjection }) as unknown as EngineHost;
  const canvas = document.createElement('canvas');
  Object.assign(canvas, { setPointerCapture: () => undefined });
  document.body.append(canvas);
  const preview = mountEnginePreview(
    canvas,
    {
      objects,
      ...(shownIds === undefined ? {} : { shownIds }),
      camera: START_CAMERA,
      viewport: VIEWPORT,
      isGridVisible: false,
    },
    { prefer: 'worker', startHost: () => Promise.resolve(engineHost) },
  );
  previews.push(preview);
  const confirm = async () => {
    await vi.waitFor(() => {
      expect(pending.length).toBeGreaterThan(0);
    });
    pending.shift()?.({ camera: START_CAMERA, candidates: [], hasPendingWork: false });
  };
  return { host, pending, preview, confirm };
}

function drawn(changes: SerializableChangeSet | undefined): Map<string, unknown> {
  return new Map((changes?.created ?? []).map((id) => [id, changes?.objects[id]]));
}

it('draws instances through the expansion, as the live feed does, without off-page or retired mains', async () => {
  const board = instanceBoard();
  const { host, confirm, preview } = setup(restored(board), SHOWN);
  await confirm();
  await preview.ready;
  expect(host.changeSets).toHaveLength(1);
  const scene = drawn(host.changeSets[0]);
  expect(scene).toEqual(liveScene(board));
  expect(scene.has('inst/photo')).toBe(true);
  expect(scene.has('nest/inner/title')).toBe(true);
  expect(scene.has('late/old')).toBe(true);
  for (const id of ['main', 'outer', 'shelf', 'gone', 'old', 'title'])
    expect(scene.has(id)).toBe(false);
});

it('draws every object without shown ids, unchanged for a projection without instances', async () => {
  const objects = [...instanceBoard().objects.values()].filter((object) => object.type === 'shape');
  const { host, confirm, preview } = setup(objects);
  await confirm();
  await preview.ready;
  expect(host.changeSets[0]?.created).toEqual(objects.map((object) => object.id));
  expect(host.changeSets[0]?.updated).toEqual([]);
});

it('hands virtual objects to the live document as updates', async () => {
  const board = instanceBoard();
  const store = new YjsDocumentStore();
  store.transact(LOCAL_USER_ORIGIN, (tx) => {
    const creation = { createdBy: LOCAL_USER_ORIGIN.principalId, createdAt: 1 };
    tx.setPage(DEFAULT_PAGE, creation);
    tx.setPage(MAINS_PAGE, creation);
    for (const object of board.objects.values()) tx.setObject(object);
  });
  const { host, confirm, preview, pending } = setup(restored(board), SHOWN);
  await confirm();
  await preview.ready;
  const shown = [...drawn(host.changeSets[0]).keys()];
  const live = preview.attachLive({ store });
  await vi.waitFor(() => {
    expect(pending).toHaveLength(1);
  });
  const handoff = host.changeSets.at(-1);
  const virtual = shown.filter(isVirtualObjectId);
  expect(virtual.length).toBeGreaterThan(0);
  expect(handoff?.updated).toEqual(expect.arrayContaining(virtual));
  expect(handoff?.created.filter(isVirtualObjectId)).toEqual([]);
  expect(handoff?.deleted).toEqual([]);
  await confirm();
  (await live).destroy();
  store.destroy();
});

it('clears virtual objects with the rest when a resize invalidates the preview', async () => {
  const board = instanceBoard();
  const { host, confirm, preview } = setup(restored(board), SHOWN);
  await confirm();
  await preview.ready;
  preview.resize({ ...VIEWPORT, widthPx: 600, cssWidthPx: 600 });
  await Promise.resolve();
  expect(host.changeSets.at(-1)?.deleted).toEqual(host.changeSets[0]?.created);
});
