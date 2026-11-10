// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ParagraphStyle, StyleRun } from '@canvas/schema';
import { RUNS_MIME_TYPE, serializeRunsPayload, type TextEditingSession } from '@canvas/tools';

import { setUpTextDocument } from '../engine/__fixtures__/text-document.js';
import { attachTextInput } from '../engine/host-text-input.js';

import { bindTextInput } from './text-input-bridge.js';

const STYLE = {
  fontFamily: 'Liberation Sans',
  fontSize: 10,
  color: [0, 0, 0, 1] as [number, number, number, number],
  weight: 400 as const,
  italic: false,
};

/**
 * A stand-in session that records what it is asked.
 *
 * @param paragraphs - Its one paragraph's style; plain by default.
 * @returns The session and its record.
 */
function fakeSession(paragraphs: readonly ParagraphStyle[] = [{}]) {
  const calls: unknown[][] = [];
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push([name, ...args]);
    };
  const runs: StyleRun[] = [{ length: 2, style: STYLE }];
  const editor = { text: 'ab', runs, caret: 2, anchor: 0, pending: undefined, paragraphs };
  const session = {
    editor,
    isComposing: false,
    type: record('type'),
    deleteBackward: record('deleteBackward'),
    deleteForward: record('deleteForward'),
    move: record('move'),
    selectAll: record('selectAll'),
    startComposition: record('startComposition'),
    updateComposition: record('updateComposition'),
    commitComposition: record('commitComposition'),
    apply: record('apply'),
  };
  return { session: session as unknown as TextEditingSession, calls };
}

function setUp(isEditing = true, paragraphs?: readonly ParagraphStyle[]) {
  const container = document.createElement('main');
  document.body.append(container);
  const { session, calls } = fakeSession(paragraphs);
  const run = vi.fn();
  const bridge = bindTextInput(
    container,
    {
      session: () => (isEditing ? session : undefined),
      caretOnScreen: () => ({ x: 12, y: 34, height: 20 }),
      run,
    },
    'mac',
  );
  const outside = vi.fn();
  container.addEventListener('keydown', outside);
  container.addEventListener('paste', outside);
  return { bridge, calls, run, outside, element: bridge.element };
}

function input(inputType: string, data: string | null = null): InputEvent {
  return new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true });
}

function clipboard(type: string, data: Record<string, string> = {}): Event {
  const store = new Map(Object.entries(data));
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (format: string) => store.get(format) ?? '',
      setData: (format: string, value: string) => store.set(format, value),
      store,
    },
  });
  return event;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('bindTextInput', () => {
  it('focuses the hidden textarea at the caret while text is edited', () => {
    const { bridge, element } = setUp();
    bridge.sync();
    expect(document.activeElement).toBe(element);
    expect([element.style.left, element.style.top, element.style.height]).toEqual([
      '12px',
      '34px',
      '20px',
    ]);
    bridge.destroy();
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('leaves the keyboard in the text bar while the person is there', () => {
    const { bridge, element } = setUp();
    const bar = document.createElement('div');
    bar.setAttribute('data-text-bar', '');
    const bold = document.createElement('button');
    bar.append(bold);
    document.body.append(bar);
    bold.focus();
    bridge.sync();
    expect(document.activeElement).toBe(bold);
    bold.blur();
    bridge.sync();
    expect(document.activeElement).toBe(element);
  });

  it('releases the keyboard when nothing is edited', () => {
    const { bridge, element } = setUp(false);
    element.focus();
    bridge.sync();
    expect(document.activeElement).not.toBe(element);
  });

  it('types, breaks lines and deletes from input events, and keeps them from the page', () => {
    const { element, calls } = setUp();
    for (const event of [
      input('insertText', 'x'),
      input('insertLineBreak'),
      input('deleteContentBackward'),
      input('deleteWordForward'),
      input('historyUndo'),
    ]) {
      element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(calls.map(([name]) => name)).toEqual(['type', 'type', 'apply', 'apply']);
    // What the event does not name is left to the input, and compared with the mirror after.
    for (const event of [input('insertCompositionText', 'か'), input('formatBold')]) {
      element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it('moves the caret and runs shortcuts from keys, stopping them at the textarea', () => {
    const { element, calls, run, outside } = setUp();
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }),
    );
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect(calls).toEqual([
      ['move', { unit: 'character', direction: -1, isExtending: true }],
      ['selectAll'],
    ]);
    expect(run).toHaveBeenCalledWith({ kind: 'toggleBold' });
    expect(outside).not.toHaveBeenCalled();
  });

  it('changes a list item’s level on Tab and leaves Tab alone outside a list', () => {
    const plain = setUp();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    plain.element.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(plain.calls).toEqual([]);
    expect(plain.run).not.toHaveBeenCalled();
    const listed = setUp(true, [{ list: 'bullet' }]);
    const indent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    listed.element.dispatchEvent(indent);
    expect(indent.defaultPrevented).toBe(true);
    expect(listed.run).toHaveBeenCalledWith({ kind: 'indentList' });
  });

  it('stops key-up and key-press at the textarea without acting on them', () => {
    const { element, calls, run } = setUp();
    const outside = vi.fn();
    element.parentElement?.addEventListener('keyup', outside);
    element.parentElement?.addEventListener('keypress', outside);
    const up = new KeyboardEvent('keyup', { key: 'a', bubbles: true, cancelable: true });
    const press = new KeyboardEvent('keypress', { key: 'a', bubbles: true, cancelable: true });
    element.dispatchEvent(up);
    element.dispatchEvent(press);
    expect(outside).not.toHaveBeenCalled();
    expect([up.defaultPrevented, press.defaultPrevented]).toEqual([false, false]);
    expect(calls).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it('shows a composition as it goes and commits it once', () => {
    const { element, calls } = setUp();
    element.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
    element.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'か', bubbles: true }));
    element.dispatchEvent(new CompositionEvent('compositionend', { data: '漢', bubbles: true }));
    expect(calls).toEqual([
      ['startComposition'],
      ['updateComposition', 'か'],
      ['commitComposition', '漢'],
    ]);
  });

  it('passes no selection for composing events that arrive without a composition start', () => {
    const { bridge, element, calls } = setUp();
    bridge.sync();
    element.dispatchEvent(new CompositionEvent('compositionupdate', { data: '中', bubbles: true }));
    element.dispatchEvent(
      new InputEvent('input', { inputType: 'insertCompositionText', isComposing: true }),
    );
    expect(calls).toContainEqual(['updateComposition', '中']);
    expect(calls.filter(([name]) => name === 'updateComposition')).toHaveLength(1);
  });

  it('reads the updated textarea selection on composing input, relative to the composition', () => {
    const { bridge, element, calls } = setUp();
    bridge.sync();
    // The mirror starts as "ab" with its selection covering the text. Put the insertion
    // point between the letters, where an absolute textarea offset differs from a relative one.
    element.setSelectionRange(1, 1);
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    element.dispatchEvent(
      new CompositionEvent('compositionupdate', { data: '中文', bubbles: true }),
    );
    // Chrome updates value and selection before the composing input event. A target over 中
    // occupies textarea offsets [1, 2), but composition offsets [0, 1).
    element.value = 'a中文b';
    element.setSelectionRange(1, 2);
    element.dispatchEvent(
      new InputEvent('input', {
        inputType: 'insertCompositionText',
        data: '中文',
        isComposing: true,
        bubbles: true,
      }),
    );
    expect(calls).toContainEqual(['updateComposition', '中文', [0, 1]]);
  });

  it('copies both flavours and pastes the runs flavour before plain text', () => {
    const { element, calls, outside } = setUp();
    const copy = clipboard('copy');
    element.dispatchEvent(copy);
    const written = (copy as unknown as { clipboardData: { store: Map<string, string> } })
      .clipboardData.store;
    expect(written.get('text/plain')).toBe('ab');
    expect(JSON.parse(written.get(RUNS_MIME_TYPE) ?? '{}')).toMatchObject({ text: 'ab' });
    const styled = { text: 'Hi', runs: [{ length: 2, style: STYLE }] };
    element.dispatchEvent(
      clipboard('paste', { [RUNS_MIME_TYPE]: serializeRunsPayload(styled), 'text/plain': 'Hi' }),
    );
    element.dispatchEvent(
      clipboard('paste', { [RUNS_MIME_TYPE]: '{broken', 'text/plain': 'plain' }),
    );
    expect(calls.map(([name]) => name)).toEqual(['apply', 'apply']);
    expect(outside).not.toHaveBeenCalled();
  });

  it('cuts through the session and ignores clipboard events with nothing edited', () => {
    const edited = setUp();
    edited.element.dispatchEvent(clipboard('cut'));
    expect(edited.calls.map(([name]) => name)).toEqual(['apply']);
    document.body.innerHTML = '';
    const idle = setUp(false);
    const paste = clipboard('paste', { 'text/plain': 'x' });
    idle.element.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(idle.calls).toEqual([]);
  });
});

/**
 * The hidden input over the document side with a real text session, a box started at (40, 60).
 *
 * @returns The textarea, the document side, a text reader and event helpers.
 */
function setUpEditing() {
  const fixture = setUpTextDocument();
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  container.append(canvas);
  document.body.append(container);
  const bridge = attachTextInput(canvas, fixture.document, () => ({
    x: 0,
    y: 0,
    zoom: 1,
    viewportWidthPx: 800,
    viewportHeightPx: 600,
    dpr: 1,
  }));
  fixture.document.setActiveTool('text');
  fixture.press('pointerDown', 40, 60);
  fixture.press('pointerUp', 40, 60);
  bridge.sync();
  const element = bridge.element;
  const beforeInput = (inputType: string, data: string | null = null) => {
    element.dispatchEvent(input(inputType, data));
    bridge.sync();
  };
  /**
   * The input edits its own value (no usable `beforeinput`).
   *
   * @param value - The value it leaves.
   * @param caret - Where it leaves the caret.
   */
  const editValue = (value: string, caret: number) => {
    element.value = value;
    element.setSelectionRange(caret, caret);
    element.dispatchEvent(new InputEvent('input', { bubbles: true }));
    bridge.sync();
  };
  const text = () => fixture.document.tools.text.session()?.editor.text;
  return { element, beforeInput, editValue, text, document: fixture.document };
}

describe('bindTextInput: the mirror', () => {
  it('holds the text being edited and its selection, for a screen reader', () => {
    const { element, beforeInput, text, document: engineDocument } = setUpEditing();
    beforeInput('insertText', 'Hello');
    expect(text()).toBe('Hello');
    expect([element.value, element.selectionStart, element.selectionEnd]).toEqual(['Hello', 5, 5]);
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }),
    );
    const session = engineDocument.tools.text.session();
    expect(session?.editor).toMatchObject({ caret: 4, anchor: 5 });
    expect([element.selectionStart, element.selectionEnd, element.selectionDirection]).toEqual([
      4,
      5,
      'backward',
    ]);
  });

  it('runs an edit the input made itself, found against the mirror', () => {
    const { element, beforeInput, editValue, text } = setUpEditing();
    beforeInput('insertText', 'Hello');
    // An Android keyboard's delete: the value loses its last character, no beforeinput.
    editValue('Hell', 4);
    expect(text()).toBe('Hell');
    editValue('Help', 4);
    expect(text()).toBe('Help');
    expect([element.value, element.selectionStart]).toEqual(['Help', 4]);
  });

  it('deletes a word or to the line edge for the word and line deletes', () => {
    const { beforeInput, text } = setUpEditing();
    beforeInput('insertText', 'one two');
    beforeInput('deleteWordBackward');
    expect(text()).toBe('one ');
    beforeInput('deleteSoftLineBackward');
    expect(text()).toBe('');
  });
});
