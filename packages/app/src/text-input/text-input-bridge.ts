import {
  copySelection,
  cutSelection,
  deleteBy,
  parseRunsPayload,
  pasteInto,
  replaceText,
  RUNS_MIME_TYPE,
  serializeRunsPayload,
  type DeletionUnit,
  type RunsPayload,
  type TextEditingSession,
} from '@canvas/tools';

import { isEditableTarget } from '../focus/editable-target.js';
import { isInTextBar } from '../focus/text-bar-target.js';
import type { KeyboardPlatform } from '../shortcuts/keyboard-platform.js';

import { textKeyActionOf, type TextCommandAction } from './text-keys.js';
import { mirrorEditOf, mirrorOf, type TextMirror } from './text-mirror.js';

/** What the hidden text input drives: the text being edited, and the actions around it. */
export interface TextInputTarget {
  /**
   * The text being edited now.
   *
   * @returns Its session, or `undefined` when nothing is edited.
   */
  session(): TextEditingSession | undefined;
  /**
   * Where the caret is on screen, CSS px from the canvas's top-left, to put the input method's
   * window by it.
   *
   * @returns The caret's top-left and height, or `undefined`.
   */
  caretOnScreen(): { readonly x: number; readonly y: number; readonly height: number } | undefined;
  /**
   * Runs a key action the session has no method for: undo, redo, Escape, bold and italic.
   *
   * @param action - The action.
   */
  run(action: TextCommandAction): void;
}

/** The hidden text input's handle. */
export interface TextInputBridge {
  /** The textarea, for tests. */
  readonly element: HTMLTextAreaElement;
  /** Focuses the input while text is edited and releases it when not; call after any change. */
  sync(): void;
  /** Removes the input and its listeners. */
  destroy(): void;
}

/**
 * Writes styled content to a clipboard event: plain text and the runs flavour.
 *
 * @param event - The copy or cut event.
 * @param content - The content.
 */
function writeClipboard(event: ClipboardEvent, content: RunsPayload): void {
  event.clipboardData?.setData('text/plain', content.text);
  event.clipboardData?.setData(RUNS_MIME_TYPE, serializeRunsPayload(content));
}

/** The deletes a `beforeinput` names: how far, and which way. */
const DELETIONS: Readonly<Record<string, readonly [DeletionUnit, -1 | 1]>> = {
  deleteContentBackward: ['character', -1],
  deleteContentForward: ['character', 1],
  deleteWordBackward: ['word', -1],
  deleteWordForward: ['word', 1],
  deleteSoftLineBackward: ['lineEdge', -1],
  deleteSoftLineForward: ['lineEdge', 1],
  deleteHardLineBackward: ['lineEdge', -1],
  deleteHardLineForward: ['lineEdge', 1],
};

/**
 * Runs a `beforeinput` event's edit on a session when it says what it is: typed text, line
 * breaks, deletes by character, word or line, the input's own undo and redo (the keys run
 * those). Anything else, a composition among it, is left to the input: its `input` event is
 * compared with the mirror instead.
 *
 * @param session - The session.
 * @param event - The event.
 * @returns Whether the event was run (and its default must be prevented).
 */
function runInput(session: TextEditingSession, event: InputEvent): boolean {
  const deletion = DELETIONS[event.inputType];
  if (deletion !== undefined) {
    deleteBy(session, ...deletion);
    return true;
  }
  switch (event.inputType) {
    case 'insertText':
      if (event.data === null) return false;
      session.type(event.data);
      return true;
    case 'insertLineBreak':
    case 'insertParagraph':
      session.type('\n');
      return true;
    case 'historyUndo':
    case 'historyRedo':
      return true;
    default:
      return false;
  }
}

/**
 * Creates the hidden textarea: out of sight and out of the pointer's way, focusable by script
 * but no Tab stop.
 *
 * @param container - Where it goes.
 * @returns The textarea.
 */
function createHiddenTextarea(container: HTMLElement): HTMLTextAreaElement {
  const element = container.ownerDocument.createElement('textarea');
  element.setAttribute('aria-label', 'Text editor');
  // Focused by script while a text is edited, never a Tab stop of its own.
  element.tabIndex = -1;
  element.setAttribute('autocapitalize', 'off');
  element.setAttribute('autocomplete', 'off');
  element.spellcheck = false;
  element.dataset.textInput = '';
  Object.assign(element.style, {
    position: 'absolute',
    left: '0px',
    top: '0px',
    width: '1px',
    height: '1em',
    padding: '0',
    border: '0',
    opacity: '0',
    resize: 'none',
    overflow: 'hidden',
    pointerEvents: 'none',
  });
  container.append(element);
  return element;
}

/**
 * The text editor's input: a hidden `<textarea>` beside the canvas that
 * holds the keyboard while a text object is edited, so typing, input methods and the clipboard
 * work as in any text field. It mirrors the edited text (all of it, or a window around the caret
 * of a long text: `mirrorOf`) with its selection, so a screen reader reads the text, the caret
 * and the selection, and a keyboard that deletes by editing the field's value works. Typed
 * characters and deletes that `beforeinput` names go to the session (a word or line delete
 * deletes a word or to the line's edge); an edit it does not name (an Android keyboard's delete,
 * an autocorrection) is found on `input` by comparing the value with the mirror
 * (`mirrorEditOf`). Keys that move the caret, select, undo or style arrive as `keydown`; an input
 * method's composition goes to the session as a preview and commits as one edit, the mirror
 * left to the input method meanwhile; copy and cut write `text/plain` and the runs flavour,
 * paste prefers the runs flavour (validated, never trusted) and falls back to plain text. Its
 * events stop at the textarea, so the window's clipboard router and shortcuts never see them.
 * The textarea sits at the caret, so the input method's window opens there. Main thread.
 */
class HiddenTextInput implements TextInputBridge {
  readonly element: HTMLTextAreaElement;
  private readonly target: TextInputTarget;
  private readonly platform: KeyboardPlatform;
  private readonly listeners: readonly [string, EventListener][];
  /** What the textarea was last given: the edited text's window and selection. */
  private mirror: TextMirror | undefined;
  /** Whether an input method is composing in the textarea, which then owns its value. */
  private isComposing = false;
  /**
   * The composition so far and where it starts in the textarea, for its selection:
   * the input method's caret or target segment, read once the textarea holds the composition.
   */
  private composing: { text: string; start: number } | undefined;

  constructor(container: HTMLElement, target: TextInputTarget, platform: KeyboardPlatform) {
    this.element = createHiddenTextarea(container);
    this.target = target;
    this.platform = platform;
    const stop = (event: Event): void => {
      event.stopPropagation();
    };
    // Every event stops at the textarea, handled or not: the window's shortcuts and clipboard
    // router must never see the editor's keys.
    const handle =
      (run: (event: never) => void) =>
      (event: Event): void => {
        event.stopPropagation();
        run(event as never);
      };
    this.listeners = [
      [
        'keydown',
        handle((event: KeyboardEvent) => {
          this.onKeyDown(event);
        }),
      ],
      ['keyup', stop],
      ['keypress', stop],
      [
        'beforeinput',
        handle((event: InputEvent) => {
          this.onBeforeInput(event);
        }),
      ],
      [
        'input',
        handle((event: InputEvent) => {
          this.onInput(event);
        }),
      ],
      [
        'compositionstart',
        handle(() => {
          this.isComposing = true;
          this.composing = { text: '', start: this.element.selectionStart };
          target.session()?.startComposition();
        }),
      ],
      [
        'compositionupdate',
        handle((event: CompositionEvent) => {
          if (this.composing !== undefined) this.composing.text = event.data;
          target.session()?.updateComposition(event.data);
        }),
      ],
      [
        'compositionend',
        handle((event: CompositionEvent) => {
          this.onCompositionEnd(event);
        }),
      ],
      [
        'copy',
        handle((event: ClipboardEvent) => {
          this.onCopy(event);
        }),
      ],
      [
        'cut',
        handle((event: ClipboardEvent) => {
          this.onCopy(event);
        }),
      ],
      [
        'paste',
        handle((event: ClipboardEvent) => {
          this.onPaste(event);
        }),
      ],
    ];
    for (const [type, listener] of this.listeners) this.element.addEventListener(type, listener);
  }

  sync(): void {
    const { element } = this;
    const isFocused = element.ownerDocument.activeElement === element;
    const session = this.target.session();
    if (session === undefined) {
      if (isFocused) element.blur();
      this.mirror = undefined;
      if (element.value !== '') element.value = '';
      return;
    }
    // The input method owns the value while it composes.
    if (!this.isComposing) this.writeMirror(session);
    const caret = this.target.caretOnScreen();
    if (caret) {
      element.style.left = `${String(caret.x)}px`;
      element.style.top = `${String(caret.y)}px`;
      element.style.height = `${String(Math.max(1, caret.height))}px`;
    }
    // A panel control the person is typing in (the text size), or the text bar the person moved
    // into, keeps the keyboard until it lets go; the editor's selection lives in the
    // editor meanwhile.
    const active = element.ownerDocument.activeElement;
    if (!isFocused && !isEditableTarget(active) && !isInTextBar(active))
      element.focus({ preventScroll: true });
  }

  destroy(): void {
    for (const [type, listener] of this.listeners) this.element.removeEventListener(type, listener);
    this.element.remove();
  }

  private onKeyDown(event: KeyboardEvent): void {
    const session = this.target.session();
    const action = session && textKeyActionOf(event, this.platform, session.editor);
    if (session === undefined || action === undefined) return;
    event.preventDefault();
    if (action.kind === 'move') session.move(action.motion);
    else if (action.kind === 'selectAll') session.selectAll();
    else this.target.run(action);
    this.sync();
  }

  private onBeforeInput(event: InputEvent): void {
    const session = this.target.session();
    if (session === undefined || !runInput(session, event)) return;
    event.preventDefault();
    this.writeMirror(session);
  }

  /**
   * An edit the input made itself: found by comparing its value with the mirror, run on the
   * session, and the mirror written again. Nothing while an input method composes.
   *
   * @param event - The event.
   */
  private onInput(event: InputEvent): void {
    const session = this.target.session();
    const { mirror, element } = this;
    if (session === undefined) return;
    if (this.isComposing || event.isComposing) {
      this.onComposingInput(session);
      return;
    }
    const edit = mirror && mirrorEditOf(mirror, element.value, element.selectionEnd);
    if (mirror !== undefined && edit !== undefined) {
      replaceText(session, mirror.offset + edit.start, mirror.offset + edit.end, edit.text);
    }
    this.writeMirror(session);
  }

  /**
   * The textarea now holds the composition and the input method's selection in it (Chrome sets
   * both after `compositionupdate`, before this `input`): the selection goes to the session,
   * relative to where the composition starts.
   *
   * @param session - The session.
   */
  private onComposingInput(session: TextEditingSession): void {
    const { composing, element } = this;
    if (composing === undefined) return;
    session.updateComposition(composing.text, [
      element.selectionStart - composing.start,
      element.selectionEnd - composing.start,
    ]);
  }

  private onCompositionEnd(event: CompositionEvent): void {
    this.isComposing = false;
    this.composing = undefined;
    const session = this.target.session();
    session?.commitComposition(event.data);
    if (session !== undefined) this.writeMirror(session);
  }

  /**
   * Gives the textarea the edited text's window and selection, changing only what differs, so
   * a screen reader is told of real changes alone.
   *
   * @param session - The session.
   */
  private writeMirror(session: TextEditingSession): void {
    const { element } = this;
    const { text, caret, anchor } = session.editor;
    const mirror = mirrorOf(text, caret, anchor);
    this.mirror = mirror;
    if (element.value !== mirror.value) element.value = mirror.value;
    const { selectionStart, selectionEnd, direction } = mirror;
    const isSelected =
      element.selectionStart === selectionStart &&
      element.selectionEnd === selectionEnd &&
      element.selectionDirection === direction;
    if (!isSelected) element.setSelectionRange(selectionStart, selectionEnd, direction);
  }

  private onCopy(event: ClipboardEvent): void {
    event.preventDefault();
    const session = this.target.session();
    if (session === undefined) return;
    const content = event.type === 'cut' ? cutSelection(session) : copySelection(session);
    if (content !== undefined) writeClipboard(event, content);
  }

  private onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const session = this.target.session();
    const data = event.clipboardData;
    if (session === undefined || data === null) return;
    const styled = parseRunsPayload(data.getData(RUNS_MIME_TYPE));
    pasteInto(session, styled ?? data.getData('text/plain'));
  }
}

/**
 * Puts the text editor's hidden input beside the canvas (`HiddenTextInput`).
 *
 * @param container - Where the textarea goes: the canvas's container.
 * @param target - The text being edited and the actions around it.
 * @param platform - Which modifier is mod.
 * @returns The bridge; call `sync` after every change, `destroy` when the canvas goes.
 */
export function bindTextInput(
  container: HTMLElement,
  target: TextInputTarget,
  platform: KeyboardPlatform,
): TextInputBridge {
  return new HiddenTextInput(container, target, platform);
}
