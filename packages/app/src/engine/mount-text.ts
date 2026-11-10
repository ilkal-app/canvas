import { isStoreRunning, whenStoreIdle } from '@canvas/document';
import type { Camera } from '@canvas/engine';

import { TextEditingFeed } from '../editing/text-editing-feed.js';
import type { CanvasAction } from '../state/shell-action.js';
import type { TextInputBridge } from '../text-input/text-input-bridge.js';

import type { TextStyleChange, TextStyleContext } from './document-text.js';
import type { EngineDocument } from './engine-document.js';
import { bindFrameNameInput, type FrameNameInput } from './frame-name-input.js';
import type { TextInputSide } from './host-input.js';
import { attachTextInput } from './host-text-input.js';
import { yieldToRendering } from './yield-to-rendering.js';

/**
 * A mount's text editing: the hidden input beside its canvas from when the canvas takes
 * input, kept in step with the document side after every change, and the text style reported to
 * the shell only when it changed, and where the person edits text published for presence.
 * Main thread.
 */
export class MountText {
  /** Where the person is editing text, which the shell shares with collaborators. */
  readonly editing = new TextEditingFeed();
  private readonly onTextStyleChange: ((context: TextStyleContext | undefined) => void) | undefined;
  private bridge: TextInputBridge | undefined;
  /** The input over a frame's title band while its name is edited. */
  private frameName: FrameNameInput | undefined;
  /** The text style last reported to the shell. */
  private shown: TextStyleContext | undefined;
  private document: EngineDocument | undefined;
  /** Whether the shell's text style waits for a stepped run to end. */
  private isStyleWaiting = false;
  /** Counts style reads: a staged read shows its context only while it is the latest. */
  private styleReads = 0;

  /**
   * Starts with no input and nothing reported.
   *
   * @param onTextStyleChange - The shell's callback for the text section's style, if any.
   */
  constructor(onTextStyleChange?: (context: TextStyleContext | undefined) => void) {
    this.onTextStyleChange = onTextStyleChange;
  }

  /**
   * Follows a document side, before any change is reported.
   *
   * @param document - The mount's document side.
   */
  follow(document: EngineDocument): void {
    this.document = document;
  }

  /**
   * Puts the hidden input beside the canvas, and the frame name input over it, with the canvas's
   * pointer input, before the host runs (the document side places the caret): a note or text box
   * a click makes while the host starts takes the keys typed next, not the tool shortcuts.
   *
   * @param canvas - The mount's canvas.
   * @param camera - The camera on screen now.
   * @param input - Where the text input's undo, redo and Escape go (the mount's input queue), and
   *   where a frame name refused while a stepped run holds the store is told.
   * @throws {Error} When no document side is followed yet.
   */
  attach(canvas: HTMLCanvasElement, camera: () => Camera, input?: TextInputSide): void {
    if (this.document === undefined) throw new Error('MountText.attach before follow');
    // A canvas outside any page (tests) has nowhere to put an input.
    if ((canvas.ownerDocument as Document | undefined) === undefined) return;
    const runAction =
      input &&
      ((action: CanvasAction) => {
        input.runAction(action);
      });
    this.bridge = attachTextInput(canvas, this.document, camera, runAction);
    const { router } = this.document.tools;
    this.frameName = bindFrameNameInput(canvas, () => router.activeMode, camera, input);
    // A session may have started before this bridge existed (a preview's input waits for its
    // scene frame).
    this.bridge.sync();
    this.frameName.sync();
  }

  /**
   * Brings the input and the shell's text style up to date after a change. While a stepped run
   * holds the board, the style waits and is read once, when the run ends: it reads the
   * whole selection, which each of the run's parts would otherwise read again.
   */
  changed(): void {
    this.bridge?.sync();
    this.frameName?.sync();
    this.editing.publish(this.document?.tools.text.editing());
    const store = this.document?.tools.services().store;
    if (store === undefined || !isStoreRunning(store)) {
      this.publishStyle();
      return;
    }
    if (this.isStyleWaiting) return;
    this.isStyleWaiting = true;
    whenStoreIdle(store, () => {
      this.isStyleWaiting = false;
      this.publishStyle();
    });
  }

  /**
   * Tells the shell the text style, when it changed: read at once, or for a large selection in
   * stages, none shown meanwhile, and shown only if no later read began.
   */
  private publishStyle(): void {
    const text = this.document?.tools.text;
    const read = (this.styleReads += 1);
    if (text?.isStyleStaged() !== true) {
      this.show(text?.styleContext());
      return;
    }
    // The panel never shows a previous selection's style while this one's is read.
    this.show(undefined);
    void text.styleContextInStages(yieldToRendering).then((outcome) => {
      if (outcome !== undefined && read === this.styleReads) this.show(outcome.context);
    });
  }

  /**
   * Tells the shell a text style, when it is not the one shown.
   *
   * @param context - The style.
   */
  private show(context: TextStyleContext | undefined): void {
    if (context === this.shown) return;
    this.shown = context;
    this.onTextStyleChange?.(context);
  }

  /**
   * Applies the text section's change to the text being edited or selected, then gives the
   * editor the keyboard back unless a text field has it.
   *
   * @param change - The change.
   */
  apply(change: TextStyleChange): void {
    this.document?.tools.text.apply(change);
    // A control that let go of the keyboard (the family select) hands it back to the editor,
    // even when the change wrote nothing (the same family chosen again).
    this.bridge?.sync();
  }

  /** Removes the hidden input and the frame name input. */
  destroy(): void {
    this.editing.publish(undefined);
    this.bridge?.destroy();
    this.bridge = undefined;
    this.frameName?.destroy();
    this.frameName = undefined;
  }
}
