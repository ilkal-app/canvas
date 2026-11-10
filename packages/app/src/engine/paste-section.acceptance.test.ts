// Item 9, written before the code as a paste-handler test, moved here to drive the real paste target: one paste is one createObjects call with one parent, so the
// section is chosen where the pasted content lands (the pointer), as the entered group is.
// CONTRACT: a paste at the pointer over a section joins it, staying where the pointer put it; a
// pasted frame keeps its own children; a paste over no section stays at the root.
// Deliberately not asserted: clipboard HTML fallback or image linking.
import { describe, expect, it, vi } from 'vitest';

import { copySelection, createHistory, planPaste, type NewObject } from '@canvas/document';
import type { Camera } from '@canvas/engine';
import {
  createSeededIdGenerator,
  objectToBoardTransform,
  type BoardObject,
  type ObjectId,
} from '@canvas/schema';

import type { PasteLocation } from '../clipboard/paste-handlers.js';

import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';
import { DocumentClipboard } from './document-clipboard.js';
import { EngineDocument } from './engine-document.js';

/** The demo board's first rectangle: world (50, 50), 70 × 60, at (10, 10) in its section. */
const MARKER = 'section-0-rect-0-0' as ObjectId;
const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };
const ENVIRONMENT = { clock: () => 1_790_000_000_000, createId: createSeededIdGenerator(5) };

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
  const click = (x: number, y: number) => {
    for (const kind of ['pointerDown', 'pointerUp'] as const) {
      const input = { kind, screen: { x, y }, isShiftPressed: false, isModPressed: false };
      document.handlePointer(input, CAMERA);
    }
  };
  return { store, clipboard, click };
}

function createdBy(location: PasteLocation, objects: readonly NewObject[]): readonly ObjectId[] {
  let ids: readonly ObjectId[] = [];
  location.createObjects(objects, (created) => {
    ids = created;
  });
  return ids;
}

/**
 * Another section than the marker's, and its centre on the board.
 *
 * @param store - The demo store.
 * @returns The section and its centre.
 * @throws {Error} When the demo board has no second section.
 */
function otherSection(store: ReturnType<typeof createDemoDocument>) {
  const board = store.read();
  const markerSection = store.get(MARKER)?.parentId;
  const section = [...board.objects.values()].find(
    (object): object is Extract<BoardObject, { type: 'frame' }> =>
      object.type === 'frame' && object.id !== markerSection && object.parentId === null,
  );
  if (section === undefined) throw new Error('the demo board has a second section');
  const toBoard = objectToBoardTransform(board, section);
  return {
    section,
    centre: { x: toBoard.x + section.width / 2, y: toBoard.y + section.height / 2 },
  };
}

describe('paste into a section (item 9)', () => {
  it('pastes at the pointer into the section under it, where the pointer put it', () => {
    const { store, clipboard, click } = setUp();
    click(60, 60);
    const copied = clipboard.copySelection();
    if (copied === undefined) throw new Error('copied');
    const { section, centre } = otherSection(store);
    const target = clipboard.pasteTarget(centre, { x: 0, y: 0 });
    const [pasted] = createdBy(target, planPaste(copied, target.pointer));
    const object = store.get(pasted ?? ('' as ObjectId));
    expect(object?.parentId).toBe(section.id);
    expect(object?.pageId ?? null).toBeNull();
    // Centred on the pointer, 70 × 60.
    const onBoard = object && objectToBoardTransform(store.read(), object);
    expect([onBoard?.x, onBoard?.y]).toEqual([centre.x - 35, centre.y - 30]);
  });

  it('keeps a pasted frame’s children in it, the frame itself joining the section', () => {
    const { store, clipboard } = setUp();
    const markerSection = store.get(MARKER)?.parentId;
    if (markerSection === null || markerSection === undefined) throw new Error('in a section');
    // Selecting a section is the select tool's (its name band); copy the section directly.
    const copied = copySelection(store.read(), [markerSection]);
    if (copied === undefined) throw new Error('copied');
    const { section, centre } = otherSection(store);
    const target = clipboard.pasteTarget(centre, { x: 0, y: 0 });
    const ids = createdBy(target, planPaste(copied, target.pointer));
    const pastedSection = ids.map((id) => store.get(id)).find((object) => object?.type === 'frame');
    expect(pastedSection?.parentId).toBe(section.id);
    const children = ids
      .map((id) => store.get(id))
      .filter((o) => o?.parentId === pastedSection?.id);
    expect(children.length).toBeGreaterThan(0);
  });

  it('pastes over no section at the root', () => {
    const { store, clipboard, click } = setUp();
    click(60, 60);
    const copied = clipboard.copySelection();
    if (copied === undefined) throw new Error('copied');
    const target = clipboard.pasteTarget({ x: 90_000, y: 90_000 }, { x: 0, y: 0 });
    const [pasted] = createdBy(target, planPaste(copied, target.pointer));
    expect(store.get(pasted ?? ('' as ObjectId))?.parentId).toBeNull();
  });
});
