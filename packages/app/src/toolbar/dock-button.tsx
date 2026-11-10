import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';

import { notAvailableName } from '../controls/not-available.js';
import { Tooltip } from '../feedback/tooltip.js';
import type { IconName } from '../icons/icon-paths.js';
import { DOCK_ICON_SIZE_PX, Icon } from '../icons/icon.js';

import styles from './dock.module.css';

/** A shortcut as a dock button shows it. */
export interface ToolButtonHint {
  /** The chord as the platform writes it (`P`, `⇧⌘Z`), shown in the tooltip. */
  readonly label: string;
  /** The chord in `aria-keyshortcuts` form (`P`, `Shift+Meta+Z`), for assistive technology. */
  readonly ariaKeyShortcuts: string;
}

/** What a flyout group's button adds to a dock button. */
export interface DockButtonMenu {
  /** Whether its flyout is open. */
  readonly isOpen: boolean;
  /** Opens the flyout (Enter, ArrowUp, the corner caret, a press held). */
  readonly onOpen: () => void;
}

/** Props of {@link DockButton}. */
export interface DockButtonProps {
  /** What the tooltip calls it: the tool's name, or its variant's in use (`Ellipse`). */
  readonly label: string;
  /**
   * What it is announced by, before its shortcut: the tool's name, with the variant in use after
   * a colon (`Shape: Star`). Default the label.
   */
  readonly name?: string;
  /** Its icon. */
  readonly icon: IconName;
  /** Its shortcut, when it has one. */
  readonly hint: ToolButtonHint | undefined;
  /** Whether its tool is the active one. */
  readonly isPressed: boolean;
  /**
   * Whether its feature exists: an unavailable button shows disabled, says "not available yet",
   * stays focusable and does nothing when pressed.
   */
  readonly isAvailable: boolean;
  /** Called when it is clicked or pressed from the keyboard, unless unavailable. */
  readonly onSelect: () => void;
  /** For a flyout group's button: its flyout, which Enter and ArrowUp open. */
  readonly menu?: DockButtonMenu;
  /** The button element, for a flyout that gives focus back to it. */
  readonly buttonRef?: Ref<HTMLButtonElement>;
  /** What opens over the button (its flyout), inside its slot. */
  readonly children?: ReactNode;
  /**
   * Whether it is in the compact bottom bar below 768 px wide: a 48 px
   * touch target with the shared 20 px icon (`ICON_SIZE_PX`) instead of the dock's 40 px button
   * and 24 px icon. False if absent.
   */
  readonly isCompact?: boolean | undefined;
  /**
   * Whether it is the floating whiteboard dock's: the 40 px button with the shared
   * 20 px icon, as the design draws it. False if absent.
   */
  readonly hasSmallIcon?: boolean | undefined;
}

/** How long a press must be held on a group's button to open its flyout, ms. */
export const FLYOUT_HOLD_MS = 400;

/**
 * The words a button is announced and titled by: `Shape: Star (R)`, `Select (V)`, or for a
 * disabled one `Pencil — not available yet` (no date, no issue).
 *
 * @param name - Its name, with the variant.
 * @param hint - Its shortcut.
 * @param isAvailable - Whether it can be used.
 * @returns The name.
 */
export function dockButtonName(
  name: string,
  hint: ToolButtonHint | undefined,
  isAvailable: boolean,
): string {
  if (!isAvailable) return notAvailableName(name);
  return hint === undefined ? name : `${name} (${hint.label})`;
}

/**
 * One dock button (Figma "Dock · modes & flyouts"): its icon ({@link DOCK_ICON_SIZE_PX}, 24 px
 * centred in the 40 px square since 2026-10-07), a tooltip on hover and keyboard
 * focus with its name and shortcut, announced as the tool's name with its variant and shortcut
 * (`Shape: Star (R)`), `aria-pressed` for the active tool and `aria-keyshortcuts` for its
 * shortcut. A mouse press does not take focus, so choosing a tool leaves focus (and a text edit)
 * where it was. A button whose feature is not built shows faint, is `aria-disabled` (so it stays
 * in the dock's focus order and its tooltip is readable), says "not available yet" in its
 * tooltip and name, and does nothing on a click or a key. A flyout group's button adds a corner
 * caret and `aria-haspopup`: Enter and ArrowUp open its flyout, as do the caret and a held press;
 * a click and Space choose the item it shows. In the compact bottom bar (`isCompact`) it
 * is a 48 px target with a 20 px icon.
 *
 * @param props - The button's tool, hint, state and handlers.
 * @returns The button.
 */
export function DockButton(props: DockButtonProps): ReactElement {
  const { label, hint, isPressed, isAvailable, onSelect, menu } = props;
  const announced = dockButtonName(props.name ?? label, hint, isAvailable);
  const hold = useHoldToOpen(menu);
  return (
    <Tooltip
      text={isAvailable ? label : notAvailableName(label)}
      shortcut={isAvailable ? hint?.label : undefined}
    >
      {(tooltipId) => (
        <>
          <button
            ref={props.buttonRef}
            type="button"
            className={props.isCompact === true ? styles.compactButton : styles.button}
            data-dock-item=""
            aria-pressed={isAvailable && isPressed}
            aria-disabled={isAvailable ? undefined : true}
            aria-keyshortcuts={isAvailable ? hint?.ariaKeyShortcuts : undefined}
            aria-label={announced}
            aria-describedby={tooltipId}
            aria-haspopup={menu === undefined ? undefined : 'menu'}
            aria-expanded={menu?.isOpen}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onPointerDown={hold.onPointerDown}
            onPointerUp={hold.cancel}
            onPointerLeave={hold.cancel}
            onKeyDown={(event) => {
              openOnKey(event, menu);
            }}
            onClick={() => {
              if (hold.wasOpened()) return;
              if (isAvailable) onSelect();
            }}
          >
            {props.isCompact === true || props.hasSmallIcon === true ? (
              <Icon name={props.icon} />
            ) : (
              <Icon name={props.icon} size={DOCK_ICON_SIZE_PX} />
            )}
          </button>
          {menu !== undefined && (
            <span
              className={styles.caret}
              aria-hidden="true"
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={menu.onOpen}
            />
          )}
          {props.children}
        </>
      )}
    </Tooltip>
  );
}

/**
 * Opens a group's flyout on Enter or ArrowUp, the key's default (pressing the button, moving
 * focus) prevented.
 *
 * @param event - The key.
 * @param menu - The group's flyout; nothing for a plain button.
 */
function openOnKey(event: KeyboardEvent, menu: DockButtonMenu | undefined): void {
  if (menu === undefined || (event.key !== 'Enter' && event.key !== 'ArrowUp')) return;
  event.preventDefault();
  event.stopPropagation();
  menu.onOpen();
}

/** A press held on a group's button, which opens its flyout. */
interface HoldToOpen {
  readonly onPointerDown: (event: PointerEvent) => void;
  readonly cancel: () => void;
  /** Whether the press just released opened the flyout (its click then chooses nothing). */
  readonly wasOpened: () => boolean;
}

/** The held press's state, kept across renders. */
interface HoldState {
  timer: ReturnType<typeof setTimeout> | undefined;
  isOpened: boolean;
}

/**
 * Opens a group's flyout when a primary press is held for {@link FLYOUT_HOLD_MS}; the click that
 * ends that press then chooses nothing.
 *
 * @param menu - The group's flyout; none for a plain button.
 * @returns The press's handlers.
 */
function useHoldToOpen(menu: DockButtonMenu | undefined): HoldToOpen {
  const ref = useRef<HoldState>({ timer: undefined, isOpened: false });
  useEffect(() => {
    const state = ref.current;
    return () => {
      clearTimeout(state.timer);
    };
  }, []);
  return {
    onPointerDown: (event) => {
      const state = ref.current;
      if (menu === undefined || event.button !== 0) return;
      state.isOpened = false;
      clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        state.isOpened = true;
        menu.onOpen();
      }, FLYOUT_HOLD_MS);
    },
    cancel: () => {
      clearTimeout(ref.current.timer);
      ref.current.timer = undefined;
    },
    wasOpened: () => {
      const { isOpened } = ref.current;
      ref.current.isOpened = false;
      return isOpened;
    },
  };
}
