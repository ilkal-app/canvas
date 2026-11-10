import type { InputMark, InputMarkKind } from '@canvas/engine';

/**
 * Marks armed DOM events as benchmark inputs. For each armed event type a capture
 * listener on the window sees the event first and adds a one-off bubble listener there, which
 * runs after the app's own window listeners; it marks the input then, so the mark travels after
 * whatever the app's handlers sent. An event the app stops before it bubbles (the text editor
 * stops every key and input event at its textarea) is marked just after its dispatch instead. A
 * `draw-move` marks only pressed moves. Nothing listens until a type is armed, so the shipped app
 * pays nothing. Main thread.
 */
export class InputMarks {
  private readonly armed = new Map<string, { kind: InputMarkKind; stop: () => void }>();
  private nextId = 1;

  /**
   * Creates the marker.
   *
   * @param send - Sends a mark to the engine (after the queued scene).
   */
  constructor(private readonly send: (mark: InputMark) => void) {}

  /**
   * Marks every later event of a type as an input of a kind, or stops marking it.
   *
   * @param eventType - The DOM event type, for example `keydown` or `pointerup`.
   * @param kind - The kind to mark it as; `undefined` disarms the type.
   */
  arm(eventType: string, kind: InputMarkKind | undefined): void {
    this.armed.get(eventType)?.stop();
    this.armed.delete(eventType);
    if (kind !== undefined) this.armed.set(eventType, { kind, stop: this.listen(eventType, kind) });
  }

  /** Disarms every type. */
  stop(): void {
    for (const { stop } of this.armed.values()) stop();
    this.armed.clear();
  }

  private listen(eventType: string, kind: InputMarkKind): () => void {
    let pending: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const drop = (): void => {
      if (pending !== undefined) window.removeEventListener(eventType, pending);
      if (timer !== undefined) clearTimeout(timer);
      pending = undefined;
      timer = undefined;
    };
    const capture = (event: Event): void => {
      // A draw move is a pressed one: a hover, or the move before a press, draws no ink.
      if (kind === 'draw-move' && (event as MouseEvent).buttons === 0) return;
      // A stopped event never reached the window's bubble phase: it is marked now, before this one.
      pending?.();
      const mark = (): void => {
        if (pending !== mark) return;
        drop();
        this.send({
          kind,
          id: this.nextId++,
          timestampMs: event.timeStamp,
          markedMs: performance.now(),
        });
      };
      pending = mark;
      window.addEventListener(eventType, mark, { once: true });
      // An event the app stops at its target (the text editor's keys and input events) never
      // bubbles to the window: it is marked after its dispatch, still before the next frame sends
      // the scene it queued.
      timer = setTimeout(mark, 0);
    };
    window.addEventListener(eventType, capture, { capture: true });
    return () => {
      drop();
      window.removeEventListener(eventType, capture, { capture: true });
    };
  }
}
