// Editing a frame's name in place: the input edits the draft; Enter, a click outside
// or ending the mode commits it as one renameFrame, one undo step; Escape writes nothing.
import { describe, expect, it } from 'vitest';

import { createHistory, type CommandError } from '@canvas/document';
import type { ObjectId, PrincipalId } from '@canvas/schema';

import { createTextModeContext } from '../text/__fixtures__/text-mode-context.js';

import { frame, rect } from './__fixtures__/select-board.js';
import { FrameNameMode, MAX_FRAME_NAME_LENGTH } from './frame-name-mode.js';

/**
 * A name editor on the frame `f`, named "f".
 *
 * @returns The fixture, the mode, the refusals and a reader of the name.
 */
function editing() {
  const fixture = createTextModeContext([
    frame('f', null, { x: 0, y: 0, width: 100, height: 100 }),
    rect('r', null, { x: 500, y: 0, width: 10, height: 10 }),
  ]);
  const refused: (readonly CommandError[])[] = [];
  const context = {
    ...fixture.context,
    onCommandRefused: (errors: readonly CommandError[]) => {
      refused.push(errors);
    },
  };
  const mode = new FrameNameMode(context, 'f' as ObjectId);
  const nameOf = () => {
    const object = fixture.store.get('f' as ObjectId);
    return object?.type === 'frame' ? object.name : undefined;
  };
  return { ...fixture, mode, refused, nameOf };
}

describe('FrameNameMode', () => {
  it('starts from the name, keeps the select tool and shows nothing on the overlay', () => {
    const { mode, store } = editing();
    expect(mode.draft).toBe('f');
    expect(mode.id).toBe('select');
    expect(mode.cursor).toBe('default');
    expect(mode.overlay()).toEqual({});
    expect(mode.source).toBe(store);
    expect(mode.isFinished).toBe(false);
  });

  it('commits the draft on Enter as one undo step, and asks to end', () => {
    const { mode, nameOf, record, store } = editing();
    const history = createHistory(store, 'user:ada' as PrincipalId);
    mode.setDraft('Ideas');
    expect(mode.onKey({ kind: 'enter' })).toBe(true);
    expect(nameOf()).toBe('Ideas');
    expect(record.capture).toEqual(['command']);
    expect(record.exitRequests).toBe(1);
    expect(mode.isFinished).toBe(true);
    mode.exit();
    expect(record.capture).toEqual(['command']);
    expect(history.undo()).toBe(true);
    expect(nameOf()).toBe('f');
  });

  it('writes nothing on Escape, nor when the draft is the name', () => {
    const cancelled = editing();
    cancelled.mode.setDraft('Ideas');
    expect(cancelled.mode.onKey({ kind: 'escape' })).toBe(true);
    expect(cancelled.nameOf()).toBe('f');
    expect(cancelled.record.capture).toEqual([]);
    cancelled.mode.setDraft('later');
    cancelled.mode.commit();
    expect(cancelled.nameOf()).toBe('f');
    const unchanged = editing();
    unchanged.mode.commit();
    expect(unchanged.record.capture).toEqual([]);
  });

  it('commits when a press on the board passes on to the select tool, or the mode ends', () => {
    const pressed = editing();
    pressed.mode.setDraft('Board');
    const press = {
      kind: 'pointerDown' as const,
      screen: { x: 0, y: 0 },
      world: { x: 600, y: 600 },
      isShiftPressed: false,
      isModPressed: false,
      zoom: 1,
    };
    expect(pressed.mode.onPointer(press)).toEqual({ isDone: true, isPassedOn: true });
    expect(pressed.mode.onPointer({ ...press, kind: 'pointerMove' })).toEqual({ isDone: false });
    pressed.mode.exit();
    expect(pressed.nameOf()).toBe('Board');
    const abandoned = editing();
    abandoned.mode.setDraft('Gone');
    abandoned.mode.abandon();
    expect(abandoned.nameOf()).toBe('f');
    expect(abandoned.mode.onKey({ kind: 'delete' })).toBe(false);
  });

  it('cuts the draft to the longest name', () => {
    const { mode, nameOf } = editing();
    mode.setDraft('x'.repeat(MAX_FRAME_NAME_LENGTH + 20));
    expect(mode.draft).toHaveLength(MAX_FRAME_NAME_LENGTH);
    mode.commit();
    expect(nameOf()).toHaveLength(MAX_FRAME_NAME_LENGTH);
  });

  it('writes the draft over a name another person changed meanwhile', () => {
    const { mode, refused, store } = editing();
    mode.setDraft('Late');
    store.transact({ kind: 'user', principalId: 'user:bob' as PrincipalId }, (transaction) => {
      transaction.setObject({
        ...frame('f', null, { x: 0, y: 0, width: 100, height: 100 }),
        name: 'x'.repeat(10),
      });
    });
    mode.commit();
    expect(refused).toEqual([]);
    expect(store.get('f' as ObjectId)).toMatchObject({ name: 'Late' });
  });
});
