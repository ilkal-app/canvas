// The frame tool: a drag draws a frame that takes in what is wholly inside it, a click
// makes a default one; creation and adoption are one command and one undo step; the frame is
// named "Frame N", selected, and the select tool takes over.
import { describe, expect, it } from 'vitest';

import { createHistory, type CommandError } from '@canvas/document';
import type { BoardObject, FrameObject, ObjectId } from '@canvas/schema';

import type { ToolPointerInput } from '../modes/tool-mode.js';
import { frame, indexOf, mapSource, rect } from '../select/__fixtures__/select-board.js';
import { createTextModeContext } from '../text/__fixtures__/text-mode-context.js';

import {
  clickedFrameBox,
  DEFAULT_FRAME_HEIGHT,
  DEFAULT_FRAME_WIDTH,
  FrameMode,
  type FrameModeContext,
} from './frame-mode.js';

/**
 * A primary-button input at a world point, the camera at the origin at 100%.
 *
 * @param kind - Down, move or up.
 * @param x - World x, and CSS px.
 * @param y - World y.
 * @param isShiftPressed - Whether Shift is held.
 * @returns The input.
 */
function at(
  kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
  x: number,
  y: number,
  isShiftPressed = false,
) {
  return {
    kind,
    screen: { x, y },
    world: { x, y },
    isShiftPressed,
    isModPressed: false,
    zoom: 1,
  } satisfies ToolPointerInput;
}

/**
 * A frame mode over a board, the index and document built from its objects.
 *
 * @param objects - The board.
 * @param hasBoard - Whether the context gives the index and document.
 * @returns The fixture, the mode, the refusals and a reader.
 */
function creating(objects: readonly BoardObject[], hasBoard = true) {
  const fixture = createTextModeContext(objects);
  const refused: (readonly CommandError[])[] = [];
  const context: FrameModeContext = {
    ...fixture.context,
    onCommandRefused: (errors) => refused.push(errors),
    ...(hasBoard ? { board: { index: indexOf(objects), source: mapSource(objects) } } : {}),
  };
  const mode = new FrameMode(context);
  const read = (id: string) => fixture.store.get(id as ObjectId);
  return { ...fixture, mode, refused, read };
}

/**
 * Drags with a mode from one point to another.
 *
 * @param mode - The mode.
 * @param from - The press.
 * @param to - The release.
 * @returns The release's step.
 */
function drag(mode: FrameMode, from: readonly [number, number], to: readonly [number, number]) {
  mode.onPointer(at('pointerDown', ...from));
  mode.onPointer(at('pointerMove', ...to));
  return mode.onPointer(at('pointerUp', ...to));
}

const INSIDE = rect('inside', null, { x: 120, y: 120, width: 50, height: 50 });
const ACROSS = rect('across', null, { x: 380, y: 120, width: 50, height: 50 });
const LOCKED = rect('locked', null, { x: 200, y: 200, width: 20, height: 20, isLocked: true });

describe('FrameMode', () => {
  it('asks for a crosshair and writes nothing on a press', () => {
    const { mode, store } = creating([INSIDE]);
    expect(mode.id).toBe('frame');
    expect(mode.cursor).toBe('crosshair');
    mode.onPointer(at('pointerDown', 100, 100));
    expect(store.read().objects.size).toBe(1);
    expect(mode.overlay()).toEqual({});
  });

  it('previews the drag, then creates the frame over what is wholly inside, in one step', () => {
    const { mode, read, record, store } = creating([INSIDE, ACROSS, LOCKED]);
    const history = createHistory(store, 'user:ada' as never);
    mode.onPointer(at('pointerDown', 100, 100));
    mode.onPointer(at('pointerMove', 300, 250));
    expect(record.previews.get('new-1' as ObjectId)).toMatchObject({
      type: 'frame',
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      name: 'Frame 1',
      z: '~',
    });
    expect(mode.overlay()).toEqual({ guides: [] });
    expect(mode.onPointer(at('pointerUp', 400, 300))).toEqual({ isDone: true });
    expect(read('new-1')).toMatchObject({
      type: 'frame',
      parentId: null,
      x: 100,
      y: 100,
      width: 300,
      height: 200,
      name: 'Frame 1',
      clip: true,
      background: [1, 1, 1, 1],
    });
    expect(read('inside')).toMatchObject({ parentId: 'new-1', x: 20, y: 20 });
    expect(read('across')?.parentId).toBeNull();
    expect(read('locked')?.parentId).toBeNull();
    expect(record.capture).toEqual(['command']);
    expect(record.selected).toEqual([['new-1']]);
    expect(record.previews.get('new-1' as ObjectId)).toBeUndefined();
    expect(history.undo()).toBe(true);
    expect(history.canUndo()).toBe(false);
    expect(read('new-1')).toBeUndefined();
    expect(read('inside')).toMatchObject({ parentId: null, x: 120, y: 120 });
  });

  it('makes a default-size frame centred on a click, named one past the board', () => {
    const named = {
      ...frame('old', null, { x: 2000, y: 0, width: 10, height: 10 }),
      name: 'Frame 4',
    };
    const { mode, read } = creating([named]);
    mode.onPointer(at('pointerDown', 500, 500));
    expect(mode.onPointer(at('pointerUp', 501, 501))).toEqual({ isDone: true });
    expect(read('new-1')).toMatchObject({
      ...clickedFrameBox({ x: 500, y: 500 }),
      width: DEFAULT_FRAME_WIDTH,
      height: DEFAULT_FRAME_HEIGHT,
      name: 'Frame 5',
    });
  });

  it('goes into the frame under its centre and takes that frame’s children', () => {
    const outer = frame('outer', null, { x: 0, y: 0, width: 1000, height: 1000 });
    const child = rect('child', 'outer', { x: 220, y: 220, width: 20, height: 20 });
    const other = frame('other', null, { x: 1500, y: 0, width: 300, height: 300 });
    const { mode, read } = creating([outer, child, other]);
    drag(mode, [200, 200], [400, 400]);
    expect(read('new-1')).toMatchObject({ parentId: 'outer', x: 200, y: 200, rotation: 0 });
    expect(read('child')).toMatchObject({ parentId: 'new-1', x: 20, y: 20 });
  });

  it('takes in a frame it encloses under its centre, rather than going inside it', () => {
    const old = frame('old', null, { x: 150, y: 150, width: 100, height: 100 });
    const oldChild = rect('old-child', 'old', { x: 10, y: 10, width: 20, height: 20 });
    const { mode, read } = creating([old, oldChild]);
    drag(mode, [0, 0], [400, 400]);
    expect(read('new-1')).toMatchObject({ parentId: null, x: 0, y: 0 });
    expect(read('old')).toMatchObject({ parentId: 'new-1', x: 150, y: 150 });
    expect(read('old-child')?.parentId).toBe('old');
  });

  it('never goes into a frame inside a frame it encloses, and takes in the outer one', () => {
    const outer = frame('outer', null, { x: 0, y: 0, width: 1000, height: 1000 });
    const enclosed = frame('enclosed', 'outer', { x: 150, y: 150, width: 100, height: 100 });
    // A child frame that sticks out of its enclosed parent, under the drawn box's centre.
    const sticking = frame('sticking', 'enclosed', { x: 40, y: 40, width: 300, height: 300 });
    const { mode, read } = creating([outer, enclosed, sticking]);
    drag(mode, [100, 100], [300, 300]);
    expect(read('new-1')).toMatchObject({ parentId: 'outer', x: 100, y: 100 });
    expect(read('enclosed')).toMatchObject({ parentId: 'new-1', x: 50, y: 50 });
    expect(read('sticking')?.parentId).toBe('enclosed');
  });

  it('keeps a turned parent’s frame upright on the board', () => {
    const turned = frame('turned', null, { x: 0, y: 0, width: 1000, height: 1000, rotation: 0.5 });
    const { mode, read } = creating([turned]);
    drag(mode, [100, 300], [200, 400]);
    const created = read('new-1') as FrameObject;
    expect(created.parentId).toBe('turned');
    expect(created.rotation).toBeCloseTo(-0.5, 12);
  });

  it('takes a frame wholly inside with its children, but not a child of a frame across it', () => {
    const inner = frame('inner', null, { x: 100, y: 100, width: 100, height: 100 });
    const innerChild = rect('inner-child', 'inner', { x: 10, y: 10, width: 10, height: 10 });
    const big = frame('big', null, { x: 250, y: 100, width: 400, height: 100 });
    const bigChild = rect('big-child', 'big', { x: 10, y: 10, width: 10, height: 10 });
    const { mode, read } = creating([inner, innerChild, big, bigChild]);
    drag(mode, [50, 50], [400, 300]);
    expect(read('inner')?.parentId).toBe('new-1');
    expect(read('inner-child')?.parentId).toBe('inner');
    expect(read('big-child')?.parentId).toBe('big');
  });

  it('takes nothing in and goes on the root without the index', () => {
    const { mode, read } = creating([INSIDE], false);
    drag(mode, [100, 100], [400, 300]);
    expect(read('new-1')?.parentId).toBeNull();
    expect(read('inside')?.parentId).toBeNull();
  });

  it('keeps a square with Shift', () => {
    const { mode, read } = creating([]);
    mode.onPointer(at('pointerDown', 0, 0, true));
    mode.onPointer(at('pointerMove', 100, 40, true));
    mode.onPointer(at('pointerUp', 100, 40, true));
    expect(read('new-1')).toMatchObject({ width: 100, height: 100 });
  });

  it('cancels a drag on Escape, then asks to end on a second Escape', () => {
    const { mode, record, store } = creating([]);
    mode.onPointer(at('pointerDown', 0, 0));
    mode.onPointer(at('pointerMove', 100, 100));
    expect(mode.onKey({ kind: 'escape' })).toBe(true);
    expect(record.previews.get('new-1' as ObjectId)).toBeUndefined();
    expect(mode.onPointer(at('pointerUp', 100, 100))).toEqual({ isDone: false });
    expect(store.read().objects.size).toBe(0);
    expect(mode.onKey({ kind: 'escape' })).toBe(true);
    expect(record.exitRequests).toBe(1);
    expect(mode.onKey({ kind: 'enter' })).toBe(false);
  });

  it('drops a drag cancelled by the pointer or by ending the mode', () => {
    const { mode, record, store } = creating([]);
    mode.onPointer(at('pointerDown', 0, 0));
    mode.onPointer(at('pointerMove', 100, 100));
    mode.onPointer({ kind: 'pointerCancel' });
    expect(record.previews.get('new-1' as ObjectId)).toBeUndefined();
    mode.onPointer(at('pointerDown', 0, 0));
    mode.onPointer(at('pointerMove', 100, 100));
    mode.exit();
    expect(record.previews.get('new-2' as ObjectId)).toBeUndefined();
    expect(mode.onPointer({ kind: 'hold', timeStamp: 0, screen: { x: 0, y: 0 }, zoom: 1 })).toEqual(
      { isDone: false },
    );
    expect(store.read().objects.size).toBe(0);
  });

  it('reports a refusal and stays when the document refuses the frame', () => {
    const taken = rect('new-1', null, { x: 5000, y: 5000, width: 10, height: 10 });
    const { mode, refused, record } = creating([taken]);
    expect(drag(mode, [0, 0], [100, 100])).toEqual({ isDone: false });
    expect(refused.flat().map((error) => error.code)).toEqual(['duplicate-id']);
    expect(record.selected).toEqual([]);
  });
});
