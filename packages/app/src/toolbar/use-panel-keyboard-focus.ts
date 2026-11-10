import { useRef, useState, type KeyboardEvent, type RefObject } from 'react';

import type { FloatingDockToolId } from '../state/floating-dock.js';
import { isToolPanelId, type ToolPanelId } from '../state/tool-panel-state.js';

import { ROVING_ITEM_ATTRIBUTE } from './use-roving-focus.js';

/**
 * How the floating dock's tool panels take and give back the keyboard: a panel opened
 * from its dock button by Enter or Space takes focus, Escape in it hands focus back to that
 * button, and Escape on a dock button hands it to the canvas. A panel opened by a click or by its
 * key leaves focus where it was.
 */
export interface PanelKeyboardFocus {
  /**
   * The dock's keys: notes Enter or Space on a dock button, Escape there leaves the dock, and the
   * rest go to its roving focus.
   */
  readonly onDockKeyDown: (event: KeyboardEvent) => void;
  /** A pointer pressed in the dock: the next choice is a click's, not a key's. */
  readonly onDockPointerDown: () => void;
  /** A tool was chosen from the dock: its panel takes focus when a key chose it. */
  readonly chosen: (tool: FloatingDockToolId) => void;
  /** The panel that should take focus when it shows, if any. */
  readonly focusPanel: ToolPanelId | undefined;
  /** The panel took focus: the request is done. */
  readonly panelFocused: () => void;
  /**
   * Escape in the open panel: focus goes back to the dock button that opened it by a key, if it
   * opened this panel, else the pressed one (read before `close` unpresses a modeless tool); then
   * the panel closes.
   *
   * @param panel - The open panel.
   * @param close - Closes it.
   */
  readonly returnToDock: (panel: ToolPanelId, close: () => void) => void;
}

/**
 * The floating dock's tool panels by keyboard ({@link PanelKeyboardFocus}).
 *
 * @param dockRef - The dock.
 * @param onRovingKeyDown - The dock's roving focus, which gets every key after this hook's look.
 * @returns The handlers and the pending focus request.
 */
export function usePanelKeyboardFocus(
  dockRef: RefObject<HTMLElement | null>,
  onRovingKeyDown: (event: KeyboardEvent) => void,
): PanelKeyboardFocus {
  // The dock button a key is choosing, until the choice arrives (Space chooses on its release).
  const keyedRef = useRef<HTMLElement | null>(null);
  // The dock button a key opened a panel from, and that panel: another panel (its key) is not its.
  const openerRef = useRef<{ readonly panel: ToolPanelId; readonly button: HTMLElement } | null>(
    null,
  );
  const [focusPanel, setFocusPanel] = useState<ToolPanelId | undefined>(undefined);
  return {
    onDockKeyDown: (event) => {
      const { target } = event;
      if (target instanceof HTMLElement && target.hasAttribute(ROVING_ITEM_ATTRIBUTE)) {
        if (event.key === 'Enter' || event.key === ' ') keyedRef.current = target;
        else if (event.key === 'Escape') {
          // Only the move to the canvas: the shell's Escape (deselect) waits for the next press.
          event.preventDefault();
          target.blur();
        }
      }
      onRovingKeyDown(event);
    },
    onDockPointerDown: () => {
      keyedRef.current = null;
    },
    chosen: (tool) => {
      const keyed = keyedRef.current;
      keyedRef.current = null;
      const panel = keyed !== null && isToolPanelId(tool) ? tool : undefined;
      openerRef.current = panel === undefined || keyed === null ? null : { panel, button: keyed };
      setFocusPanel(panel);
    },
    focusPanel,
    panelFocused: () => {
      setFocusPanel(undefined);
    },
    returnToDock: (panel, close) => {
      const opener = openerRef.current;
      const pressed = dockRef.current?.querySelector<HTMLElement>(
        `[${ROVING_ITEM_ATTRIBUTE}][aria-pressed="true"]`,
      );
      const isOpener = opener?.panel === panel && opener.button.isConnected;
      const button = isOpener ? opener.button : pressed;
      openerRef.current = null;
      button?.focus();
      close();
    },
  };
}
