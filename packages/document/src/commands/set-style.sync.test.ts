import { describe, expect, it } from 'vitest';

import {
  fittedImageRect,
  IMAGE_FIT_TOLERANCE,
  type Crop,
  type ShapeObject,
  type TextObject,
} from '@canvas/schema';

import {
  ADA_ID,
  BOB_ID,
  createClientPair,
  Link,
} from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { ORDERS } from '../repair/__fixtures__/repair-fixtures.js';
import { ADA, BOB, createSyncedPair, exchange, id } from '../store/__fixtures__/store-fixtures.js';
import type { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, testEnvironment } from './__fixtures__/command-fixtures.js';
import { renameFrameCommand } from './rename-frame.js';
import { resizeObjectsCommand } from './resize-objects.js';
import { runCommand } from './run-command.js';
import { setStyleCommand } from './set-style.js';
import { setTextRunsCommand } from './set-text-runs.js';

// Sync test for a restyle of several texts carrying their measured sizes: one setStyle
// writes each text's style and size in one transaction, and merges with a collaborator typing
// into one of them. And shapes: two collaborators restyling one shape at once, one its
// kind and the other its fill, converge on one of the two whole styles (a shape's appearance
// fields are one last-writer-wins group of the stored layout, `codec/object-layout.ts`), while a
// label typed into meanwhile keeps its characters and takes the restyle. And an image's crop,
// with the box it moves, against a concurrent restyle, resize or crop (fix round 1): the
// crop is in the style group and the box in the placement and size groups, each
// last-writer-wins, so a merge can pair one client's crop with the other's box; what is drawn
// (`fittedImageRect`) must still have the crop's own aspect, in either client-id order and after
// either client undoes.

const TITLE = id('text-title');
const STICKY = id('sticky-idea');
const BOX = id('shape-box');
const PHOTO = id('image-photo');

/**
 * A text or sticky body on a client.
 *
 * @param store - The client.
 * @param objectId - The object.
 * @returns Its text, runs, width and height.
 * @throws {Error} When the object is not a text or sticky.
 */
function body(
  store: YjsDocumentStore,
  objectId: typeof TITLE,
): Pick<TextObject, 'text' | 'runs' | 'width' | 'height'> {
  const object = store.get(objectId);
  if (object?.type !== 'text' && object?.type !== 'sticky') throw new Error('Not a text body.');
  const { text, runs, width, height } = object;
  return { text, runs, width, height };
}

/**
 * A keystroke on a client: the title's text with a character appended, its last run grown.
 *
 * @param store - The client.
 * @returns The new text and runs.
 * @throws {Error} When the title has no run.
 */
function appendCharacter(store: YjsDocumentStore): Pick<TextObject, 'text' | 'runs'> {
  const { text, runs } = body(store, TITLE);
  const last = runs.at(-1);
  if (last === undefined) throw new Error('The fixture title has runs.');
  return { text: `${text}!`, runs: [...runs.slice(0, -1), { ...last, length: last.length + 1 }] };
}

/**
 * The fixture box's appearance on a client: its kind, fill and stroke.
 *
 * @param store - The client.
 * @returns The fields.
 * @throws {Error} When the box is not a shape.
 */
function appearanceOf(store: YjsDocumentStore): Pick<ShapeObject, 'kind' | 'fill' | 'stroke'> {
  const object = store.get(BOX);
  if (object?.type !== 'shape') throw new Error('The fixture box is a shape.');
  const { kind, fill, stroke } = object;
  return { kind, fill, stroke };
}

describe('setStyle sync', () => {
  it('converges when a restyle of two texts with their sizes races typing in one of them', () => {
    const [ada, bob] = createSyncedPair();
    const restyle = runCommand(
      ada,
      ADA,
      setStyleCommand,
      {
        changes: [
          { id: TITLE, style: { textStyle: { fontSize: 30 } }, size: { width: 400, height: 40 } },
          { id: STICKY, style: { textStyle: { fontSize: 30 } }, size: { width: 220, height: 120 } },
        ],
      },
      testEnvironment(),
    );
    expect(restyle.status).toBe('applied');
    const typed = appendCharacter(bob);
    const typing = runCommand(
      bob,
      BOB,
      setTextRunsCommand,
      { id: TITLE, ...typed, size: { width: 150, height: 30 } },
      testEnvironment(),
    );
    expect(typing.status).toBe('applied');
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(body(ada, TITLE).text).toBe(typed.text);
    expect(body(ada, TITLE).runs[0]?.style.fontSize).toBe(30);
    expect([400, 150]).toContain(body(ada, TITLE).width);
    expect(body(ada, STICKY)).toMatchObject({ width: 220, height: 120 });
    expect(body(ada, STICKY).runs.every(({ style }) => style.fontSize === 30)).toBe(true);
  });

  it("converges on one whole style when one client changes a shape's kind and another its fill", () => {
    const [ada, bob] = createSyncedPair();
    const kind = runCommand(
      ada,
      ADA,
      setStyleCommand,
      { changes: [{ id: BOX, style: { kind: 'ellipse' } }] },
      testEnvironment(),
    );
    const fill = runCommand(
      bob,
      BOB,
      setStyleCommand,
      { changes: [{ id: BOX, style: { fill: [0.2, 0.6, 0.3, 1], stroke: null } }] },
      testEnvironment(),
    );
    expect([kind.status, fill.status]).toEqual(['applied', 'applied']);
    const written = [appearanceOf(ada), appearanceOf(bob)];
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    // The style group is written whole: one writer's appearance, never a mix of the two.
    expect(written).toContainEqual(appearanceOf(ada));
    expect(ada.get(BOX)).toMatchObject({ label: { text: 'API' } });
  });

  it("converges when one client restyles a shape's label as another types into it", () => {
    const [ada, bob] = createSyncedPair();
    const restyle = runCommand(
      ada,
      ADA,
      setStyleCommand,
      { changes: [{ id: BOX, style: { kind: 'star', sides: 6, textStyle: { fontSize: 30 } } }] },
      testEnvironment(),
    );
    const box = bob.get(BOX);
    if (box?.type !== 'shape' || box.label === null)
      throw new Error('The fixture box is labelled.');
    const [run] = box.label.runs;
    if (run === undefined) throw new Error('The fixture label has a run.');
    const typing = runCommand(
      bob,
      BOB,
      setTextRunsCommand,
      { id: BOX, text: 'APIs', runs: [{ ...run, length: 4 }] },
      testEnvironment(),
    );
    expect([restyle.status, typing.status]).toEqual(['applied', 'applied']);
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    const merged = ada.get(BOX);
    expect(merged).toMatchObject({ kind: 'star', sides: 6, label: { text: 'APIs' } });
    if (merged?.type !== 'shape') throw new Error('The box is a shape.');
    expect(merged.label?.runs.some(({ style }) => style.fontSize === 30)).toBe(true);
  });
});

/**
 * The fixture photo on a client (4000 × 2400, cropped to its middle 80 % across: 4:3 in a
 * 400 × 300 box).
 *
 * @param store - The client.
 * @returns The image.
 * @throws {Error} When the photo is not an image.
 */
function photoOf(store: YjsDocumentStore) {
  const photo = store.get(PHOTO);
  if (photo?.type !== 'image') throw new Error('The fixture photo is an image.');
  return photo;
}

/**
 * Checks what the photo draws: inside its box, at its crop's own aspect (the crop's fractions
 * of the natural size), never stretched.
 *
 * @param store - The client.
 */
function expectUndistorted(store: YjsDocumentStore): void {
  const photo = photoOf(store);
  const drawn = fittedImageRect(photo);
  const { crop, naturalSize } = photo;
  const expected = (crop.width * naturalSize.width) / (crop.height * naturalSize.height);
  expect(Math.abs(drawn.width / drawn.height / expected - 1)).toBeLessThanOrEqual(
    IMAGE_FIT_TOLERANCE,
  );
  expect(drawn.x).toBeGreaterThanOrEqual(0);
  expect(drawn.y).toBeGreaterThanOrEqual(0);
  expect(drawn.x + drawn.width).toBeLessThanOrEqual(photo.width + 1e-9);
  expect(drawn.y + drawn.height).toBeLessThanOrEqual(photo.height + 1e-9);
}

/** Ada's crop: the left half of what shows, 1600 × 2400 of the photo (2:3). */
const LEFT_HALF: Crop = { x: 0.1, y: 0, width: 0.4, height: 1 };

/** Bob's edits, each concurrent with Ada's crop. */
const BOB_EDITS = [
  {
    name: 'an opacity change',
    edit: (bob: YjsDocumentStore) => {
      applyCommand(
        bob,
        setStyleCommand,
        { changes: [{ id: PHOTO, style: { opacity: 0.5 } }] },
        BOB,
      );
    },
  },
  {
    name: 'a resize',
    edit: (bob: YjsDocumentStore) => {
      applyCommand(
        bob,
        resizeObjectsCommand,
        { resizes: [{ id: PHOTO, to: { width: 600, height: 450 } }] },
        BOB,
      );
    },
  },
  {
    name: 'a crop of another aspect',
    edit: (bob: YjsDocumentStore) => {
      // The bottom half of what shows: 3200 × 1200 of the photo (8:3).
      const crop = { x: 0.1, y: 0.5, width: 0.8, height: 0.5 };
      applyCommand(bob, setStyleCommand, { changes: [{ id: PHOTO, style: { crop } }] }, BOB);
    },
  },
] as const;

describe.each(ORDERS)('an image cropped concurrently ($name)', (order) => {
  it.each(BOB_EDITS)(
    'is drawn undistorted after a crop meets $name, and after undo',
    ({ edit }) => {
      const undone: boolean[] = [];
      for (const undoer of ['ada', 'bob'] as const) {
        const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
        const link = new Link(ada, bob);
        const histories = { ada: createHistory(ada, ADA_ID), bob: createHistory(bob, BOB_ID) };
        applyCommand(ada, setStyleCommand, {
          changes: [{ id: PHOTO, style: { crop: LEFT_HALF } }],
        });
        expect(photoOf(ada)).toMatchObject({ width: 200, height: 300 });
        edit(bob);
        link.deliver();
        expect(ada.read().objects).toEqual(bob.read().objects);
        expectUndistorted(ada);
        // An undo restores only what the other client's write did not replace since (Yjs), so
        // it may find nothing to do; whatever it restores, the image is drawn undistorted.
        undone.push(histories[undoer].undo());
        link.deliver();
        expect(ada.read().objects).toEqual(bob.read().objects);
        expectUndistorted(ada);
        expectUndistorted(bob);
      }
      expect(undone).toContain(true);
    },
  );
});

describe('an image cropped while another client fades it', () => {
  it('draws the kept crop fitted in the other client’s box, never the whole image squeezed', () => {
    // The reviewer's probe: when the fade's style group wins, the old crop (4:3) meets the new
    // box (200 × 300, the left half's); it draws 200 × 150, centred down.
    const outcomes = ORDERS.map((order) => {
      const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
      const link = new Link(ada, bob);
      applyCommand(ada, setStyleCommand, { changes: [{ id: PHOTO, style: { crop: LEFT_HALF } }] });
      applyCommand(
        bob,
        setStyleCommand,
        { changes: [{ id: PHOTO, style: { opacity: 0.5 } }] },
        BOB,
      );
      link.deliver();
      const photo = photoOf(ada);
      return { crop: photo.crop, opacity: photo.opacity, drawn: fittedImageRect(photo) };
    });
    expect(outcomes).toContainEqual({
      crop: { x: 0.1, y: 0, width: 0.8, height: 1 },
      opacity: 0.5,
      drawn: { x: 0, y: 75, width: 200, height: 150 },
    });
    expect(outcomes).toContainEqual({
      crop: LEFT_HALF,
      opacity: 0.9,
      drawn: { x: 0, y: 0, width: 200, height: 300 },
    });
  });
});

const PLAN = id('frame-plan');

describe.each(ORDERS)('a frame’s showName against a concurrent rename ($name)', (order) => {
  it('converges on one whole style, before and after an undo of the toggle', () => {
    // A frame's name and showName are in its one last-writer-wins style group: the
    // two clients converge on one of the two whole styles, never a mix.
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    applyCommand(ada, setStyleCommand, { changes: [{ id: PLAN, style: { showName: false } }] });
    applyCommand(bob, renameFrameCommand, { id: PLAN, name: 'Renamed' }, BOB);
    link.deliver();
    const merged = ada.get(PLAN);
    expect(merged).toEqual(bob.get(PLAN));
    const style = merged?.type === 'frame' ? merged : undefined;
    expect([
      { name: 'Launch plan', showName: false },
      { name: 'Renamed', showName: undefined },
    ]).toContainEqual({ name: style?.name, showName: style?.showName });
    // An undo restores only what the other client's write did not replace since (Yjs), so it
    // may find nothing to do; whatever it does, both clients agree and read the frame.
    history.undo();
    link.deliver();
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(ada.get(PLAN)).toMatchObject({ type: 'frame' });
    expect(ada.read().issues).toEqual([]);
  });

  it('syncs an explicit showName to the other client; undo removes it and redo restores it', () => {
    const [ada, bob] = createClientPair(order.adaClientId, order.bobClientId);
    const link = new Link(ada, bob);
    const history = createHistory(ada, ADA_ID);
    applyCommand(ada, setStyleCommand, { changes: [{ id: PLAN, style: { showName: false } }] });
    link.deliver();
    expect(bob.get(PLAN)).toMatchObject({ showName: false });
    expect(history.undo()).toBe(true);
    link.deliver();
    expect(bob.get(PLAN)).toMatchObject({ showName: undefined });
    // Redo writes the toggle again, and the other client sees it.
    expect(history.redo()).toBe(true);
    link.deliver();
    expect(bob.get(PLAN)).toMatchObject({ showName: false });
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(bob.read().issues).toEqual([]);
  });
});
