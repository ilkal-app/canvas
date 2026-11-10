import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';

import { Icon } from '../icons/icon.js';
import type { SelectionSummary } from '../panels/selection-summary.js';
import { isImeKey } from '../shortcuts/ime-key.js';
import type { KeyEventLike } from '../shortcuts/key-event-match.js';

import type { DrawerSlot } from './drawer-slot.js';
import styles from './drawer.module.css';

/** What {@link useInspectorDrawer} decides from. */
export interface InspectorDrawerInput {
  /**
   * What the inspector is about: the style panel's context and the selected ids. Closing the
   * drawer holds for this subject; a new one opens it again.
   */
  readonly subjectKey: string;
  /** Whether there is something to inspect: a selection, or a creation tool's style. */
  readonly hasSubject: boolean;
  /** Whether the person may edit the board: there is no inspector otherwise. */
  readonly canEdit: boolean;
  /** The right-hand drawer slot, shared with the comments and history panels. */
  readonly slot: DrawerSlot;
  /** The shell's root, whose document's focus the canvas takes back. */
  readonly rootRef: RefObject<HTMLElement | null>;
  /** Whether a key press is the drawer's shortcut (alt+8 by default), as the shell matches it. */
  readonly isToggleKey: (event: KeyEventLike) => boolean;
}

/** The inspector drawer's state and what opens and closes it ({@link useInspectorDrawer}). */
export interface InspectorDrawerBinding {
  /** Whether the drawer is open. */
  readonly isOpen: boolean;
  /** Opens a closed drawer and moves focus into it; closes an open one. Its toggle's click. */
  readonly toggle: () => void;
  /**
   * The shortcut (alt+8): opens the drawer and moves focus into it; with the drawer open and
   * focus elsewhere, moves focus into it; with focus in it, closes it and gives the keyboard
   * back to the canvas.
   */
  readonly toggleFromKeyboard: () => void;
  /**
   * Gives the keyboard back to the canvas (Escape in the drawer): nothing keeps focus, so the
   * canvas's shortcuts, which listen on the window, take the keys.
   */
  readonly focusCanvas: () => void;
  /** The drawer's element, which takes focus when asked. */
  readonly drawerRef: RefObject<HTMLElement | null>;
  /** Whether a key press is the drawer's shortcut ({@link InspectorDrawerInput.isToggleKey}). */
  readonly isToggleKey: (event: KeyEventLike) => boolean;
}

/** The person's last word on the drawer, and the subject it was said about. */
interface Override {
  readonly value: 'open' | 'closed';
  readonly subjectKey: string;
}

/**
 * The inspector drawer's state (the design's inspector frames): it opens on its own when there
 * is something to inspect (a selection, or a creation tool whose style the panel edits) and
 * closes when there is not; its toggle and the shortcut open it whatever is selected, or close
 * it until the subject changes. It shows only while the right-hand slot is free or its own: the
 * comments or history panel, opened, takes the slot, and opening the drawer by hand takes it
 * back. Never for a person who cannot edit.
 *
 * @param input - The subject, whether the person may edit, the slot and the shell's root.
 * @returns The binding.
 */
export function useInspectorDrawer(input: InspectorDrawerInput): InspectorDrawerBinding {
  const { subjectKey, hasSubject, canEdit, slot, rootRef, isToggleKey } = input;
  const [override, setOverride] = useState<Override>();
  const [focusRequest, setFocusRequest] = useState(0);
  const drawerRef = useRef<HTMLElement>(null);
  const choice =
    override?.value === 'closed' && override.subjectKey !== subjectKey
      ? undefined
      : override?.value;
  const isWanted = choice === 'open' || (choice === undefined && hasSubject);
  const isOpen =
    canEdit && (slot.occupant === 'inspector' || (slot.occupant === undefined && isWanted));
  const { claim, release } = slot;
  // The canvas takes the keyboard when nothing in the page has focus (its shortcuts listen on
  // the window), as a number field hands it back on Enter.
  const focusCanvas = useCallback(() => {
    const active = rootRef.current?.ownerDocument.activeElement;
    if (active instanceof HTMLElement) active.blur();
  }, [rootRef]);
  const toggle = useCallback(() => {
    if (isOpen) {
      setOverride({ value: 'closed', subjectKey });
      release('inspector');
      return;
    }
    setOverride({ value: 'open', subjectKey });
    claim('inspector');
    setFocusRequest((count) => count + 1);
  }, [isOpen, subjectKey, claim, release]);
  const toggleFromKeyboard = useCallback(() => {
    const drawer = drawerRef.current;
    if (isOpen && drawer !== null && !drawer.contains(drawer.ownerDocument.activeElement)) {
      setFocusRequest((count) => count + 1);
      return;
    }
    toggle();
    if (isOpen) focusCanvas();
  }, [isOpen, toggle, focusCanvas]);
  useEffect(() => {
    if (focusRequest > 0) drawerRef.current?.focus();
  }, [focusRequest]);
  return { isOpen, toggle, toggleFromKeyboard, focusCanvas, drawerRef, isToggleKey };
}

/** Input types where a key types text: a modified digit there is a character, not a command. */
const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
]);

/**
 * Whether a key press's target takes free text: a text field, a text area or editable content.
 * The drawer's number, colour and range fields, selects and buttons do not.
 *
 * @param target - The event's target.
 * @returns True for free text.
 */
function isTextEntry(target: EventTarget): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type);
}

/**
 * The drawer's own keys, before the window's shortcuts (which skip editable targets): Escape,
 * unless a field took it, gives the keyboard back to the canvas, and the canvas's Escape
 * (deselect) does not run; the drawer's shortcut toggles it from any of its controls, a number
 * field or a select included, but not from free text, where it may type a character (Option+8
 * is "•" on a Mac). Taken here, the shortcut's default is prevented, so nothing is typed into a
 * field, and the window does not run it a second time.
 *
 * @param event - The key press, inside the drawer.
 * @param drawer - The drawer.
 */
function handleDrawerKey(event: ReactKeyboardEvent, drawer: InspectorDrawerBinding): void {
  if (event.defaultPrevented || isImeKey(event.nativeEvent)) return;
  const isEscape = event.key === 'Escape';
  const isToggle = !isEscape && drawer.isToggleKey(event) && !isTextEntry(event.target);
  if (!isEscape && !isToggle) return;
  event.stopPropagation();
  event.preventDefault();
  if (isEscape) drawer.focusCanvas();
  else drawer.toggleFromKeyboard();
}

/** Props of {@link InspectorDrawer}. */
export interface InspectorDrawerProps {
  /** The drawer's state (`useInspectorDrawer`). */
  readonly drawer: InspectorDrawerBinding;
  /** What its header says it shows (`selectionSummary`). */
  readonly summary: SelectionSummary;
  /** What its header offers at its right, before the toggle: the lock and the "more" menu. */
  readonly actions?: ReactNode;
  /** What it holds: the contextual style panel. */
  readonly children: ReactNode;
}

/**
 * The inspector drawer (the design's inspector frames): the right-hand drawer, 296 px, the
 * presence/share bar's width, its header saying what is selected (one object's type, or a count
 * and the objects' type) and holding the contextual style panel. Closed, nothing of it shows
 * (item 11): it opens by itself for a selection or a creation tool's style,
 * and alt+8 opens it (listed in the shortcut sheet). Open, its toggle, a button named
 * "Inspector", sits at the drawer's top-right corner and closes it. Open, the drawer is a region named "Inspector" whose tab order is the panel's
 * sections'; Escape in it, not taken by a field, gives the keyboard back to the canvas, and its
 * shortcut works from its fields too (`handleDrawerKey`). It floats
 * over the canvas, which never resizes as it opens or closes; 768 px wide and more it is only as
 * tall as its content, up to the slot's height, then it scrolls.
 *
 * @param props - The drawer's state, its summary and the panel.
 * @returns The toggle and, when open, the drawer.
 */
export function InspectorDrawer(props: InspectorDrawerProps): ReactElement {
  const { drawer } = props;
  const id = useId();
  return (
    <div
      className={styles.inspector}
      data-inspector=""
      data-open={drawer.isOpen ? '' : undefined}
      onKeyDown={(event) => {
        handleDrawerKey(event, drawer);
      }}
    >
      {drawer.isOpen && (
        <button
          type="button"
          className={styles.toggle}
          aria-label="Inspector"
          aria-expanded
          aria-controls={id}
          aria-keyshortcuts="Alt+8"
          onClick={drawer.toggle}
        >
          <Icon name="inspector" />
        </button>
      )}
      {drawer.isOpen && (
        <section
          ref={drawer.drawerRef}
          id={id}
          className={styles.drawer}
          aria-label="Inspector"
          tabIndex={-1}
          data-drawer="inspector"
        >
          <header className={styles.header}>
            <div className={styles.summary}>
              <h2 className={styles.title}>{props.summary.title}</h2>
              {props.summary.detail === undefined ? null : (
                <p className={styles.detail}>{props.summary.detail}</p>
              )}
            </div>
            {props.actions}
          </header>
          {props.children}
        </section>
      )}
    </div>
  );
}
