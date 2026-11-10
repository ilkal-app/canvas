import type { ObjectId, Point } from '@canvas/schema';

import { creationColor } from '../ink/creation-ink.js';
import type {
  ToolCursor,
  ToolKeyInput,
  ToolMode,
  ToolPointerInput,
  ToolStep,
} from '../modes/tool-mode.js';
import { TOOL_STEP_CONTINUE } from '../modes/tool-mode.js';
import { isDoublePress, stampOf, type PressStamp } from '../select/double-press.js';
import { SELECTION_COLOR, type SelectionOverlayModel } from '../select/overlay-rects.js';
import type { SelectPointer } from '../select/select-input.js';
import { CLICK_THRESHOLD_PX } from '../select/select-tool.js';

import type { CaretMotion } from './caret-motion.js';
import { newTextObject } from './new-text-object.js';
import { sessionLinkAt } from './run-link-at.js';
import { isEditableTextObject, isTextBoxObject } from './text-box-object.js';
import type { TextModeContext } from './text-mode-context.js';
import { isOnSessionBox, sessionOverlayRects } from './text-session-geometry.js';
import { draftTextObject } from './text-session-object.js';
import { TextEditingSession } from './text-session.js';

/** How a text mode starts. */
export type TextModeStart =
  | {
      /** The text tool: a click or drag on the board creates a box and edits it. */
      readonly kind: 'create';
    }
  | {
      /**
       * Editing an existing text object's or sticky note's text, or a shape's label (a
       * double-click on it, or Enter).
       */
      readonly kind: 'edit';
      /** The object. */
      readonly id: ObjectId;
      /** Where the caret goes; the whole text is selected when omitted (Enter). */
      readonly world?: Point;
    };

/** How far outside the edited box a press still moves the caret, CSS px. */
const BOX_MARGIN_PX = 4;

/** What the primary button is doing. */
type TextPress =
  | { readonly kind: 'create'; readonly start: SelectPointer; readonly last: Point }
  | { readonly kind: 'caret' };

/**
 * The text tool and text editing mode: with the text tool, a click on the board creates an
 * auto-width text object and a drag a fixed-width one as wide as the drag, a click on existing
 * text (a sticky note's too) edits it; an activated text object (double-click, Enter) is edited at
 * once, and the sticky tool edits notes through it (`StickyMode`). While editing, a press on the
 * box moves the caret (Shift extends, a double-click selects a word, a drag selects), a press
 * elsewhere commits and hands the press to the select tool, Escape commits and selects the object;
 * the keyboard, the input method and the clipboard reach the session (`session`) through the app's
 * hidden text input. A new box is created with its first character, so ending it empty writes
 * nothing; committing text emptied deletes the object. Main thread; no DOM.
 */
export class TextMode implements ToolMode {
  readonly id = 'text' as const;
  private readonly context: TextModeContext;
  private editing: TextEditingSession | undefined;
  private press: TextPress | undefined;
  /** The last press on the text being edited, which a press soon after makes a double press. */
  private lastPress: PressStamp | undefined;
  private zoom = 1;
  private isExited = false;

  /**
   * Starts the mode.
   *
   * @param context - The document, layout, undo grouping and callbacks.
   * @param start - Whether to create text or edit an object.
   */
  constructor(context: TextModeContext, start: TextModeStart) {
    this.context = context;
    if (start.kind === 'edit') {
      const object = context.store.get(start.id);
      if (isEditableTextObject(object) && context.canEditText?.(object) !== false) {
        this.editing = new TextEditingSession(context, object, start.world ? 0 : 'all');
        if (start.world) this.editing.placeCaret(start.world, false);
      }
    }
  }

  /**
   * The editing session, while one runs: what the hidden text input and the style panel drive.
   *
   * @returns The session, or `undefined` before a box is created or clicked.
   */
  get session(): TextEditingSession | undefined {
    return this.editing;
  }

  /** The I-beam, over the board and over the text. */
  readonly cursor: ToolCursor = 'text';

  onPointer(input: ToolPointerInput): ToolStep {
    if (input.kind === 'pointerCancel') {
      this.press = undefined;
      return TOOL_STEP_CONTINUE;
    }
    this.zoom = input.zoom;
    switch (input.kind) {
      case 'contextPress':
      case 'hold':
        // The context menu is the select tool's; editing text keeps its own keys.
        return TOOL_STEP_CONTINUE;
      case 'pointerDown':
        return this.onPress(input);
      case 'pointerMove':
        this.onDrag(input);
        return TOOL_STEP_CONTINUE;
      case 'pointerUp':
        this.onRelease(input);
        return TOOL_STEP_CONTINUE;
    }
  }

  onKey(input: ToolKeyInput): boolean {
    const session = this.editing;
    switch (input.kind) {
      case 'escape': {
        const id = session?.id;
        this.context.requestExit();
        if (id !== undefined && this.context.store.get(id) !== undefined) {
          this.context.selectObjects([id]);
        }
        return true;
      }
      case 'delete':
        session?.deleteBackward();
        return session !== undefined;
      case 'selectAll':
        session?.selectAll();
        return session !== undefined;
      case 'enter':
        session?.type('\n');
        return session !== undefined;
      case 'nudge':
        session?.move(nudgeMotion(input.direction, input.isLarge));
        return session !== undefined;
    }
  }

  overlay(): Partial<SelectionOverlayModel> {
    const press = this.press;
    if (press?.kind === 'create') {
      const { start, last } = press;
      const x = Math.min(start.world.x, last.x);
      const width = Math.abs(last.x - start.world.x);
      const pixel = 1 / this.zoom;
      const box = { x, y: start.world.y, width, height: pixel, rotation: 0 };
      return { toolRects: width > 0 ? [{ box, color: SELECTION_COLOR }] : [] };
    }
    if (this.editing === undefined) return {};
    return {
      frame: undefined,
      outlines: [],
      canResize: false,
      toolRects: sessionOverlayRects(
        this.editing,
        this.zoom,
        this.context.creationInk?.theme(),
        this.context.creationInk?.overlayPalette?.(),
        { tokens: this.context.store.readTokens(), board: this.context.store.read() },
      ),
    };
  }

  onZoom(zoom: number): void {
    // Only a new zoom resizes what the mode shows; the caller asks after every change.
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    this.context.onChange();
  }

  exit(): void {
    this.close(true);
  }

  abandon(): void {
    this.close(false);
  }

  /**
   * Ends the mode once: the press is dropped and the session ended, writing or not.
   *
   * @param isWriting - Whether the session's end may write (`TextSession.end`).
   */
  private close(isWriting: boolean): void {
    if (this.isExited) return;
    this.isExited = true;
    this.press = undefined;
    this.editing?.end(isWriting);
    this.editing = undefined;
  }

  private onPress(input: SelectPointer): ToolStep {
    const session = this.editing;
    // A double press in the text selects a word (the select tool's `isDoublePress`).
    const isSecond = session !== undefined && isDoublePress(this.lastPress, input, session.id);
    this.lastPress = session === undefined || isSecond ? undefined : stampOf(input, session.id);
    if (session !== undefined) {
      if (!isOnSessionBox(session, input.world, BOX_MARGIN_PX / this.zoom)) {
        return { isDone: true, isPassedOn: true };
      }
      // A ⌘/Ctrl-press on a linked character leaves the caret and selection: the app
      // opens the link on a genuine click (trusted, primary, short, still over the canvas;
      // `useLinkClicks`), never the tool on a press, which could be synthetic, a touch or a drag.
      if (input.isModPressed && sessionLinkAt(session, input.world) !== undefined) {
        this.press = undefined;
        return TOOL_STEP_CONTINUE;
      }
      if (isSecond) session.selectWordAt(input.world);
      else session.placeCaret(input.world, input.isShiftPressed);
      this.press = { kind: 'caret' };
      return TOOL_STEP_CONTINUE;
    }
    const existing = this.context.textAt?.(input.world, this.zoom);
    const object = existing === undefined ? undefined : this.context.store.get(existing);
    if (isTextBoxObject(object) && !object.locked) {
      if (this.context.canEditText?.(object) === false) return TOOL_STEP_CONTINUE;
      this.editing = new TextEditingSession(this.context, object, 0);
      this.editing.placeCaret(input.world, false);
      this.press = { kind: 'caret' };
      return TOOL_STEP_CONTINUE;
    }
    this.press = { kind: 'create', start: input, last: input.world };
    this.context.onChange();
    return TOOL_STEP_CONTINUE;
  }

  private onDrag(input: SelectPointer): void {
    const { press } = this;
    if (press?.kind === 'create') this.press = { ...press, last: input.world };
    else if (press?.kind === 'caret') this.editing?.placeCaret(input.world, true);
    this.context.onChange();
  }

  private onRelease(input: SelectPointer): void {
    const { press } = this;
    this.press = undefined;
    if (press?.kind !== 'create') return;
    const dragged = Math.hypot(
      input.screen.x - press.start.screen.x,
      input.screen.y - press.start.screen.y,
    );
    const release = dragged >= CLICK_THRESHOLD_PX ? input.world : press.start.world;
    this.create(press.start.world, release);
  }

  /**
   * Starts editing the empty text box a press made, as a draft: the caret and the box show at
   * once, and the document gets the object with its first committed character.
   *
   * @param start - The press, world units.
   * @param release - The release (the press itself for a click).
   */
  private create(start: Point, release: Point): void {
    const base = this.context.newTextStyle();
    // The text's `ink` is resolved where it starts: typed in that colour.
    const { store, creationInk } = this.context;
    const style = { ...base, color: creationColor(store, start, base.color, creationInk, 'text') };
    const context: TextModeContext = { ...this.context, newTextStyle: () => style };
    const align = this.context.newTextAlign?.() ?? 'left';
    const empty = this.context.layout.layout({
      text: '',
      runs: [{ length: 0, style }],
      wrapWidth: null,
      align,
    });
    const lineHeight = empty?.height ?? style.fontSize * 1.25;
    const fields = newTextObject(start, release, style, lineHeight, align);
    const draft = draftTextObject(context, fields);
    this.editing = new TextEditingSession(context, draft, 0, true);
    this.context.onChange();
  }
}

/**
 * An arrow key as a caret move, when the canvas rather than the text input has the keyboard.
 *
 * @param direction - Which arrow.
 * @param isExtending - Whether Shift is held.
 * @returns The move.
 */
function nudgeMotion(
  direction: 'up' | 'down' | 'left' | 'right',
  isExtending: boolean,
): CaretMotion {
  const isVertical = direction === 'up' || direction === 'down';
  const sign = direction === 'up' || direction === 'left' ? -1 : 1;
  return { unit: isVertical ? 'line' : 'character', direction: sign, isExtending };
}
