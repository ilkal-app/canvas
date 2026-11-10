import { useLayoutEffect, useRef, type ReactElement, type ReactNode, type RefObject } from 'react';

import type { ObjectId } from '@canvas/schema';

import type { BoardView } from '../engine/board-view.js';
import { Icon } from '../icons/icon.js';
import { LayersPanel } from '../panels/layers-panel.js';
import type { ShellAction } from '../state/shell-action.js';

import styles from './layers-drawer.module.css';

/** Props of {@link LayersDrawer}. */
export interface LayersDrawerProps {
  /** Whether the drawer is open (`ShellState.isLayersDrawerOpen`); nothing shows while closed. */
  readonly isOpen: boolean;
  /** The board view, or undefined before an engine mounts. */
  readonly view: BoardView | undefined;
  /** The selected ids, primary first. */
  readonly selectedIds: readonly ObjectId[];
  /** The group the select tool entered, whose row is marked. */
  readonly enteredGroupId?: ObjectId | null;
  /** The shell's dispatch: the close button's toggle and the rows' lock toggles. */
  readonly dispatch: (action: ShellAction) => void;
  /** Whether the person may edit the board: no lock toggles if not. True if absent. */
  readonly canEdit?: boolean;
  /** Whether the board's objects are still loading: the list shows skeleton rows. */
  readonly isLoading?: boolean;
  /**
   * The board's page list, at the top of the drawer above the layers; nothing there
   * until pages exist. Pages have no dock button: this drawer is where they are listed.
   */
  readonly pages?: ReactNode;
}

/** The close button's action: the same as the layers toggle's and its shortcut (alt+1). */
const TOGGLE_LAYERS: ShellAction = { type: 'toggleLayersDrawer' };

/**
 * Focuses the drawer's keyboard target, once the list can say what it is: the list's focus row
 * (`tabIndex` 0); or the close button when the list is ready with no rows (an empty board) or
 * busy loading. Nothing while the list's model is still being built.
 *
 * @param drawer - The drawer.
 * @returns Whether focus moved.
 */
function focusInto(drawer: HTMLElement): boolean {
  const row = drawer.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]');
  const tree = drawer.querySelector('[role="tree"]');
  const isSettled =
    tree?.hasAttribute('data-ready') === true || tree?.getAttribute('aria-busy') === 'true';
  const target = row ?? (isSettled ? drawer.querySelector<HTMLElement>('[data-close]') : null);
  target?.focus();
  return target !== null;
}

/**
 * Moves focus into the drawer when it opens and back when it closes: opening (the
 * toggle, alt+1) remembers what had focus and focuses the list's focus row, once the list has
 * its rows (the render after the drawer mounts), or the close button on an empty or loading board;
 * closing gives focus back to what had it, or to the layers toggle, when focus was in the drawer
 * and so went with it. A drawer already open when the shell mounts (the person left it open)
 * takes no focus.
 *
 * @param isOpen - Whether the drawer is open.
 * @param drawerRef - The drawer while open.
 * @param scopeRef - The drawer's anchor, which stays mounted beside the canvas and its layers
 *   toggle.
 */
function useDrawerFocus(
  isOpen: boolean,
  drawerRef: RefObject<HTMLElement | null>,
  scopeRef: RefObject<HTMLElement | null>,
): void {
  const wasOpenRef = useRef(isOpen);
  const returnToRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (wasOpenRef.current === isOpen) return undefined;
    wasOpenRef.current = isOpen;
    if (!isOpen) {
      const active = document.activeElement;
      if (active !== null && active !== document.body) return undefined;
      const returnTo = returnToRef.current;
      returnToRef.current = null;
      const toggle =
        scopeRef.current?.parentElement?.querySelector<HTMLElement>('[data-layers-toggle]');
      (returnTo?.isConnected === true ? returnTo : toggle)?.focus();
      return undefined;
    }
    const active = document.activeElement;
    returnToRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    const drawer = drawerRef.current;
    if (drawer === null || focusInto(drawer)) return undefined;
    // The list builds its model after it mounts; its rows follow in the next render.
    const observer = new MutationObserver(() => {
      if (focusInto(drawer)) observer.disconnect();
    });
    observer.observe(drawer, { subtree: true, childList: true, attributes: true });
    return () => {
      observer.disconnect();
    };
  }, [isOpen, drawerRef, scopeRef]);
}

/**
 * The layers drawer (Figma "06 · Layers drawer", 8:526): a 261 px sheet over the
 * canvas's left side, under the board-name bar and as wide as it, ending above the zoom control,
 * which does not move as it opens and closes. At its top sits the board's page list once pages
 * exist (`pages`); under it the layers panel (`LayersPanel`: virtualised, the tree's
 * keys, the lock toggles), whose header ends with the close button. The layers toggle at the end
 * of the zoom control and alt+1 open and close it (`toggleLayersDrawer`), focus moving into it
 * and back (`useDrawerFocus`).
 *
 * @param props - Whether it is open, the board view, the selection, the dispatch, whether the
 *   person may edit, whether the board is loading, and the page list.
 * @returns The drawer, and the empty anchor it keeps while closed.
 */
export function LayersDrawer(props: LayersDrawerProps): ReactElement {
  const { isOpen, dispatch } = props;
  const drawerRef = useRef<HTMLDivElement>(null);
  const scopeRef = useRef<HTMLDivElement>(null);
  useDrawerFocus(isOpen, drawerRef, scopeRef);
  const close = (
    <button
      type="button"
      className={styles.close}
      aria-label="Close layers"
      data-close=""
      onClick={() => {
        dispatch(TOGGLE_LAYERS);
      }}
    >
      <Icon name="close" />
    </button>
  );
  return (
    <div ref={scopeRef} className={styles.scope}>
      {isOpen ? (
        <div ref={drawerRef} className={styles.drawer} data-drawer="layers">
          {props.pages === undefined ? null : (
            <div className={styles.pages} data-drawer-slot="pages">
              {props.pages}
            </div>
          )}
          <LayersPanel
            view={props.view}
            selectedIds={props.selectedIds}
            enteredGroupId={props.enteredGroupId ?? null}
            dispatch={dispatch}
            canEdit={props.canEdit ?? true}
            isLoading={props.isLoading ?? false}
            headerEnd={close}
          />
        </div>
      ) : null}
    </div>
  );
}
