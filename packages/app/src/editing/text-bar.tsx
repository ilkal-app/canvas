import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from 'react';

import type { ObjectId } from '@canvas/schema';

import type { TextStyleChange, TextStyleContext } from '../engine/document-text.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import { focusTextEditor, TEXT_BAR_ATTRIBUTE } from '../focus/text-bar-target.js';
import { useIsMobileSite } from '../shell/mobile-site.js';
import { isImeKey } from '../shortcuts/ime-key.js';
import type { ShellAction } from '../state/shell-action.js';
import { BOTTOM_CHROME_ATTRIBUTE } from '../toolbar/bottom-chrome.js';

import type { CameraSource } from './camera-source.js';
import { useKeyboardInset } from './keyboard-inset.js';
import { BarControls } from './text-bar-controls.js';
import {
  drawerClearanceOf,
  editedBoundsOf,
  textBarPlacementOf,
  UNMEASURED_TEXT_BAR,
  type PageBox,
  type TextBarPlacement,
  type TextBarSize,
} from './text-bar-model.js';
import styles from './text-bar.module.css';

/** The chord that moves the keyboard from the text being edited into the bar. */
export const TEXT_BAR_SHORTCUT = 'Alt+F10';

/** Props of {@link TextBar}. */
export interface TextBarProps {
  /** The engine: its board, for where the edited object is. */
  readonly engine: MountedEngine | undefined;
  /** The camera on screen. */
  readonly camera: CameraSource;
  /** The text style the engine reports: the bar shows while a text is edited. */
  readonly context: TextStyleContext | undefined;
  /** Whether the person may edit (a viewer edits no text, so sees no bar). */
  readonly canEdit: boolean;
  /** Applies a change to the edited text (`MountedEngine.applyTextStyle`). */
  readonly onChange: (change: TextStyleChange) => void;
  /** The shell's dispatch: a note colour is a style change of the note. */
  readonly dispatch: (action: ShellAction) => void;
}

/**
 * What of the edited object the bar shows, as one string: its box in the world and, for a sticky
 * note, its colour. The same string while typing leaves both alone, so a keystroke renders the
 * bar again only when what it shows changes.
 *
 * @param engine - The engine.
 * @param id - The edited object, if any.
 * @returns The key; empty when nothing is edited or the object is gone.
 */
function editedKeyOf(engine: MountedEngine | undefined, id: ObjectId | undefined): string {
  if (engine === undefined || id === undefined) return '';
  const board = engine.board.board;
  const bounds = editedBoundsOf(board, id);
  if (bounds === undefined) return '';
  const object = board.get(id);
  const colour = object?.type === 'sticky' ? JSON.stringify(object.color) : '';
  return `${String(bounds.minX)},${String(bounds.minY)},${String(bounds.maxX)},${String(bounds.maxY)};${colour}`;
}

/**
 * Re-renders when the edited object's box or colour changes, or the camera moves, while a text
 * is edited; follows nothing otherwise. A document change that leaves the object's box and colour
 * alone (a keystroke) renders nothing.
 *
 * @param engine - The engine.
 * @param camera - The camera source.
 * @param id - The edited object, while a text is edited.
 * @returns The camera now.
 */
function useFollow(
  engine: MountedEngine | undefined,
  camera: CameraSource,
  id: ObjectId | undefined,
): ReturnType<CameraSource['read']> {
  const isShown = id !== undefined;
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!isShown) return () => undefined;
      const stopCamera = camera.subscribe(listener);
      const stopBoard = engine?.board.subscribe(listener);
      return () => {
        stopCamera();
        stopBoard?.();
      };
    },
    [engine, camera, isShown],
  );
  useSyncExternalStore(subscribe, () => editedKeyOf(engine, id));
  return useSyncExternalStore(subscribe, camera.read);
}

/**
 * The open drawers' boxes on the page (`[data-drawer]`, present only while open).
 *
 * @param page - The page.
 * @returns The layers drawer's and the inspector's boxes, where open.
 */
function drawerBoxesOf(page: Document): {
  readonly layers: PageBox | undefined;
  readonly inspector: PageBox | undefined;
} {
  const boxOf = (name: string) =>
    page.querySelector(`[data-drawer="${name}"]`)?.getBoundingClientRect();
  return { layers: boxOf('layers'), inspector: boxOf('inspector') };
}

/**
 * The bar's and the hint's widths and the open drawers' reach into the canvas, as the page lays
 * them out, measured after each render (a drawer opening or closing renders the shell again) and
 * kept while they hold.
 *
 * @param barRef - The bar.
 * @param hintRef - The hint.
 * @returns The measures; unmeasured before the bar first shows.
 */
function useMeasuredSize(
  barRef: RefObject<HTMLDivElement | null>,
  hintRef: RefObject<HTMLSpanElement | null>,
): TextBarSize {
  const [size, setSize] = useState<TextBarSize>(UNMEASURED_TEXT_BAR);
  useLayoutEffect(() => {
    const bar = barRef.current;
    const layer = bar?.closest<HTMLElement>('[data-text-bar-layer]');
    if (bar == null || layer == null) return;
    const { layers, inspector } = drawerBoxesOf(bar.ownerDocument);
    const next: TextBarSize = {
      barWidthPx: bar.offsetWidth,
      hintWidthPx: hintRef.current?.offsetWidth ?? 0,
      ...drawerClearanceOf(layer.getBoundingClientRect(), layers, inspector),
    };
    const keys = Object.keys(next) as (keyof TextBarSize)[];
    if (keys.some((key) => next[key] !== size[key])) setSize(next);
  });
  return size;
}

/**
 * Moves the keyboard into the bar on {@link TEXT_BAR_SHORTCUT}, from the text editor or anywhere
 * else on the page, while the bar shows. Listens in the capture phase, since the editor's input
 * keeps its keys from the window.
 *
 * @param barRef - The bar.
 * @param isShown - Whether it shows.
 */
function useBarShortcut(barRef: RefObject<HTMLDivElement | null>, isShown: boolean): void {
  useEffect(() => {
    if (!isShown) return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const item = barRef.current?.querySelector<HTMLElement>('[data-text-bar-item]');
      if (!event.altKey || event.key !== 'F10' || item == null) return;
      event.preventDefault();
      event.stopPropagation();
      item.focus();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [barRef, isShown]);
}

/**
 * The bar's keys: Escape gives the keyboard back to the text (editing goes on; a second Escape,
 * there, ends it), the arrows and Home and End move between its controls (a size list keeps its
 * own arrows), and no key reaches the canvas's shortcuts while the bar has focus.
 *
 * @param event - The key.
 */
function onBarKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
  event.stopPropagation();
  const { key, currentTarget, target } = event;
  if (key === 'Escape' && !isImeKey(event.nativeEvent)) {
    event.preventDefault();
    focusTextEditor(currentTarget);
    return;
  }
  if (target instanceof HTMLSelectElement && key !== 'Home' && key !== 'End') return;
  const items = [...currentTarget.querySelectorAll<HTMLElement>('[data-text-bar-item]')];
  const index = items.findIndex((item) => item === target);
  const step = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
  let next: number | undefined;
  if (step !== 0 && index >= 0) next = (index + step + items.length) % items.length;
  else if (key === 'Home') next = 0;
  else if (key === 'End') next = items.length - 1;
  if (next === undefined) return;
  event.preventDefault();
  items[next]?.focus();
}

/**
 * The floating text bar (Figma "States" E1): while a text is edited, over the object
 * (below it when there is no room above), its size, bold, italic, underline, a sticky note's
 * colours and link, with "Esc to finish" beside it. Size, bold and italic restyle the edited
 * range or the caret's pending style as the style panel does (one undo step each); a colour
 * restyles the note; underline and link are not in the stored text style, so they show
 * disabled, "not available yet". A pointer press keeps the keyboard in the text; Alt+F10 moves
 * it into the bar, every control showing focus, and Escape gives it back. It follows the camera
 * and the object only while it shows. Below 768 px wide (Figma MX1) it is docked on the
 * on-screen keyboard instead (`DockedTextBar`), with Done. Page.
 *
 * @param props - The engine, camera, text style and callbacks.
 * @returns The bar, or nothing while no text is edited.
 */
export function TextBar(props: TextBarProps): ReactElement | null {
  const { engine, context } = props;
  const barRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLSpanElement>(null);
  const edited = props.canEdit && context?.isEditing === true ? context.edited : undefined;
  const view = useFollow(engine, props.camera, edited?.id);
  useBarShortcut(barRef, edited !== undefined);
  const size = useMeasuredSize(barRef, hintRef);
  const bounds = edited && engine && editedBoundsOf(engine.board.board, edited.id);
  const isCompact = useIsMobileSite();
  const keyboardInset = useKeyboardInset();
  if (context === undefined || edited === undefined || view === undefined || !bounds) return null;
  const noteId = edited.type === 'sticky' ? edited.id : undefined;
  if (isCompact) {
    return (
      <DockedTextBar
        {...props}
        context={context}
        noteId={noteId}
        barRef={barRef}
        keyboardInsetPx={keyboardInset}
      />
    );
  }
  const placement = textBarPlacementOf(bounds, view, size);
  return (
    <div className={styles.layer} data-text-bar-layer="">
      <BarAnchor placement={placement} hintRef={hintRef}>
        <div
          ref={barRef}
          className={styles.bar}
          role="toolbar"
          aria-label="Text"
          aria-keyshortcuts={TEXT_BAR_SHORTCUT}
          {...{ [TEXT_BAR_ATTRIBUTE]: '' }}
          onKeyDown={onBarKeyDown}
        >
          <BarControls {...props} context={context} noteId={noteId} />
        </div>
      </BarAnchor>
    </div>
  );
}

/** Props of {@link DockedTextBar}. */
interface DockedTextBarProps extends TextBarProps {
  /** The text style, while a text is edited. */
  readonly context: TextStyleContext;
  /** The sticky note being edited, whose colours the bar offers; none for other text. */
  readonly noteId: ObjectId | undefined;
  /** The bar. */
  readonly barRef: RefObject<HTMLDivElement | null>;
  /** The on-screen keyboard's inset (`useKeyboardInset`), CSS px, which the bar sits on. */
  readonly keyboardInsetPx: number;
}

/**
 * The format bar below 768 px wide (Figma MX1): the full width, docked on the on-screen
 * keyboard (its top follows the keyboard as it resizes), with the size, bold, italic, a note's
 * colours and Done, which ends editing as Escape in the text does. Controls not built yet (the
 * underline and the link) and the "Esc to finish" hint are left out at this width.
 *
 * @param props - The bar's props, the text style, the note, the bar's ref and the inset.
 * @returns The docked bar.
 */
function DockedTextBar(props: DockedTextBarProps): ReactElement {
  const { barRef, dispatch, keyboardInsetPx, ...controls } = props;
  return (
    <div className={styles.layer} data-text-bar-layer="">
      <div
        ref={barRef}
        className={styles.dockedBar}
        style={{ bottom: keyboardInsetPx }}
        role="toolbar"
        aria-label="Text"
        aria-keyshortcuts={TEXT_BAR_SHORTCUT}
        {...{ [TEXT_BAR_ATTRIBUTE]: '', [BOTTOM_CHROME_ATTRIBUTE]: '' }}
        onKeyDown={onBarKeyDown}
      >
        <BarControls {...controls} dispatch={dispatch} />
        <button
          type="button"
          className={styles.done}
          data-text-bar-item=""
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            dispatch({ type: 'selection', command: 'deselect' });
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

/** Props of {@link BarAnchor}. */
interface BarAnchorProps {
  /** Where the bar goes. */
  readonly placement: TextBarPlacement;
  /** The hint, measured with the bar to keep both on the canvas. */
  readonly hintRef: RefObject<HTMLSpanElement | null>;
  /** The bar. */
  readonly children: ReactElement;
}

/**
 * Places the bar with the hint on its right.
 *
 * @param props - The placement, the hint's ref and the bar.
 * @returns The anchor.
 */
function BarAnchor(props: BarAnchorProps): ReactElement {
  const { left, y, side } = props.placement;
  return (
    <div className={styles.anchor} style={{ left, top: y }} data-side={side}>
      {props.children}
      <Hint hintRef={props.hintRef} />
    </div>
  );
}

/** Props of {@link Hint}. */
interface HintProps {
  /** The hint's element, which the bar measures. */
  readonly hintRef: RefObject<HTMLSpanElement | null>;
}

/**
 * "Esc to finish".
 *
 * @param props - The hint's ref.
 * @returns The hint.
 */
function Hint(props: HintProps): ReactElement {
  return (
    <span ref={props.hintRef} className={styles.hint}>
      <kbd className={styles.key}>Esc</kbd>
      <span className={styles.hintText}>to finish</span>
    </span>
  );
}
