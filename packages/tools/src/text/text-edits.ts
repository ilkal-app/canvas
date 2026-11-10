import { isStoreRunning, waitForStoreIdle, type DocumentStore } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import type { EditorState } from './editor-state.js';
import type { TypingCapture } from './text-mode-context.js';

/** What a text session's edits work on (`TextEdits`). */
export interface TextEditHost {
  /** The document the session writes. */
  readonly store: DocumentStore;
  /** The object the session edits. */
  readonly objectId: ObjectId;
  /** The mode's undo capture. */
  readonly capture: TypingCapture;
  /** The session's number, for its typing step. */
  readonly sessionId: number;
  /**
   * The session's editor state.
   *
   * @returns The state.
   */
  state(): EditorState;
  /**
   * Sets the session's editor state, as shown.
   *
   * @param state - The new state.
   */
  setState(state: EditorState): void;
  /**
   * Writes a state's content to the document, from the current state.
   *
   * @param next - The state written.
   */
  write(next: EditorState): void;
  /** The session changed: redraw. */
  onChange(): void;
}

/** What held edits need when they are written (`TextEdits`). */
interface HeldEdits {
  /** The editor state as last written: what the held edits started from. */
  readonly baseline: EditorState;
  /** Whether any held edit was a command (a restyle, a paste), not typing. */
  readonly isCommand: boolean;
  /** Whether the last held typing edit ended its step (a word end). */
  readonly isStepEnd: boolean;
}

/** Ended sessions whose edits are still held, per store and edited object: one per object. */
const endedHolds = new WeakMap<DocumentStore, Map<ObjectId, TextEdits>>();

/**
 * A text session's edits, each written in its undo capture: a typing step, or a command's own
 * step. While a stepped run holds the store an edit is held: the session keeps
 * advancing its editor state, so the person sees what they type, but writes nothing; once the
 * store is idle, the latest content is written once, inside the capture the held edits needed,
 * so the undo step is the one the same edits would make while idle. An edit made while idle,
 * before the waiter runs, takes the hold over: its own write carries the latest content.
 *
 * A session that ends with edits held leaves them pending for its object (`afterHeld`); a later
 * session on that object takes them over (`takeOver`): they are written first, in their own
 * capture, before anything this session writes, and the ended session's end knows its object is
 * edited again. Sessions ended in turn during one run chain, each written before the next.
 */
export class TextEdits {
  readonly #host: TextEditHost;
  #held: HeldEdits | undefined;
  /** What waits for the held edits to be written (a session's end). */
  #afterHeld: ((isTakenOver: boolean) => void)[] = [];
  #isWaiting = false;
  /** The ended session whose held edits are written before this session's (`takeOver`). */
  #before: TextEdits | undefined;
  /** Whether a later session took this ended session's object over. */
  #isTakenOver = false;

  /**
   * Makes a session's edits.
   *
   * @param host - The session.
   */
  constructor(host: TextEditHost) {
    this.#host = host;
  }

  /**
   * Whether edits are held.
   *
   * @returns `true` until they are written or dropped.
   */
  get isHolding(): boolean {
    return this.#held !== undefined;
  }

  /**
   * Takes over an ended session's edits held for this session's object, before this session
   * starts: written at once when the store is idle, else once idle, before this session's.
   *
   * @returns The content this session starts from, or `undefined` when nothing was pending.
   */
  takeOver(): EditorState | undefined {
    const { store, objectId } = this.#host;
    const pending = endedHolds.get(store);
    const ended = pending?.get(objectId);
    if (ended === undefined) return undefined;
    pending?.delete(objectId);
    ended.#isTakenOver = true;
    this.#before = ended;
    // Idle: written now. Else once idle, this session's end waiting for it too.
    if (!isStoreRunning(store)) this.#writeBefore();
    else this.#waitForIdle();
    return ended.#host.state();
  }

  /**
   * Moves the held edits' baseline to the document as it changed meanwhile (a run's part
   * updating the edited object): the held state is kept, and written over the change.
   *
   * @param follow - The baseline followed to the document.
   */
  rebase(follow: (baseline: EditorState) => EditorState): void {
    if (this.#held !== undefined)
      this.#held = { ...this.#held, baseline: follow(this.#held.baseline) };
  }

  /**
   * Drops the held edits and what waits for them: the session ended without writing. Its state
   * goes back to what they started from, so a later session never starts from them.
   */
  drop(): void {
    if (this.#held !== undefined) this.#host.setState(this.#held.baseline);
    this.#held = undefined;
    this.#afterHeld = [];
    this.#forgetEnded();
  }

  /**
   * Does `then` once the held edits are written, at once when none is held; never when the
   * store is destroyed first. The session has ended: its held edits are pending for its object,
   * for a later session on it to take over.
   *
   * @param then - What follows the write (a session's end), told whether a later session took
   *   the object over.
   */
  afterHeld(then: (isTakenOver: boolean) => void): void {
    if (this.#held === undefined && !this.#isWaiting) {
      then(this.#isTakenOver);
      return;
    }
    this.#afterHeld.push(then);
    const { store, objectId } = this.#host;
    const pending = endedHolds.get(store) ?? new Map<ObjectId, TextEdits>();
    endedHolds.set(store, pending);
    pending.set(objectId, this);
  }

  /**
   * Writes an edit in its capture, or holds it while a stepped run holds the store.
   *
   * @param next - The state after the edit.
   * @param isCommand - Whether it is a command rather than typing.
   * @param isStepEnd - Whether a typing edit ends its step.
   */
  edit(next: EditorState, isCommand: boolean, isStepEnd: boolean): void {
    const host = this.#host;
    const current = host.state();
    if (next === current) return;
    if (!isStoreRunning(host.store)) {
      this.#writeBefore();
      this.#held = undefined;
      this.#writeInCapture(isCommand, isStepEnd, next);
      return;
    }
    this.#held = {
      baseline: this.#held?.baseline ?? current,
      isCommand: (this.#held?.isCommand ?? false) || isCommand,
      isStepEnd,
    };
    host.setState(next);
    host.onChange();
    this.#waitForIdle();
  }

  /** Writes what is held once the store is idle; nothing when the store is destroyed first. */
  #waitForIdle(): void {
    if (this.#isWaiting) return;
    this.#isWaiting = true;
    void waitForStoreIdle(this.#host.store).then((isIdle) => {
      this.#isWaiting = false;
      if (isIdle) this.#writeHeld();
      else this.drop();
    });
  }

  /** Writes what is held, the store being idle, then what waited for it. */
  #writeHeld(): void {
    this.#writeBefore();
    this.#forgetEnded();
    const held = this.#held;
    const afterHeld = this.#afterHeld;
    this.#held = undefined;
    this.#afterHeld = [];
    if (held !== undefined) {
      const latest = this.#host.state();
      this.#host.setState(held.baseline);
      this.#writeInCapture(held.isCommand, held.isStepEnd, latest);
    }
    for (const then of afterHeld) then(this.#isTakenOver);
  }

  /** Writes the ended session's held edits this session took over, if not written yet. */
  #writeBefore(): void {
    const before = this.#before;
    this.#before = undefined;
    if (before !== undefined) before.#writeHeld();
  }

  /** Takes this session off its object's pending list. */
  #forgetEnded(): void {
    const pending = endedHolds.get(this.#host.store);
    if (pending?.get(this.#host.objectId) === this) pending.delete(this.#host.objectId);
  }

  /**
   * Writes a state in the edit's capture.
   *
   * @param isCommand - A command's own step, not typing.
   * @param isStepEnd - Typing that ends its step.
   * @param next - The state written.
   */
  #writeInCapture(isCommand: boolean, isStepEnd: boolean, next: EditorState): void {
    const { capture, sessionId } = this.#host;
    const write = (): void => {
      this.#host.write(next);
    };
    if (isCommand) capture.command(write);
    else capture.typing(sessionId, write, isStepEnd);
  }
}
