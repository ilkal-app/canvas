import { describe, expect, it } from 'vitest';

import {
  createHistory,
  runCommand,
  setTextRunsCommand,
  moveObjectsCommand,
} from '@canvas/document';
import type { ObjectId, TextStyle } from '@canvas/schema';

import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';
import { TYPING_CAPTURE_WINDOW_MS, TypingUndoPolicy } from './typing-undo-policy.js';

const STYLE: TextStyle = {
  fontFamily: 'Liberation Sans',
  fontSize: 16,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

/**
 * Sets up a text on the demo board, the user's history with the typing window, and the policy.
 *
 * @returns The history, the policy, and helpers that type, move and read.
 * @throws {Error} When the demo board has no shape.
 */
function setUp() {
  const store = createDemoDocument();
  const [marker] = [...store.read().objects.values()].filter((object) => object.type === 'shape');
  if (marker === undefined) throw new Error('the demo board has shapes');
  const text = { id: 'typed' as ObjectId };
  store.transact(LOCAL_USER_ORIGIN, (transaction) => {
    transaction.setObject({
      id: text.id,
      type: 'text',
      parentId: null,
      x: 0,
      y: 0,
      rotation: 0,
      z: 'a0',
      locked: false,
      createdBy: LOCAL_USER_ORIGIN.principalId,
      createdAt: 1,
      updatedAt: 1,
      width: 10,
      height: 10,
      text: '',
      runs: [{ length: 0, style: STYLE }],
      align: 'left',
      autoWidth: true,
      verticalAlign: 'top',
    });
  });
  const history = createHistory(store, LOCAL_USER_ORIGIN.principalId, {
    captureTimeout: TYPING_CAPTURE_WINDOW_MS,
  });
  const policy = new TypingUndoPolicy(store, history);
  const environment = { clock: () => 1_790_000_000_000, createId: () => 'x' as ObjectId };
  const typeTo = (value: string): void => {
    runCommand(
      store,
      LOCAL_USER_ORIGIN,
      setTextRunsCommand,
      { id: text.id, text: value, runs: [{ length: value.length, style: STYLE }] },
      environment,
    );
  };
  const move = (): void => {
    runCommand(
      store,
      LOCAL_USER_ORIGIN,
      moveObjectsCommand,
      { moves: [{ id: marker.id, by: { x: 1, y: 0 } }] },
      environment,
    );
  };
  const textNow = (): string => {
    const object = store.get(text.id);
    return object?.type === 'text' ? object.text : '';
  };
  return { history, policy, typeTo, move, textNow, marker, store };
}

describe('TypingUndoPolicy', () => {
  it('joins the keystrokes of a word into one step and ends it at a space', () => {
    const { history, policy, typeTo, textNow } = setUp();
    policy.typing(
      1,
      () => {
        typeTo('h');
      },
      false,
    );
    policy.typing(
      1,
      () => {
        typeTo('hi');
      },
      false,
    );
    policy.typing(
      1,
      () => {
        typeTo('hi ');
      },
      true,
    );
    policy.typing(
      1,
      () => {
        typeTo('hi y');
      },
      false,
    );
    policy.typing(
      1,
      () => {
        typeTo('hi yo');
      },
      false,
    );
    history.undo();
    expect(textNow()).toBe('hi ');
    history.undo();
    expect(textNow()).toBe('');
  });

  it('keeps every other command its own step, even inside the window', () => {
    const { history, move, marker, store } = setUp();
    move();
    move();
    history.undo();
    expect(store.get(marker.id)?.x).toBe(marker.x + 1);
  });

  it('makes the commands of one edit one step (a restyle of several text objects)', () => {
    const { history, policy, typeTo, move, textNow, marker, store } = setUp();
    policy.command(() => {
      typeTo('x');
      move();
    });
    move();
    history.undo();
    expect(store.get(marker.id)?.x).toBe(marker.x + 1);
    history.undo();
    expect(textNow()).toBe('');
    expect(store.get(marker.id)?.x).toBe(marker.x);
  });

  it('ends the typing step at a caret jump, a command, or another session', () => {
    const { history, policy, typeTo, textNow } = setUp();
    policy.typing(
      1,
      () => {
        typeTo('a');
      },
      false,
    );
    policy.endStep();
    policy.typing(
      1,
      () => {
        typeTo('ab');
      },
      false,
    );
    policy.command(() => {
      typeTo('abC');
    });
    policy.typing(
      2,
      () => {
        typeTo('abCd');
      },
      false,
    );
    history.undo();
    expect(textNow()).toBe('abC');
    history.undo();
    expect(textNow()).toBe('ab');
    history.undo();
    expect(textNow()).toBe('a');
    policy.destroy();
  });
});
