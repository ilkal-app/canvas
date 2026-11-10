import { useEffect, useRef, type RefObject } from 'react';

import type { WorldBounds } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';

import type { MountedEngine } from '../engine/mounted-engine.js';
import { BOTTOM_CHROME_ATTRIBUTE } from '../toolbar/bottom-chrome.js';

import type { CameraSource } from './camera-source.js';
import { keepInViewDeltaPx, screenSpanOf, unionOfBounds, type ScreenSpan } from './keep-in-view.js';
import { editedBoundsOf } from './text-bar-model.js';

/** What covers the canvas's bottom below 768 px wide: the bar, the pills, the format bar, the sheets. */
const BOTTOM_CHROME_SELECTOR = `[${BOTTOM_CHROME_ATTRIBUTE}], [data-drawer]`;

/** The gap kept between what is kept in view and the chrome, CSS px. */
const CHROME_GAP_PX = 8;

/** What {@link useKeepInView} keeps in view. */
export interface KeepInViewInput {
  /** Whether to keep it in view: the shell's compact form only. */
  readonly isEnabled: boolean;
  /** The workspace, holding the canvas, the top bars and the chrome. */
  readonly workspaceRef: RefObject<HTMLElement | null>;
  /** The engine, once it runs. */
  readonly engine: MountedEngine | undefined;
  /** The camera on screen. */
  readonly camera: CameraSource | undefined;
  /** The objects to keep in view: the text being edited, else the selection. */
  readonly ids: readonly ObjectId[];
  /**
   * What else, changed, asks for a look again: the keyboard's inset, a sheet opening. Any string;
   * a change of it, or of the ids, measures again.
   */
  readonly layoutKey: string;
}

/**
 * Where the canvas shows clear of the chrome: below the top bars, above the highest of the
 * bottom chrome, CSS px on the page.
 *
 * @param workspace - The workspace.
 * @param canvas - The canvas's box.
 * @returns The visible span.
 */
function visibleSpanOf(workspace: HTMLElement, canvas: DOMRect): ScreenSpan {
  const bars = workspace.querySelector('[data-top-bars]')?.getBoundingClientRect();
  const chrome = [...workspace.querySelectorAll(BOTTOM_CHROME_SELECTOR)]
    .map((element) => element.getBoundingClientRect())
    .filter((box) => box.height > 0);
  const top = bars === undefined ? canvas.top : Math.max(canvas.top, bars.bottom + CHROME_GAP_PX);
  const bottom = Math.min(canvas.bottom, ...chrome.map((box) => box.top - CHROME_GAP_PX));
  return { top, bottom };
}

/**
 * Brings the objects into the visible span if they are not, by a wheel over the canvas (the
 * camera's own input, so nothing else moves).
 *
 * @param input - What to keep in view.
 */
function bringIntoView(input: KeepInViewInput): void {
  const workspace = input.workspaceRef.current;
  const canvas = workspace?.querySelector('canvas');
  const view = input.camera?.read();
  const board = input.engine?.board.board;
  if (canvas == null || workspace == null || view === undefined || board === undefined) return;
  const bounds = unionOfBounds(
    input.ids
      .map((id) => editedBoundsOf(board, id))
      .filter((each): each is WorldBounds => each !== undefined),
  );
  if (bounds === undefined) return;
  const box = canvas.getBoundingClientRect();
  const deltaY = keepInViewDeltaPx(
    screenSpanOf(bounds, view, box.top),
    visibleSpanOf(workspace, box),
  );
  if (Math.abs(deltaY) < 1) return;
  canvas.dispatchEvent(
    new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
      deltaY,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    }),
  );
}

/**
 * Keeps the selection's handles and the text being edited clear of the chrome below 768 px
 * wide: when the objects change, the keyboard's inset changes or a sheet opens
 * (`layoutKey`), and they reach under the compact bottom bar, its pills, an open sheet, the
 * format bar or the keyboard (or above the top bar), the board is scrolled just enough to show
 * them, as a wheel over the canvas would. It looks once per change, after the render commits (and
 * once every pointer still down is lifted or cancelled), so it never fights a pan or a drag. Main
 * thread.
 *
 * @param input - Whether to, where, the engine, the camera, the objects and the layout's key.
 */
export function useKeepInView(input: KeepInViewInput): void {
  const { isEnabled, layoutKey } = input;
  const idsKey = input.ids.join(',');
  const latest = useRef(input);
  // The pointers down now, by id: a two-finger pan lifts one finger before the other.
  const press = useRef<{ readonly down: Set<number>; isPending: boolean }>({
    down: new Set(),
    isPending: false,
  });
  useEffect(() => {
    latest.current = input;
  });
  // A press in progress (a tap that just selected, a drag, a pan) is let finish first: the board
  // moved under a finger that is still down would turn the tap into a drag.
  useEffect(() => {
    if (!isEnabled) return undefined;
    const state = press.current;
    const onDown = (event: Event): void => {
      state.down.add((event as PointerEvent).pointerId);
    };
    const onUp = (event: Event): void => {
      state.down.delete((event as PointerEvent).pointerId);
      if (state.down.size > 0 || !state.isPending) return;
      state.isPending = false;
      bringIntoView(latest.current);
    };
    window.addEventListener('pointerdown', onDown, true);
    // The lift is heard last, once the canvas's own handlers have ended the press.
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      state.down.clear();
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [isEnabled]);
  useEffect(() => {
    // After the commit, so the page is laid out as it shows (a sheet that just opened included);
    // the latest input is read, and only these say when to look again.
    if (!isEnabled || idsKey === '') return;
    lookAgain(latest.current, press.current);
  }, [isEnabled, idsKey, layoutKey]);
  useBottomChromeChanges(input.workspaceRef, isEnabled, () => {
    if (latest.current.ids.length > 0) lookAgain(latest.current, press.current);
  });
}

/**
 * Brings the objects into view now, or once the press in progress lifts.
 *
 * @param input - What to keep in view.
 * @param press - The pointers down, and whether a look waits for them.
 * @param press.down - The pointers down.
 * @param press.isPending - Whether a look waits for them to lift.
 */
function lookAgain(input: KeepInViewInput, press: { down: Set<number>; isPending: boolean }): void {
  if (press.down.size > 0) press.isPending = true;
  else bringIntoView(input);
}

/**
 * Calls back when bottom chrome comes, goes or is marked in the workspace: a sheet of the floating chrome opens or closes however it was asked for (its
 * tool chosen again, a panel's own toggle, the reactions), which no layout key follows.
 *
 * @param workspaceRef - The workspace.
 * @param isEnabled - Whether to watch: the compact form only.
 * @param onChange - Called after such a change.
 */
function useBottomChromeChanges(
  workspaceRef: RefObject<HTMLElement | null>,
  isEnabled: boolean,
  onChange: () => void,
): void {
  const latestChange = useRef(onChange);
  useEffect(() => {
    latestChange.current = onChange;
  });
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!isEnabled || workspace === null) return undefined;
    const isChrome = (node: Node): boolean =>
      node instanceof Element &&
      (node.matches(BOTTOM_CHROME_SELECTOR) || node.querySelector(BOTTOM_CHROME_SELECTOR) !== null);
    const observer = new MutationObserver((records) => {
      const isChanged = records.some(
        (record) =>
          record.type === 'attributes' ||
          [...record.addedNodes, ...record.removedNodes].some(isChrome),
      );
      if (isChanged) latestChange.current();
    });
    observer.observe(workspace, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [BOTTOM_CHROME_ATTRIBUTE],
    });
    return () => {
      observer.disconnect();
    };
  }, [workspaceRef, isEnabled]);
}
