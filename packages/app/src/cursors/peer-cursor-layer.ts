import { worldToScreen, type Camera } from '@canvas/engine';
import type { Point } from '@canvas/schema';

import { easeCursor, type PeerCursor } from './peer-cursors-model.js';
import styles from './peer-cursors.module.css';

/** The mark an agent's cursor carries before its name ("a ✦ for agents"). */
export const AGENT_MARK = '\u2726';

/** What schedules the layer's frames and reads the time; tests pass a manual one. */
export interface CursorFrames {
  /** Asks for a callback before the next paint; returns its handle. */
  readonly request: (callback: (timeMs: number) => void) => number;
  /** Cancels a requested callback. */
  readonly cancel: (handle: number) => void;
}

/** The browser's animation frames. */
export const ANIMATION_FRAMES: CursorFrames = {
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => {
    window.cancelAnimationFrame(handle);
  },
};

/** One drawn cursor: its elements, where it is drawn and where its peer is. */
interface DrawnCursor {
  readonly element: HTMLDivElement;
  readonly label: HTMLSpanElement;
  drawn: Point;
  target: Point;
  /** Who its elements show, so a flush that changes nothing about them writes nothing. */
  labelled: string | undefined;
}

/**
 * Builds one cursor's elements: the round cursor, centred on the pointer, and the name tag beside
 * it.
 *
 * @param cursor - The peer's cursor.
 * @returns The drawn cursor, at the peer's position.
 */
function createCursor(cursor: PeerCursor): DrawnCursor {
  const element = document.createElement('div');
  element.className = styles.cursor ?? '';
  element.dataset.peerCursor = String(cursor.clientId);
  const dot = document.createElement('span');
  dot.className = styles.dot ?? '';
  dot.dataset.cursorDot = '';
  const label = document.createElement('span');
  label.className = styles.name ?? '';
  label.dataset.cursorName = '';
  element.append(dot, label);
  return { element, label, drawn: cursor.point, target: cursor.point, labelled: undefined };
}

/**
 * Writes who a cursor belongs to onto its elements: the name (after a ✦ for an agent), the
 * colourway its stylesheet draws it in and the markers; once per name, colourway and principal,
 * since presence repeats them in every flush.
 *
 * @param drawn - The drawn cursor.
 * @param cursor - The peer's cursor now.
 */
function labelCursor(drawn: DrawnCursor, cursor: PeerCursor): void {
  const labelled = [
    cursor.principalId,
    cursor.name,
    cursor.color,
    cursor.colourway,
    String(cursor.isAgent),
  ].join('\n');
  if (drawn.labelled === labelled) return;
  drawn.labelled = labelled;
  const { element, label } = drawn;
  element.dataset.principalId = cursor.principalId;
  element.dataset.presenceColor = cursor.color;
  element.dataset.colourway = cursor.colourway;
  if (cursor.isAgent) element.dataset.agent = '';
  else delete element.dataset.agent;
  if (cursor.isAgent) {
    const mark = document.createElement('span');
    mark.className = styles.agentMark ?? '';
    mark.textContent = AGENT_MARK;
    label.replaceChildren(mark, cursor.name);
  } else {
    label.replaceChildren(cursor.name);
  }
}

/**
 * The collaborators' live cursors over the canvas (item 10): a round cursor in each peer's
 * colourway with their name beside it, after a ✦ for an agent, one per open tab, placed
 * by the camera on screen. Presence arrives at 20–30 Hz, so each cursor eases toward its peer's
 * latest position on animation frames, and stops asking for frames once every cursor has landed;
 * with reduced motion they jump instead. Writes the DOM directly, so a peer's move or a camera move
 * costs a transform per cursor and no render. Main thread.
 */
export class PeerCursorLayer {
  private readonly cursors = new Map<number, DrawnCursor>();
  private camera: Camera | undefined;
  private frame: number | undefined;
  private lastFrameMs: number | undefined;

  /**
   * Starts an empty layer in `container`.
   *
   * @param container - The element the cursors are drawn in, over the canvas.
   * @param frames - Schedules the easing's frames.
   * @param isReducedMotion - Whether cursors jump instead of easing; read at each move.
   */
  constructor(
    private readonly container: HTMLElement,
    private readonly frames: CursorFrames,
    private readonly isReducedMotion: () => boolean,
  ) {}

  /**
   * Shows the peers' cursors now: new ones appear at their position, gone ones are removed and
   * moved ones ease toward theirs.
   *
   * @param cursors - The peers' cursors on the page shown.
   */
  setCursors(cursors: readonly PeerCursor[]): void {
    const seen = new Set<number>();
    const isJump = this.isReducedMotion();
    for (const cursor of cursors) {
      seen.add(cursor.clientId);
      let drawn = this.cursors.get(cursor.clientId);
      if (drawn === undefined) {
        drawn = createCursor(cursor);
        this.cursors.set(cursor.clientId, drawn);
        this.container.append(drawn.element);
      }
      labelCursor(drawn, cursor);
      drawn.target = cursor.point;
      if (isJump) drawn.drawn = cursor.point;
      this.place(drawn);
    }
    for (const [clientId, drawn] of this.cursors) {
      if (seen.has(clientId)) continue;
      drawn.element.remove();
      this.cursors.delete(clientId);
    }
    this.scheduleEasing();
  }

  /**
   * Places every cursor for the camera on screen.
   *
   * @param camera - The camera.
   */
  setCamera(camera: Camera): void {
    this.camera = camera;
    for (const drawn of this.cursors.values()) this.place(drawn);
  }

  /** Removes every cursor and stops asking for frames. */
  destroy(): void {
    if (this.frame !== undefined) this.frames.cancel(this.frame);
    this.frame = undefined;
    for (const drawn of this.cursors.values()) drawn.element.remove();
    this.cursors.clear();
  }

  /**
   * Moves a cursor's element to where it is drawn, for the camera; hidden until there is one.
   *
   * @param drawn - The cursor.
   */
  private place(drawn: DrawnCursor): void {
    const { camera } = this;
    drawn.element.hidden = camera === undefined;
    if (camera === undefined) return;
    const at = worldToScreen(camera, drawn.drawn);
    drawn.element.style.transform = `translate(${String(at.x)}px, ${String(at.y)}px)`;
  }

  /** Asks for a frame while any cursor has not landed on its peer's position. */
  private scheduleEasing(): void {
    if (this.frame !== undefined) return;
    if (![...this.cursors.values()].some(({ drawn, target }) => drawn !== target)) {
      this.lastFrameMs = undefined;
      return;
    }
    this.frame = this.frames.request(this.ease);
  }

  /**
   * One easing frame: each cursor closes on its peer's position by the time since the last.
   *
   * @param timeMs - The frame's time, ms.
   */
  private readonly ease = (timeMs: number): void => {
    this.frame = undefined;
    const elapsedMs = timeMs - (this.lastFrameMs ?? timeMs - 16);
    this.lastFrameMs = timeMs;
    const zoom = this.camera?.zoom ?? 1;
    for (const drawn of this.cursors.values()) {
      if (drawn.drawn === drawn.target) continue;
      drawn.drawn = easeCursor(drawn.drawn, drawn.target, elapsedMs, zoom);
      this.place(drawn);
    }
    this.scheduleEasing();
  };
}
