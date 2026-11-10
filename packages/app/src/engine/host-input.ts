import { isStoreRunning, type DocumentStore } from '@canvas/document';

import { BUSY_NOTICE, INPUT_CHANGED_NOTICE } from '../notices/busy-notices.js';
import type { CanvasAction } from '../state/shell-action.js';

import { cameraInputForCanvasAction } from './canvas-action-input.js';
import { canvasActionEntry, type CanvasInputContext } from './canvas-input-checks.js';
import type { DocumentInputQueue } from './document-input-queue.js';
import type { ScreenPointerInput } from './select-input-binding.js';

/** What {@link HostInput} works with: the mount's queue, its checks' board and the mount. */
export interface HostInputOptions {
  /** The person's input queue (`createEngineDocument`). */
  readonly queue: DocumentInputQueue;
  /** Where the queue's checks read the board, the page and the selection. */
  readonly context: CanvasInputContext;
  /** Shows the person a notice. */
  readonly onNotice: (message: string) => void;
  /** The camera's zoom now. */
  readonly zoom: () => number;
  /** Whether an action is refused because the person cannot edit. */
  readonly refuses: (action: CanvasAction) => boolean;
  /** Acts on a canvas action at the zoom when the person acted: clipboard, document, camera. */
  readonly act: (action: CanvasAction, zoom: number) => void;
}

/** What a mount's text input and frame name input send to {@link HostInput}. */
export interface TextInputSide {
  /** The document, which a frame name commit checks is not busy. */
  readonly store: DocumentStore;
  /** Runs the text input's undo, redo and Escape, through the queue. */
  readonly runAction: (action: CanvasAction) => void;
  /** Shows the person a notice. */
  readonly onNotice: (message: string) => void;
}

/**
 * A mount's input while a stepped run may hold the store: canvas actions, tool
 * changes and the text input's keys go through the input queue, checked again when they replay,
 * the camera's own actions excepted; a press on the board while a run holds the store starts no
 * gesture, and a press begun before it that is released during it is cancelled, writing nothing.
 * Main thread.
 */
export class HostInput {
  readonly #options: HostInputOptions;
  /** A press refused while busy: its moves and release are dropped too. */
  #isPressRefused = false;

  /**
   * Makes the mount's input.
   *
   * @param options - The queue, the board it checks and the mount.
   */
  constructor(options: HostInputOptions) {
    this.#options = options;
  }

  /**
   * Runs a canvas action: the camera's at once, others through the queue at the zoom of now.
   *
   * @param action - The action.
   */
  runCanvasAction(action: CanvasAction): void {
    const { queue, context, zoom, act, refuses } = this.#options;
    // A viewer's editing action (duplicate, cut and paste included) does nothing.
    if (refuses(action)) return;
    const at = zoom();
    if (this.#isCameraOnly(action)) {
      act(action, at);
      return;
    }
    queue.run(
      canvasActionEntry(action, context, () => {
        if (!refuses(action)) act(action, at);
      }),
    );
  }

  /**
   * What the text input and the frame name input send here: undo, redo and Escape through the
   * queue, and the store and notices a busy frame name commit is refused with.
   *
   * @returns The text input's side.
   */
  textInput(): TextInputSide {
    return {
      store: this.#options.context.board,
      runAction: (action) => {
        this.runCanvasAction(action);
      },
      onNotice: this.#options.onNotice,
    };
  }

  /**
   * Restyles text from the text bar: into the session being edited (held during a run), or
   * the selected texts now, refused while a stepped run holds the store.
   *
   * @param isEditing - Whether a text session is active.
   * @param apply - Restyles.
   */
  applyTextStyle(isEditing: boolean, apply: () => void): void {
    if (isEditing || !this.isBusy) apply();
    else this.#options.onNotice(BUSY_NOTICE);
  }

  /**
   * Changes the tool through the queue: leaving a mode can commit it (a text box, a crop, a frame
   * name, a path), so it waits behind the input before it, and for a run to end.
   *
   * @param apply - Changes it.
   */
  setActiveTool(apply: () => void): void {
    const { queue, context } = this.#options;
    const page = context.page();
    const check = () => (context.page() === page ? undefined : INPUT_CHANGED_NOTICE);
    queue.run({ check, run: apply });
  }

  /**
   * Passes pointer input on, or not, while a stepped run holds the store: a press then is
   * refused (told, and its moves and its end, a release, cancel or touch hold, dropped); a
   * release then of a press begun before becomes a cancel, so the gesture writes nothing. Hover
   * moves and context presses pass.
   *
   * @param input - The input.
   * @returns What reaches the tools, or `undefined` for nothing.
   */
  gate(input: ScreenPointerInput): ScreenPointerInput | undefined {
    const isBusy = isStoreRunning(this.#options.context.board);
    if (input.kind === 'pointerDown') {
      this.#isPressRefused = isBusy;
      if (isBusy) this.#options.onNotice(BUSY_NOTICE);
      return isBusy ? undefined : input;
    }
    // A context press always passes; a refused press ends with its release, cancel or hold.
    if (input.kind === 'contextPress') return input;
    if (this.#isPressRefused) {
      this.#isPressRefused = input.kind === 'pointerMove';
      return undefined;
    }
    if (input.kind !== 'pointerUp' || !isBusy) return input;
    this.#options.onNotice(BUSY_NOTICE);
    return { kind: 'pointerCancel' };
  }

  /**
   * Whether a stepped run holds the store now.
   *
   * @returns True while busy.
   */
  get isBusy(): boolean {
    return isStoreRunning(this.#options.context.board);
  }

  /** Forgets the input waiting: the person can no longer edit, or the mount is going. */
  drop(): void {
    this.#options.queue.drop();
  }

  /**
   * Whether an action is the camera's alone, acting at once even during a run: a zoom, a frame,
   * a nudge with nothing selected (a pan). A component command never is: going to a main
   * switches page and selects before the camera frames it.
   *
   * @param action - The action.
   * @returns True for the camera's.
   */
  #isCameraOnly(action: CanvasAction): boolean {
    if (action.type === 'component' || cameraInputForCanvasAction(action) === undefined) {
      return false;
    }
    return action.type !== 'nudge' || this.#options.context.selection().length === 0;
  }
}
