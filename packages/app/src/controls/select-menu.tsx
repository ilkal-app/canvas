import {
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from 'react';

import { useTypeahead } from '../focus/typeahead.js';
import { Icon } from '../icons/icon.js';

import { menuPosition, useCloseOutside } from './select-menu-popup.js';
import styles from './select-menu.module.css';

/** One choice of a {@link SelectMenu}. */
export interface SelectMenuOption<T extends string> {
  /** Its value. */
  readonly value: T;
  /** Its name, shown in the menu and on the closed control. */
  readonly label: string;
  /** A line under its name in the menu, if any. */
  readonly description?: string;
}

/** An action at the foot of a {@link SelectMenu}, under a rule (the role menu's Remove access). */
export interface SelectMenuAction {
  /** Its name. */
  readonly label: string;
  /** Called when it is chosen. */
  readonly onSelect: () => void;
}

/** Props of {@link SelectMenu}. */
export interface SelectMenuProps<T extends string> {
  /** Its accessible name ("Role of Grace Hopper"). */
  readonly label: string;
  /** The value chosen. */
  readonly value: T;
  /** The choices, in order. */
  readonly options: readonly SelectMenuOption<T>[];
  /** Receives a value chosen, only when it differs from {@link SelectMenuProps.value}. */
  readonly onChange: (value: T) => void;
  /** Whether it is held back while an action runs. */
  readonly isDisabled: boolean;
  /** An action under the choices, if any. */
  readonly action?: SelectMenuAction | undefined;
  /** `field` draws its edge, beside a text field; `quiet` (the default) only on hover. */
  readonly variant?: 'field' | 'quiet' | undefined;
  /** Receives the control, to put focus back on it. */
  readonly controlRef?: { current: HTMLButtonElement | null } | undefined;
}

/**
 * The index the keys move to in an open menu of `count` items: Down and Up step (no wrap),
 * Home and End jump; undefined for any other key.
 *
 * @param key - The key.
 * @param active - The item active now.
 * @param count - How many items.
 * @returns The next item, or undefined.
 */
function steppedIndex(key: string, active: number, count: number): number | undefined {
  switch (key) {
    case 'ArrowDown':
      return Math.min(active + 1, count - 1);
    case 'ArrowUp':
      return Math.max(active - 1, 0);
    case 'Home':
    case 'PageUp':
      return 0;
    case 'End':
    case 'PageDown':
      return count - 1;
    default:
      return undefined;
  }
}

/** What a {@link SelectMenu}'s list needs. */
interface MenuListProps<T extends string> {
  /** The list's id. */
  readonly id: string;
  /** Its name. */
  readonly label: string;
  /** The value chosen. */
  readonly value: T;
  /** The choices. */
  readonly options: readonly SelectMenuOption<T>[];
  /** The action under them, if any. */
  readonly action: SelectMenuAction | undefined;
  /** The item active. */
  readonly active: number;
  /** Where the list sits. */
  readonly position: CSSProperties;
  /** Whether it shows; closed, it stays in the page, hidden from everyone. */
  readonly isOpen: boolean;
  /** An item's id. */
  readonly optionId: (index: number) => string;
  /** Makes an item active. */
  readonly onActive: (index: number) => void;
  /** Chooses an item. */
  readonly onChoose: (index: number) => void;
}

/**
 * The props every item of the list shares: its id, its active mark and its pointer handlers
 * (a press never takes focus from the control).
 *
 * @param props - The list.
 * @param index - The item.
 * @returns The item's props.
 */
function itemProps<T extends string>(props: MenuListProps<T>, index: number) {
  return {
    id: props.optionId(index),
    role: 'option',
    'data-active': index === props.active,
    onMouseDown: (event: { preventDefault: () => void }) => {
      event.preventDefault();
    },
    onMouseEnter: () => {
      props.onActive(index);
    },
    onClick: () => {
      props.onChoose(index);
    },
  } as const;
}

/**
 * The menu: a listbox of the choices, hidden while the menu is closed (in the page all along, as
 * the APG's select-only combobox keeps it), each with its description and a check by the value
 * chosen, then the action (Remove access) under a rule.
 *
 * @param props - The list.
 * @returns The listbox.
 */
function MenuList<T extends string>(props: MenuListProps<T>): ReactElement {
  const { id, label, value, options, action, position } = props;
  return (
    <ul
      id={id}
      role="listbox"
      aria-label={label}
      className={styles.menu}
      style={position}
      hidden={!props.isOpen}
    >
      {options.map((option, index) => (
        <li
          key={option.value}
          {...itemProps(props, index)}
          aria-selected={option.value === value}
          aria-labelledby={`${props.optionId(index)}-label`}
          aria-describedby={
            option.description === undefined ? undefined : `${props.optionId(index)}-description`
          }
          className={styles.option}
        >
          <span className={styles.optionText}>
            <span id={`${props.optionId(index)}-label`} className={styles.optionLabel}>
              {option.label}
            </span>
            {option.description === undefined ? null : (
              <span
                id={`${props.optionId(index)}-description`}
                className={styles.optionDescription}
              >
                {option.description}
              </span>
            )}
          </span>
          {option.value === value ? <Icon name="check" /> : null}
        </li>
      ))}
      {action === undefined ? null : (
        <li {...itemProps(props, options.length)} aria-selected={false} className={styles.removal}>
          {action.label}
        </li>
      )}
    </ul>
  );
}

/**
 * A select-only combobox (WAI-ARIA APG) drawn as the Control states sheet's select (Figma
 * 35:1786): closed, hover, open with a check by the value chosen, and the focus ring. Focus stays
 * on the control; the active item is its `aria-activedescendant`. Closed, Down, Up, Enter, Space,
 * Home and End open it; open, Down and Up move (no wrap), Home and End jump, Enter, Space and
 * Alt+Up choose and close, Escape closes it without leaving the dialog, and Tab closes it and
 * moves on. A press outside, or a scroll, closes it. Its control's `value` is the value chosen.
 *
 * @param props - Its name, value, choices, handler and options.
 * @returns The control and, while open, its menu.
 */
export function SelectMenu<T extends string>(props: SelectMenuProps<T>): ReactElement {
  const { label, value, options, isDisabled, action, variant = 'quiet' } = props;
  const listId = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const menu = useMenuState(props, wrapperRef);
  const chosen = options[menu.chosenIndex];
  const optionId = (index: number): string => `${listId}-${String(index)}`;
  return (
    <span ref={wrapperRef} className={styles.wrapper}>
      <button
        ref={(element) => {
          menu.controlRef.current = element;
          if (props.controlRef !== undefined) props.controlRef.current = element;
        }}
        type="button"
        role="combobox"
        className={styles.select}
        data-variant={variant}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={menu.isOpen}
        aria-controls={menu.isOpen ? listId : undefined}
        aria-activedescendant={menu.isOpen ? optionId(menu.active) : undefined}
        value={value}
        disabled={isDisabled}
        onClick={menu.toggle}
        onKeyDown={menu.onKeyDown}
      >
        <span className={styles.value}>{chosen?.label}</span>
        <Icon name="chevron-down" />
      </button>
      <MenuList
        isOpen={menu.isOpen}
        id={listId}
        label={label}
        value={value}
        options={options}
        action={action}
        active={menu.active}
        position={menu.position}
        optionId={optionId}
        onActive={menu.setActive}
        onChoose={menu.choose}
      />
    </span>
  );
}

/**
 * The names typeahead reads of a {@link SelectMenu}'s rows: its options', then its action's.
 *
 * @param props - The menu's props.
 * @returns The names, in order.
 */
function namesOf<T extends string>(props: SelectMenuProps<T>): string[] {
  return [...props.options.map((option) => option.label), props.action?.label ?? ''];
}

/**
 * A {@link SelectMenu}'s state: open or not, the active item, where the list sits, and what
 * the keys and presses do.
 *
 * @param props - The menu's props.
 * @param wrapperRef - The control and its list.
 * @returns The state and its handlers.
 */
function useMenuState<T extends string>(
  props: SelectMenuProps<T>,
  wrapperRef: RefObject<HTMLElement | null>,
) {
  const { value, options, onChange, action } = props;
  const controlRef = useRef<HTMLButtonElement | null>(null);
  const [isOpen, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({});
  const typeahead = useTypeahead();
  const count = options.length + (action === undefined ? 0 : 1);
  const chosenIndex = Math.max(
    options.findIndex((option) => option.value === value),
    0,
  );
  const close = (): void => {
    setOpen(false);
  };
  useCloseOutside(isOpen, wrapperRef, close);
  const open = (at: number): void => {
    if (controlRef.current !== null) setPosition(menuPosition(controlRef.current));
    setActive(at);
    setOpen(true);
  };
  const choose = (index: number): void => {
    setOpen(false);
    const option = options[index];
    if (option !== undefined) {
      if (option.value !== value) onChange(option.value);
    } else if (index === options.length) {
      action?.onSelect();
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!isOpen) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        open(event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : chosenIndex);
      }
      return;
    }
    // Typed letters move to the option they start, and are the menu's even naming none.
    const typed = event.key === 'Enter' ? undefined : typeahead(event, namesOf(props), active);
    if (typed !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      if (typed.next !== undefined) setActive(typed.next);
    } else if (event.key === 'Escape') {
      // The menu's, not the dialog's: Escape closes the menu and the dialog stays open.
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      close();
    } else if (['Enter', ' '].includes(event.key) || (event.key === 'ArrowUp' && event.altKey)) {
      event.preventDefault();
      choose(active);
    } else {
      const next = steppedIndex(event.key, active, count);
      if (next === undefined) return;
      event.preventDefault();
      setActive(next);
    }
  };
  const toggle = (): void => {
    if (isOpen) close();
    else open(chosenIndex);
  };
  return {
    controlRef,
    isOpen,
    active,
    setActive,
    position,
    chosenIndex,
    choose,
    onKeyDown,
    toggle,
  };
}
