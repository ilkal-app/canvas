// The engine document's clipboard side over the demo document. In Chrome:
// tooling/scenario/specs/app/clipboard.spec.ts.
import { describe, expect, it, vi } from 'vitest';

import {
  createHistory,
  runCommand,
  setColorTokenCommand,
  setLockedCommand,
  setStyleCommand,
} from '@canvas/document';
import { planPaste, type NewObject } from '@canvas/document';
import type { Camera } from '@canvas/engine';
import {
  createBoard,
  createSeededIdGenerator,
  objectToBoardTransform,
  type AssetId,
  type ObjectId,
} from '@canvas/schema';

import { clipboardBoard, objectOf } from '../clipboard/__fixtures__/clipboard-board.js';
import type { PasteLocation } from '../clipboard/paste-handlers.js';

import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';
import { DocumentClipboard } from './document-clipboard.js';
import { EngineDocument } from './engine-document.js';

/** The demo board's first rectangle: world (50, 50), 70 × 60, at (10, 10) in its section. */
const MARKER = 'section-0-rect-0-0' as ObjectId;
const NEIGHBOUR = 'section-0-rect-1-0' as ObjectId;
const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };
const ENVIRONMENT = { clock: () => 1_790_000_000_000, createId: createSeededIdGenerator(5) };

/**
 * The demo document with its engine document and clipboard side.
 *
 * @returns The store, the document side, its history, the clipboard side, and a click.
 */
function setUp() {
  const store = createDemoDocument();
  const history = createHistory(store, LOCAL_USER_ORIGIN.principalId);
  const document = new EngineDocument({
    store,
    history,
    origin: LOCAL_USER_ORIGIN,
    environment: ENVIRONMENT,
    onChange: vi.fn(),
  });
  const clipboard = new DocumentClipboard({
    store,
    origin: LOCAL_USER_ORIGIN,
    environment: ENVIRONMENT,
    controller: document.selectTool,
  });
  const click = (x: number, y: number, isShiftPressed = false) => {
    for (const kind of ['pointerDown', 'pointerUp'] as const) {
      const input = { kind, screen: { x, y }, isShiftPressed, isModPressed: false };
      document.handlePointer(input, CAMERA);
    }
  };
  const undo = () => document.runCanvasAction({ type: 'history', command: 'undo' }, 1);
  return { store, document, clipboard, click, undo };
}

/**
 * Creates objects at a paste location and reads back the new ids it gives (at once for a create
 * of one part).
 *
 * @param location - The paste location.
 * @param objects - The objects.
 * @returns The new ids, or `undefined` when none were given.
 */
function createdBy(
  location: PasteLocation,
  objects: readonly NewObject[],
): readonly ObjectId[] | undefined {
  let ids: readonly ObjectId[] | undefined;
  location.createObjects(objects, (created) => {
    ids = created;
  });
  return ids;
}

describe('DocumentClipboard', () => {
  it("gives a copy's HTML the board's tokens and the light mode for every object", () => {
    const { store, clipboard } = setUp();
    const section = store.get(MARKER)?.parentId;
    if (section === null || section === undefined) throw new Error('the marker is in a section');
    const run = (command: Parameters<typeof runCommand>[2], input: unknown) => {
      const outcome = runCommand(store, LOCAL_USER_ORIGIN, command, input, ENVIRONMENT);
      if (outcome.status !== 'applied') throw new Error(JSON.stringify(outcome.errors));
    };
    run(setStyleCommand, { changes: [{ id: section, style: { colorMode: 'dark' } }] });
    run(setColorTokenCommand, { name: 'Brand', light: [1, 0, 0, 1], dark: [0, 0, 1, 1] });
    const colors = clipboard.clipboardColors();
    // Another app has no theme and no fill travels: text is light whatever the section's mode.
    expect(colors.modeOf?.(MARKER)).toBe('light');
    expect(colors.modeOf?.(section)).toBe('light');
    expect(colors.modeOf?.('nowhere' as ObjectId)).toBe('light');
    expect([...(colors.tokens?.values() ?? [])].map(({ name }) => name)).toEqual(['Brand']);
  });

  it('duplicates the selection 16 world units away in its frame as one undo step, selected', () => {
    const { store, document, clipboard, click, undo } = setUp();
    click(60, 60);
    clipboard.duplicateSelection();
    const [copy] = document.inspect().selectedObjects;
    expect(copy?.id).not.toBe(MARKER);
    expect(copy).toMatchObject({ x: 26, y: 26, parentId: store.get(MARKER)?.parentId });
    undo();
    expect(store.get(copy?.id ?? ('' as ObjectId))).toBeUndefined();
  });

  it('copies the selection and pastes centred on the point, selecting what it created', () => {
    const { store, document, clipboard, click } = setUp();
    expect(clipboard.copySelection()).toBeUndefined();
    click(60, 60);
    const copied = clipboard.copySelection();
    expect([...(copied?.objects.keys() ?? [])]).toEqual([MARKER]);
    const location = clipboard.pasteTarget({ x: 500, y: 400 }, { x: 0, y: 0 });
    const ids = createdBy(
      location,
      copied === undefined ? [] : planPaste(copied, location.pointer),
    );
    expect(document.inspect().selectedIds).toEqual(ids);
    // (500, 400) is inside a demo section, which the paste joins (item 9), centred on
    // the point on the board.
    const pasted = store.get(ids?.[0] ?? ('' as ObjectId));
    const parent =
      pasted?.parentId === null ? undefined : store.get(pasted?.parentId ?? ('' as ObjectId));
    expect(parent?.type).toBe('frame');
    const onBoard = pasted && objectToBoardTransform(store.read(), pasted);
    expect([onBoard?.x, onBoard?.y]).toEqual([465, 370]);
    expect(location.createObjects([])).toBe(false);
  });

  it('prepares a cut that deletes what it copied when asked, as one undo step', () => {
    const { store, clipboard, click, undo } = setUp();
    click(60, 60);
    click(150, 60, true);
    const cut = clipboard.prepareCut();
    if (cut.kind !== 'ready') throw new Error('the cut is ready');
    expect([...cut.copied.objects.keys()].sort()).toEqual([MARKER, NEIGHBOUR]);
    // The ids are taken when the cut is prepared: a later selection does not change them.
    click(1500, 1500);
    expect(store.get(MARKER)).toBeDefined();
    cut.remove();
    expect([store.get(MARKER), store.get(NEIGHBOUR)]).toEqual([undefined, undefined]);
    undo();
    expect(store.get(MARKER)).toBeDefined();
    expect(store.get(NEIGHBOUR)).toBeDefined();
    // Once they are gone, removing again deletes nothing.
    cut.remove();
    const size = store.read().objects.size;
    cut.remove();
    expect(store.read().objects.size).toBe(size);
  });

  it('leaves an object locked between preparing the cut and removing it', () => {
    const { store, clipboard, click } = setUp();
    click(60, 60);
    click(150, 60, true);
    const cut = clipboard.prepareCut();
    if (cut.kind !== 'ready') throw new Error('the cut is ready');
    // Someone locks the marker while the copy is being written.
    runCommand(
      store,
      LOCAL_USER_ORIGIN,
      setLockedCommand,
      { ids: [MARKER], locked: true },
      ENVIRONMENT,
    );
    cut.remove();
    expect(store.get(MARKER)).toMatchObject({ locked: true });
    expect(store.get(NEIGHBOUR)).toBeUndefined();
  });

  it('refuses to cut a selection holding a locked object, deleting nothing', () => {
    const { store, clipboard, click } = setUp();
    runCommand(
      store,
      LOCAL_USER_ORIGIN,
      setLockedCommand,
      { ids: [MARKER], locked: true },
      ENVIRONMENT,
    );
    click(60, 60);
    const cut = clipboard.prepareCut();
    expect(cut.kind === 'refused' && cut.message).toContain('locked');
    expect(store.get(MARKER)).toBeDefined();
    expect(clipboard.prepareCut()).toMatchObject({ kind: 'refused' });
  });

  it('keeps a copy locked when pasted, and a click still selects the pasted copy', () => {
    const { store, document, clipboard, click } = setUp();
    runCommand(
      store,
      LOCAL_USER_ORIGIN,
      setLockedCommand,
      { ids: [MARKER], locked: true },
      ENVIRONMENT,
    );
    click(60, 60);
    const copied = clipboard.copySelection();
    const location = clipboard.pasteTarget({ x: 400, y: 700 }, { x: 0, y: 0 });
    const [pasted] =
      createdBy(location, copied === undefined ? [] : planPaste(copied, location.pointer)) ?? [];
    expect(store.get(pasted ?? ('' as ObjectId))?.locked).toBe(true);
    click(1500, 1500);
    click(400, 700);
    expect(document.inspect().selectedIds).toEqual([pasted]);
  });

  it('pastes inside the entered group where the pointer is; duplicates stay in the group', () => {
    const { store, document, clipboard, click, undo } = setUp();
    click(60, 60);
    click(150, 60, true);
    document.runCanvasAction({ type: 'arrange', command: 'group' }, 1);
    const [groupId] = document.inspect().selectedIds;
    // A double press on the marker enters the group and selects the marker.
    for (const timeStamp of [100, 200]) {
      for (const kind of ['pointerDown', 'pointerUp'] as const) {
        const input = {
          kind,
          screen: { x: 60, y: 60 },
          isShiftPressed: false,
          isModPressed: false,
        };
        document.handlePointer({ ...input, timeStamp }, CAMERA);
      }
    }
    expect(document.inspect()).toMatchObject({ enteredGroupId: groupId, selectedIds: [MARKER] });
    const copied = clipboard.copySelection();
    const target = clipboard.pasteTarget({ x: 500, y: 400 }, { x: 0, y: 0 });
    const [pasted] =
      createdBy(target, copied === undefined ? [] : planPaste(copied, target.pointer)) ?? [];
    const object = store.get(pasted ?? ('' as ObjectId));
    expect(object?.parentId).toBe(groupId);
    // Where the pointer put it on the board: centred on (500, 400), 70 × 60.
    const onBoard = object && objectToBoardTransform(store.read(), object);
    expect([onBoard?.x, onBoard?.y]).toEqual([465, 370]);
    expect(document.inspect()).toMatchObject({ enteredGroupId: groupId, selectedIds: [pasted] });
    undo();
    expect(store.get(pasted ?? ('' as ObjectId))).toBeUndefined();
    click(60, 60);
    clipboard.duplicateSelection();
    const [duplicate] = document.inspect().selectedObjects;
    expect(duplicate).toMatchObject({ parentId: groupId });
    expect(duplicate?.id).not.toBe(MARKER);
  });

  it('says whether the board shows an image of an asset, for a paste that names this board', () => {
    const { clipboard, store } = setUp();
    const photo = objectOf(clipboardBoard(), 'photo');
    const location = clipboard.pasteTarget({ x: 300, y: 300 }, { x: 0, y: 0 });
    const asked = ['asset-photo', 'asset-other'] as AssetId[];
    expect(location.shownImagesAmong?.(asked)).toEqual(new Set());
    const ids = createdBy(location, planPaste(createBoard([photo]), location.pointer));
    expect(location.shownImagesAmong?.(asked)).toEqual(new Set(['asset-photo']));
    expect(store.get(ids?.[0] ?? ('' as ObjectId))?.type).toBe('image');
  });

  it('shows notices through onNotice as their message, and does nothing without it', () => {
    const { store, clipboard } = setUp();
    const onNotice = vi.fn();
    const noticed = new DocumentClipboard({
      store,
      origin: LOCAL_USER_ORIGIN,
      environment: ENVIRONMENT,
      controller: { selection: { ids: [] }, isGesturing: false, select: vi.fn() } as never,
      onNotice,
    });
    noticed.pasteTarget(undefined, { x: 0, y: 0 }).notify('Nothing was pasted.');
    expect(onNotice).toHaveBeenCalledWith('Nothing was pasted.');
    expect(() => {
      clipboard.pasteTarget(undefined, { x: 0, y: 0 }).notify('Nothing was pasted.');
    }).not.toThrow();
  });

  it('cuts, pastes and duplicates nothing with nothing selected or mid-drag', () => {
    const { store, document, clipboard, click } = setUp();
    expect(clipboard.prepareCut()).toEqual({ kind: 'empty' });
    click(60, 60);
    const before = store.read().objects.size;
    document.handlePointer(
      { kind: 'pointerDown', screen: { x: 60, y: 60 }, isShiftPressed: false, isModPressed: false },
      CAMERA,
    );
    document.handlePointer(
      { kind: 'pointerMove', screen: { x: 90, y: 90 }, isShiftPressed: false, isModPressed: false },
      CAMERA,
    );
    expect(clipboard.prepareCut()).toEqual({ kind: 'empty' });
    clipboard.duplicateSelection();
    expect(store.read().objects.size).toBe(before);
  });

  it('asks the person to finish the drag when a paste arrives mid-drag, and creates nothing', () => {
    const { store, document } = setUp();
    const onNotice = vi.fn();
    const clipboard = new DocumentClipboard({
      store,
      origin: LOCAL_USER_ORIGIN,
      environment: ENVIRONMENT,
      controller: document.selectTool,
      onNotice,
    });
    const before = store.read().objects.size;
    for (const kind of ['pointerDown', 'pointerMove'] as const) {
      const screen = kind === 'pointerDown' ? { x: 60, y: 60 } : { x: 90, y: 90 };
      document.handlePointer({ kind, screen, isShiftPressed: false, isModPressed: false }, CAMERA);
    }
    const target = clipboard.pasteTarget(undefined, { x: 0, y: 0 });
    const text = {
      type: 'group',
      parentId: null,
      x: 0,
      y: 0,
      rotation: 0,
      locked: false,
    } as const;
    expect(target.createObjects([text])).toBe(false);
    expect(onNotice).toHaveBeenCalledWith('Finish the drag, then paste.');
    expect(store.read().objects.size).toBe(before);
  });

  it('creates and selects nothing when the board refuses what a paste would create', () => {
    const { store, clipboard, document } = setUp();
    const before = store.read().objects.size;
    const target = clipboard.pasteTarget(undefined, { x: 0, y: 0 });
    const orphan = {
      type: 'group',
      parentId: 'nowhere' as ObjectId,
      x: 0,
      y: 0,
      rotation: 0,
      locked: false,
    } as const;
    // The command ran and refused: no ids are given, and the refusal is told.
    const onCreated = vi.fn();
    expect(target.createObjects([orphan], onCreated)).toBe(true);
    expect(onCreated).not.toHaveBeenCalled();
    expect(document.inspect().selectedIds).toEqual([]);
    expect(store.read().objects.size).toBe(before);
  });
});
