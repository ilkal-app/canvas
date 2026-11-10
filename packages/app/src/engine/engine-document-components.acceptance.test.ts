// Acceptance, second slice: the
// non-UI app wiring. The engine side of a mount (`createEngineDocument`, a real store, the
// page-scoped view) feeds the renderer instance content resolved over the whole board, so a main
// on another page renders and its edits arrive; a retired main is neither drawn nor hit; a click
// on instance content selects the real instance; the cached preview refuses a virtual candidate.
import { describe, expect, it } from 'vitest';

import { findCommand, runCommand, YjsDocumentStore, type DocumentStore } from '@canvas/document';
import type { Camera, SceneChangeSet } from '@canvas/engine';
import { resolveInstance, type BoardObject, type ObjectId, type PageId } from '@canvas/schema';

import { previewObjects } from '../collab/preview-objects.js';

import { createEngineDocument } from './create-engine-document.js';
import { LOCAL_USER_ORIGIN } from './demo-document.js';
import type { EngineDocumentView } from './engine-document.js';

const CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 1200,
  viewportHeightPx: 800,
  dpr: 1,
};
const ENVIRONMENT = { clock: () => 1_790_000_000_000, createId: () => 'unused' as ObjectId };

function run(store: DocumentStore, name: string, input: unknown): unknown {
  const command = findCommand(name);
  if (command === undefined) throw new Error(`no command ${name}`);
  const outcome = runCommand(store, LOCAL_USER_ORIGIN, command, input as never, ENVIRONMENT);
  if (outcome.status !== 'applied') throw new Error(`${name} refused: ${JSON.stringify(outcome)}`);
  return outcome.result;
}

function rect(id: string, x: number, y: number, fill: readonly number[]): BoardObject {
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
    fill: [fill[0] ?? 0, fill[1] ?? 0, fill[2] ?? 0, fill[3] ?? 1],
  };
}

/**
 * A main `main` (shapes `title` and `body`) on the first page at (100, 100), and on a second
 * page an instance `inst` at (400, 300); the engine side mounted, the first page shown.
 *
 * @returns The store, the mount, the second page and the scene the recorded feed holds.
 */
function mounted() {
  const store = new YjsDocumentStore();
  store.transact(LOCAL_USER_ORIGIN, (tx) => {
    tx.setObject(rect('title', 100, 100, [1, 0, 0, 1]));
    tx.setObject(rect('body', 100, 160, [0, 0, 1, 1]));
  });
  run(store, 'createComponent', { ids: ['title', 'body'], name: 'Card', componentId: 'main' });
  const { pageId } = run(store, 'addPage', {}) as { pageId: PageId };
  run(store, 'createInstance', { componentId: 'main', x: 400, y: 300, pageId, instanceId: 'inst' });
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
  return { store, document, pages, pageId, scene };
}

function click(document: ReturnType<typeof mounted>['document'], x: number, y: number): void {
  for (const kind of ['pointerDown', 'pointerUp'] as const) {
    document.handlePointer(
      { kind, screen: { x, y }, isShiftPressed: false, isModPressed: false },
      CAMERA,
    );
  }
}

function resolvedOf(store: DocumentStore, instanceId: string): Map<string, BoardObject> {
  const instance = store.get(instanceId as ObjectId);
  if (instance?.type !== 'instance') throw new Error(`no instance ${instanceId}`);
  return new Map(
    resolveInstance(store.read(), instance).objects.map((object) => [object.id, object]),
  );
}

describe('the engine side of a mount, with components', () => {
  it('renders an instance whose main is on another page, and follows the main’s edits', () => {
    const { store, document, pages, pageId, scene } = mounted();
    pages.show(pageId);
    const expected = resolvedOf(store, 'inst');
    expect(expected.size).toBe(2);
    for (const [id, object] of expected) expect(scene.get(id)).toEqual(object);
    expect(scene.has('title')).toBe(false);
    run(store, 'setStyle', { changes: [{ id: 'title', style: { fill: [0, 1, 0, 1] } }] });
    expect(scene.get('inst/title')).toMatchObject({ fill: [0, 1, 0, 1] });
    expect(scene.get('inst/title')).toEqual(resolvedOf(store, 'inst').get('inst/title'));
    document.destroy();
    store.destroy();
  });

  it('selects the real instance when its content is clicked (control: instance-box picking holds today)', () => {
    const { store, document, pages, pageId } = mounted();
    pages.show(pageId);
    click(document, 440, 320);
    expect(document.selectTool.selection.ids).toEqual(['inst']);
    document.destroy();
    store.destroy();
  });

  it('neither draws nor hits a retired main', () => {
    const { store, document, scene } = mounted();
    expect(scene.get('title')).toBeDefined();
    const main = store.get('main' as ObjectId);
    if (main?.type !== 'component') throw new Error('the main exists');
    store.transact(LOCAL_USER_ORIGIN, (tx) => {
      tx.setObject({ ...main, retired: true });
    });
    for (const id of ['main', 'title', 'body']) expect(scene.has(id)).toBe(false);
    click(document, 140, 120);
    expect(document.selectTool.selection.ids).toEqual([]);
    document.destroy();
    store.destroy();
  });

  it('drops a deleted main child from an instance shown on another page', () => {
    const { store, document, pages, pageId, scene } = mounted();
    pages.show(pageId);
    store.transact(LOCAL_USER_ORIGIN, (tx) => {
      tx.deleteObject('body' as ObjectId);
    });
    expect(scene.has('inst/body')).toBe(false);
    expect(scene.get('inst/title')).toBeDefined();
    document.destroy();
    store.destroy();
  });

  it('switches pages without leaving virtual objects behind', () => {
    const { store, document, pages, pageId, scene } = mounted();
    pages.show(pageId);
    expect(scene.has('inst/title')).toBe(true);
    const [first] = store.readPages().keys();
    if (first === undefined) throw new Error('the board has pages');
    pages.show(first);
    expect([...scene.keys()].filter((id) => id.includes('/'))).toEqual([]);
    document.destroy();
    store.destroy();
  });

  it('refuses a cached preview when a visible candidate is virtual (control: fails safe today)', () => {
    const { store, document, pages, pageId } = mounted();
    pages.show(pageId);
    expect(previewObjects(store, ['inst' as ObjectId, 'inst/title' as ObjectId])).toBeUndefined();
    expect(previewObjects(store, ['inst' as ObjectId])).toHaveLength(1);
    document.destroy();
    store.destroy();
  });
});
