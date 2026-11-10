import type { DocumentStore, UndoHistory } from '@canvas/document';
import type { TypingCapture } from '@canvas/tools';

/**
 * The local user's history's capture window, ms (`createHistory`'s `captureTimeout`): typing in
 * one word stays one undo step for this long between keystrokes. Every other change is closed
 * off at once by the policy, so the window only ever joins typing.
 */
export const TYPING_CAPTURE_WINDOW_MS = 30_000;

/** What the policy needs of the history: ending the current step. */
export type CapturingHistory = Partial<Pick<UndoHistory, 'stopCapturing'>>;

/**
 * How edits join undo steps: the local user's history has a capture window
 * ({@link TYPING_CAPTURE_WINDOW_MS}), and this policy calls `stopCapturing()` around every change
 * that is not a typing edit of the active text session, so each command stays one step, while the
 * keystrokes of one word join into one: a space or newline typed, a caret jump, another session or
 * any other command ends the step. It watches the document, so the select tool's commands, undo
 * itself and writes made beside the engine (a comment's pin) are closed off without knowing about
 * it (the history merges a change only when the previous one left capturing open). It watches the
 * document's updates, not its change sets: Yjs sends those after the history has recorded the
 * change, while change sets can come before, and a step closed before its change is recorded stays
 * open. Main thread.
 */
export class TypingUndoPolicy implements TypingCapture {
  private readonly history: CapturingHistory;
  private readonly stopListening: () => void;
  /** The session whose typing step is open, if one is. */
  private openSession: number | undefined;
  /** Whether an edit the policy runs is writing: its changes join one step. */
  private isRunning = false;

  /**
   * Starts closing off every change that is not typing.
   *
   * @param store - The document the history records.
   * @param history - The local user's history; without `stopCapturing` nothing ever joins.
   */
  constructor(store: DocumentStore, history: CapturingHistory) {
    this.history = history;
    this.stopListening = store.subscribeUpdates(() => {
      if (this.isRunning) return;
      this.openSession = undefined;
      this.stop();
    });
  }

  typing(sessionId: number, run: () => void, isWordEnd: boolean): void {
    if (this.openSession !== sessionId) this.stop();
    this.runJoined(run);
    this.openSession = isWordEnd ? undefined : sessionId;
    if (isWordEnd) this.stop();
  }

  command(run: () => void): void {
    this.endStep();
    // Several commands of one edit (a restyle of several text objects) are one step.
    this.runJoined(run);
    this.endStep();
  }

  endStep(): void {
    this.openSession = undefined;
    this.stop();
  }

  /** Stops watching the document. */
  destroy(): void {
    this.stopListening();
  }

  /**
   * Runs an edit whose changes the history may join into the open step.
   *
   * @param run - Runs the edit's commands.
   */
  private runJoined(run: () => void): void {
    this.isRunning = true;
    try {
      run();
    } finally {
      this.isRunning = false;
    }
  }

  private stop(): void {
    this.history.stopCapturing?.();
  }
}
