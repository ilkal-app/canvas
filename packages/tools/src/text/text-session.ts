import { hitTest, type TextLayout, type WorldTransform } from '@canvas/engine';
import type { ObjectId, Point, StyleRun } from '@canvas/schema';

import { moveCaret, type CaretMotion } from './caret-motion.js';
import { composedContent, type ComposedContent, type Composition } from './composed-content.js';
import { selectAll, selectWord, setCaret } from './editor-navigation.js';
import {
  createEditorState,
  hasSelection,
  insertStyleOf,
  selectionRange,
  type EditorState,
} from './editor-state.js';
import { followDocument } from './editor-sync.js';
import { beginComposition, deleteBackward, deleteForward, insertText, setStyle } from './editor.js';
import { commonStyle } from './runs/apply-style.js';
import { shownTextStyle } from './runs/style-fields.js';
import type { TextStylePatch } from './runs/text-style-patch.js';
import { typeText } from './session-edits.js';
import { SessionLayoutCache } from './session-layout-cache.js';
import { textFrameOf, textOriginIn, worldToLocal } from './text-box-frame.js';
import { editedContentOf, withEditedContent, type EditableTextObject } from './text-box-object.js';
import { TextEdits } from './text-edits.js';
import type { TextModeContext } from './text-mode-context.js';
import { TextSessionObject } from './text-session-object.js';
import { canWriteText, LOCKED_WHILE_EDITING_NOTICE } from './text-session-permission.js';

export { LOCKED_WHILE_EDITING_NOTICE } from './text-session-permission.js';

/**
 * One text object's, sticky note's or shape label's text being edited (a shape's label is created
 * by its first character when it has none): the editor state over the object's text, kept
 * in step with the document (a collaborator's typing, an undo: `followDocument`), every edit
 * written at once as one `setTextRuns` with the measured size so collaborators see it live, typing
 * grouped into one undo step per word, an input method's composition shown as a preview and
 * written only when it commits, and the caret, selection and composition shown as overlay
 * rectangles. A box the text tool just made is a draft (`TextSessionObject`), created with its
 * first committed character, so a session ended empty writes nothing. Text a collaborator deletes
 * ends the session with nothing written; text a collaborator locks ends it with a notice, what was
 * typed before already written. Ends by deleting a text object whose text is empty; an empty
 * sticky note is kept. A note's text is placed inside its padding (`textOriginIn`), as
 * the engine draws it. Main thread; no DOM.
 */
export class TextEditingSession {
  /** The object being edited. */
  readonly id: ObjectId;
  /** Sessions are numbered, so the undo policy knows when typing moved to another session. */
  private static nextSessionId = 1;
  /** This session's number, for the undo policy. */
  readonly sessionId = TextEditingSession.nextSessionId++;
  private state: EditorState;
  /** The input method's composition and its selection in it, shown, not written. */
  private composition: Composition | undefined;
  private readonly context: TextModeContext;
  /** The object written to: the document's, or the text tool's draft until it is created. */
  private readonly target: TextSessionObject;
  private readonly stopListening: () => void;
  private readonly layouts = new SessionLayoutCache();
  /** The edits, written in their undo capture, or held during a stepped run. */
  private readonly edits: TextEdits;
  /** The runs of a shape's label not written yet: one empty run in the style typing will use. */
  private readonly emptyRuns: readonly StyleRun[];
  private isEnded = false;

  /**
   * Starts editing a text object.
   *
   * @param context - The mode's context.
   * @param object - The text object, sticky note or shape.
   * @param caret - Where the caret starts: a position, or `all` to select the whole text.
   * @param isDraft - Whether the object is the text tool's draft (`draftTextObject`), which the
   *   document does not hold until its first character is written.
   */
  constructor(
    context: TextModeContext,
    object: EditableTextObject,
    caret: number | 'all',
    isDraft = false,
  ) {
    this.context = context;
    this.edits = new TextEdits({
      store: context.store,
      objectId: object.id,
      capture: context.capture,
      sessionId: this.sessionId,
      state: () => this.state,
      setState: (state) => {
        this.state = state;
      },
      write: (next) => {
        this.write(next);
      },
      onChange: context.onChange,
    });
    this.id = object.id;
    this.target = new TextSessionObject(context, object, isDraft);
    this.emptyRuns = [{ length: 0, style: context.newTextStyle() }];
    // An ended session's edits still held for this object come first.
    const content = this.edits.takeOver() ?? editedContentOf(object, this.emptyRuns);
    const state = createEditorState(content.text, content.runs, undefined, content.paragraphs);
    this.state = caret === 'all' ? selectAll(state) : setCaret(state, caret, false);
    this.stopListening = context.store.subscribe((changes) => {
      if (!changes.updated.includes(this.id) && !changes.deleted.includes(this.id)) return;
      this.followObject(changes.origin.kind === 'undo');
    });
  }

  /**
   * The editor state: the text and runs as last written or read, the caret and selection.
   *
   * @returns The state.
   */
  get editor(): EditorState {
    return this.state;
  }

  /**
   * Whether an input method is composing.
   *
   * @returns Whether a composition is shown and not yet written.
   */
  get isComposing(): boolean {
    return this.composition !== undefined;
  }

  /**
   * The edited object's frame to the world, its ancestors included.
   *
   * @returns The transform, or `undefined` once the object is gone.
   */
  frame(): WorldTransform | undefined {
    const object = this.object();
    return object && textFrameOf(object, this.context.store);
  }

  /**
   * The edited object as the document holds it now.
   *
   * @returns The object, or `undefined` once it is gone.
   */
  object(): EditableTextObject | undefined {
    return this.target.current();
  }

  /**
   * The style fields the selection shares, for the style panel: over a range the fields every
   * character has (a missing one is mixed); at a collapsed caret the style typing will use.
   *
   * @returns The fields.
   */
  currentStyle(): TextStylePatch {
    const [start, end] = selectionRange(this.state);
    return start === end
      ? shownTextStyle(insertStyleOf(this.state))
      : commonStyle(this.state.runs, start, end);
  }

  /**
   * Types characters over the selection, or at the caret: a space after a URL links it, list keys
   * act on lists (`typeText`).
   *
   * @param characters - The characters; a newline for Enter.
   */
  type(characters: string): void {
    if (characters !== '') typeText(this, characters);
  }

  /** Backspace. */
  deleteBackward(): void {
    this.edits.edit(deleteBackward(this.state), false, false);
  }

  /** Delete. */
  deleteForward(): void {
    this.edits.edit(deleteForward(this.state), false, false);
  }

  /**
   * Moves the caret or extends the selection (arrows, Home and End, with Shift, mod, Alt); a
   * move ends the undo step typing is in.
   *
   * @param motion - The move.
   */
  move(motion: CaretMotion): void {
    const layout = this.layout();
    this.jump(moveCaret(this.state, motion, layout));
  }

  /** Selects the whole text. */
  selectAll(): void {
    this.jump(selectAll(this.state));
  }

  /**
   * Places the caret at a world point, or extends the selection to it (a click, Shift+click, a
   * drag).
   *
   * @param world - The point, world units.
   * @param isExtending - Whether the anchor stays.
   */
  placeCaret(world: Point, isExtending: boolean): void {
    const index = this.indexAt(world);
    if (index !== undefined) this.jump(setCaret(this.state, index, isExtending));
  }

  /**
   * Selects the word at a world point (a double-click).
   *
   * @param world - The point, world units.
   */
  selectWordAt(world: Point): void {
    const index = this.indexAt(world);
    if (index !== undefined) this.jump(selectWord(this.state, index));
  }

  /**
   * The caret position nearest a world point.
   *
   * @param world - The point, world units.
   * @returns The position, or `undefined` while the text cannot be laid out.
   */
  indexAt(world: Point): number | undefined {
    const object = this.object();
    const layout = this.layout();
    if (object === undefined || layout === undefined) return undefined;
    const local = worldToLocal(textFrameOf(object, this.context.store), world);
    const origin = textOriginIn(object, layout);
    return hitTest(layout, { x: local.x - origin.x, y: local.y - origin.y });
  }

  /**
   * Changes style fields: over a selection, or a link the caret is inside, it is restyled (one
   * undo step); else at a collapsed caret the fields wait as the pending style for the next text.
   *
   * @param patch - The fields.
   */
  setStyle(patch: TextStylePatch): void {
    const next = setStyle(this.state, patch);
    if (next.runs !== this.state.runs || hasSelection(next)) this.edits.edit(next, true, false);
    else {
      this.state = next;
      this.context.onChange();
    }
  }

  /**
   * Applies an edit the session's own methods do not cover (a paste, a cut: `session-clipboard`)
   * and writes it: a typing edit joins the typing undo step, a command is a step of its own.
   *
   * @param next - The editor after the edit.
   * @param kind - `typing` or `command`.
   * @param isWordEnd - For typing, whether the undo step ends after it (a space typed).
   */
  apply(next: EditorState, kind: 'typing' | 'command', isWordEnd = false): void {
    this.edits.edit(next, kind !== 'typing', kind === 'typing' && isWordEnd);
  }

  /** An input method starts composing: a selection is deleted, keeping its style for the result. */
  startComposition(): void {
    if (this.composition !== undefined) return;
    this.edits.edit(beginComposition(this.state), false, false);
    this.composition = { text: '' };
    this.showComposition();
  }

  /**
   * The composition changed: shown in the insert style, not written.
   *
   * @param text - The composed text so far.
   * @param selection - The input method's caret or target segment in it (`Composition`).
   */
  updateComposition(text: string, selection?: readonly [start: number, end: number]): void {
    if (this.composition === undefined) this.startComposition();
    this.composition = { text, selection };
    this.showComposition();
  }

  /**
   * The composition committed: written as one edit.
   *
   * @param text - The committed text; empty when it was cancelled.
   */
  commitComposition(text: string): void {
    this.composition = undefined;
    this.context.setPreview(this.id, undefined);
    if (text !== '') this.edits.edit(insertText(this.state, text), false, true);
    else this.context.onChange();
  }

  /**
   * The text as shown: the document's, with the composition spliced in at the caret.
   *
   * @returns The content and the composition's range.
   */
  displayed(): ComposedContent {
    return composedContent(this.state, this.composition);
  }

  /**
   * The shown text's layout on the page, cached until the content or box changes.
   *
   * @returns The layout, or `undefined` while no font is loaded or the object is gone.
   */
  layout(): TextLayout | undefined {
    const object = this.object();
    return object && this.layouts.layoutOf(this.context, object, this.displayed());
  }

  /**
   * Ends the session: a composition in progress is dropped, a text box left empty is deleted (a
   * sticky note left empty is kept), and the typing step ends. A draft never written writes nothing; one whose text waits for the
   * page's fonts is created now. Safe to call twice.
   *
   * @param isWriting - Whether the end may write; false writes nothing at all (the
   *   waiting text is dropped, an empty text box stays). True if absent.
   */
  end(isWriting = true): void {
    if (this.isEnded) return;
    this.isEnded = true;
    this.stopListening();
    if (this.composition !== undefined || !isWriting) this.context.setPreview(this.id, undefined);
    this.composition = undefined;
    if (!isWriting) this.edits.drop();
    // After the edits held during a stepped run are written.
    this.edits.afterHeld((isTakenOver) => {
      if (isWriting && this.target.isHeld) {
        // The fonts never came: the text is created anyway, to be measured when they do.
        const create = (): void => {
          this.target.writeHeld(true);
        };
        this.context.capture.typing(this.sessionId, create, true);
      }
      // Empty text goes; an empty sticky note stays (the paper is the object).
      const object = this.object();
      const isEmptyText = object?.type === 'text' && object.text === '';
      // Unless a later session opened it meanwhile, its end deciding.
      if (isWriting && isEmptyText && !isTakenOver) this.target.deleteEmpty(this.sessionId);
      this.context.capture.endStep();
    });
  }

  /**
   * Creates a new box's text typed before the page's fonts loaded, now that they have, with its
   * measured size, in the session's typing step. Nothing when nothing waits or the session ended.
   */
  writeHeld(): void {
    if (this.isEnded || !this.target.isHeld) return;
    const create = (): void => {
      this.target.writeHeld(false);
    };
    this.context.capture.typing(this.sessionId, create, false);
    this.context.onChange();
  }

  /**
   * Follows a document change to the edited object: its end when deleted (nothing written) or
   * locked (a notice; the text typed so far is written already), else its new text.
   *
   * @param isOwnUndo - Whether the change is the local user's undo.
   */
  private followObject(isOwnUndo: boolean): void {
    const current = this.object();
    if (current === undefined || current.locked) {
      if (current?.locked === true) this.context.onNotice?.(LOCKED_WHILE_EDITING_NOTICE);
      this.context.requestExit();
      return;
    }
    const { text, runs, paragraphs } = editedContentOf(current, this.emptyRuns);
    // Edits held during a stepped run keep the session's state, written over the change.
    if (this.edits.isHolding) {
      this.edits.rebase((baseline) => followDocument(baseline, text, runs, isOwnUndo, paragraphs));
    } else this.state = followDocument(this.state, text, runs, isOwnUndo, paragraphs);
    this.context.onChange();
  }

  private showComposition(): void {
    const object = this.object();
    if (object === undefined) return;
    const shown = this.displayed();
    const preview = shown.composition ? withEditedContent(object, shown) : undefined;
    this.context.setPreview(this.id, preview);
    this.context.onChange();
  }

  private jump(next: EditorState): void {
    if (next === this.state) return;
    this.context.capture.endStep();
    this.state = next;
    this.context.onChange();
  }

  private write(next: EditorState): void {
    if (!canWriteText(this.context, this.object(), this.state, next)) return;
    const isSame = next.text === this.state.text && next.runs === this.state.runs;
    const isWritten =
      (isSame && next.paragraphs === this.state.paragraphs) || this.target.write(next);
    if (isWritten) this.state = next;
    this.context.onChange();
  }
}
