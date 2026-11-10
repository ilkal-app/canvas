import { isStoreRunning } from '@canvas/document';
import { worldToScreen, worldTransformOf, type Camera } from '@canvas/engine';
import { FRAME_TITLE_BAND_PX, FrameNameMode, MAX_FRAME_NAME_LENGTH } from '@canvas/tools';

import { BUSY_NOTICE } from '../notices/busy-notices.js';
import { isImeKey } from '../shortcuts/ime-key.js';

import styles from './frame-name-input.module.css';
import type { TextInputSide } from './host-input.js';

/**
 * What the frame name input follows: the active tool mode, if any; a {@link FrameNameMode}
 * shows the input.
 */
export type ActiveModeOf = () => unknown;

/** The frame name input's handle. */
export interface FrameNameInput {
  /** The input, for tests. */
  readonly element: HTMLInputElement;
  /** Shows, places and focuses the input while a frame's name is edited; hides it otherwise. */
  sync(): void;
  /** Removes the input and its listeners. */
  destroy(): void;
}

/** The narrowest the input gets on screen, CSS px, so a short name on a small frame fits. */
const MIN_WIDTH_PX = 120;

/** The text's room beyond its glyphs under the floating chrome: the caret and a little air. */
const TEXT_SLACK_PX = 2;

/**
 * Whether the canvas sits under the whiteboard's floating chrome (item 18): the input
 * then takes the chrome's field look and the width of its text.
 *
 * @param canvas - The canvas.
 * @returns True under the floating chrome.
 */
function isFloatingChrome(canvas: HTMLCanvasElement): boolean {
  return canvas.closest('[data-whiteboard-chrome="floating"]') !== null;
}

/**
 * The width the input's text needs, CSS px: its glyphs in the input's own font plus its padding,
 * edge and a little slack.
 *
 * @param element - The input.
 * @returns The width.
 */
function textWidthPx(element: HTMLInputElement): number {
  const style = getComputedStyle(element);
  const context = element.ownerDocument.createElement('canvas').getContext('2d');
  const glyphs =
    context === null
      ? 0
      : ((context.font = style.font), context.measureText(element.value || ' ').width);
  const edges = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'] as const;
  return Math.ceil(
    glyphs +
      edges.reduce((sum, key) => sum + (Number.parseFloat(style[key]) || 0), 0) +
      TEXT_SLACK_PX,
  );
}

/**
 * Lays the input over a frame's title band: at the frame's top-left corner on screen, turned
 * with the frame, as tall as the band, above the top edge. Under the floating chrome it is as
 * wide as its text, never wider than the frame on screen (item 18); in the classic shell
 * it is as wide as the frame on screen, at least {@link MIN_WIDTH_PX}.
 *
 * @param element - The input.
 * @param mode - The editing mode.
 * @param canvas - The canvas, for its offset in the container.
 * @param camera - The camera now.
 */
function place(
  element: HTMLInputElement,
  mode: FrameNameMode,
  canvas: HTMLCanvasElement,
  camera: Camera,
): void {
  const frame = mode.source.get(mode.frameId);
  if (frame?.type !== 'frame') return;
  const transform = worldTransformOf(frame, mode.source);
  const corner = worldToScreen(camera, { x: transform.x, y: transform.y });
  const angle = Math.atan2(transform.sin, transform.cos);
  const { style } = element;
  style.left = `${String(corner.x + canvas.offsetLeft)}px`;
  style.top = `${String(corner.y + canvas.offsetTop)}px`;
  const onScreen = frame.width * camera.zoom;
  style.width = `${String(
    isFloatingChrome(canvas)
      ? Math.min(textWidthPx(element), onScreen)
      : Math.max(MIN_WIDTH_PX, onScreen),
  )}px`;
  style.transform = `rotate(${String(angle)}rad) translateY(-100%)`;
}

/**
 * Makes the input, hidden, in the canvas's container: one line as tall as the title band, its
 * corner the turning point.
 *
 * @param canvas - The canvas; the input goes in its parent.
 * @returns The input.
 */
function createNameElement(canvas: HTMLCanvasElement): HTMLInputElement {
  const container = canvas.parentElement ?? canvas.ownerDocument.body;
  const element = canvas.ownerDocument.createElement('input');
  element.type = 'text';
  element.maxLength = MAX_FRAME_NAME_LENGTH;
  element.setAttribute('aria-label', 'Frame name');
  Object.assign(element.style, {
    position: 'absolute',
    display: 'none',
    boxSizing: 'border-box',
    height: `${String(FRAME_TITLE_BAND_PX)}px`,
    transformOrigin: '0 0',
    margin: '0',
    padding: '0 4px',
    font: '12px/1 system-ui, sans-serif',
    zIndex: '1',
  });
  // Under the floating chrome the field takes the chrome's look (item 18).
  if (isFloatingChrome(canvas) && styles.floating !== undefined)
    element.classList.add(styles.floating);
  container.append(element);
  return element;
}

/**
 * What a key does to the name being edited: Enter commits and Escape cancels, except while an
 * input method composes, when the key is the input method's (accepting or dismissing a
 * candidate), as the text editor's keys ignore it (`textKeyActionOf`).
 *
 * @param event - The key.
 * @returns The action, or `undefined` for any other key, or any key while composing.
 */
function editorKeyOf(
  event: Pick<KeyboardEvent, 'key' | 'isComposing'> & { readonly keyCode?: number },
): 'commit' | 'cancel' | undefined {
  if (isImeKey(event) || event.key === 'Process') return undefined;
  if (event.key === 'Enter') return 'commit';
  return event.key === 'Escape' ? 'cancel' : undefined;
}

/**
 * Binds the input that edits a frame's name in place: an `<input>` laid over the
 * frame's title band while a {@link FrameNameMode} is active, holding its draft. Typing sets the
 * draft; Enter commits, Escape cancels, and the input losing focus (a click in a panel) commits;
 * a press on the board reaches the mode, which commits. Enter and Escape while an input method
 * composes belong to it (`editorKeyOf`). Its place follows the camera on every
 * animation frame while it shows, and each keystroke at once, so a width that hugs the text
 * (item 18) never lags it.
 *
 * @param canvas - The canvas; the input goes in its parent.
 * @param activeMode - The active tool mode now.
 * @param camera - The camera now.
 * @param busy - The document and where notices go: a commit while a stepped run holds the store
 *   is refused, the input left open. Always committed when absent.
 * @returns The handle.
 */
export function bindFrameNameInput(
  canvas: HTMLCanvasElement,
  activeMode: ActiveModeOf,
  camera: () => Camera,
  busy?: Pick<TextInputSide, 'store' | 'onNotice'>,
): FrameNameInput {
  const element = createNameElement(canvas);
  let shown: FrameNameMode | undefined;
  let frameRequest: number | undefined;
  const view = canvas.ownerDocument.defaultView;
  const editing = (): FrameNameMode | undefined => {
    const mode = activeMode();
    return mode instanceof FrameNameMode && !mode.isFinished ? mode : undefined;
  };
  const follow = () => {
    frameRequest = undefined;
    if (shown === undefined) return;
    place(element, shown, canvas, camera());
    frameRequest = view?.requestAnimationFrame(follow);
  };
  const hide = () => {
    shown = undefined;
    if (frameRequest !== undefined) view?.cancelAnimationFrame(frameRequest);
    frameRequest = undefined;
    element.style.display = 'none';
    if (canvas.ownerDocument.activeElement === element) element.blur();
  };
  let isDestroyed = false; // The blur of removal shows nothing again.
  const sync = () => {
    const mode = isDestroyed ? undefined : editing();
    if (mode === shown) return;
    if (mode === undefined) {
      hide();
      return;
    }
    shown = mode;
    element.value = mode.draft;
    element.style.display = 'block';
    place(element, mode, canvas, camera());
    element.focus();
    element.select();
    frameRequest ??= view?.requestAnimationFrame(follow);
  };
  const onInput = () => {
    shown?.setDraft(element.value);
    if (shown !== undefined) place(element, shown, canvas, camera());
  };
  const commit = () => {
    if (busy !== undefined && isStoreRunning(busy.store)) busy.onNotice(BUSY_NOTICE);
    else shown?.commit();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    // The keys are the input's: none reaches the shell's shortcuts.
    event.stopPropagation();
    const action = editorKeyOf(event);
    if (action === undefined) return;
    event.preventDefault();
    if (action === 'commit') commit();
    else shown?.cancel();
    sync();
  };
  const onBlur = () => {
    commit();
    sync();
  };
  const listening = new AbortController();
  element.addEventListener('input', onInput, { signal: listening.signal });
  element.addEventListener('keydown', onKeyDown, { signal: listening.signal });
  element.addEventListener('blur', onBlur, { signal: listening.signal });
  return {
    element,
    sync,
    destroy() {
      isDestroyed = true;
      hide();
      listening.abort();
      element.remove();
    },
  };
}
