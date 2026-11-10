import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import { Icon } from '../icons/icon.js';

import styles from './compact-dropdown.module.css';
import { Menu, type MenuEntry, type MenuItemEntry } from './menu.js';

/** One choice of a {@link CompactDropdown}. */
export interface CompactDropdownOption<T extends string> {
  /** Its value. */
  readonly value: T;
  /** Its name, in the menu and on the trigger ("Medium"). */
  readonly label: string;
  /** Words at its end in the menu (the size in points, "16"). */
  readonly meta?: string | undefined;
  /** What the trigger shows when it is chosen, if not its name ("16"). */
  readonly triggerLabel?: string | undefined;
  /** Inline style for its name in the menu: a font's own face. */
  readonly labelStyle?: CSSProperties | undefined;
  /** Whether it is left out of the menu: a current value that is no choice (a custom size). */
  readonly isHidden?: boolean | undefined;
  /** Called once its row first scrolls into view: a font loading its preview. */
  readonly onVisible?: (() => void) | undefined;
  /** Whether a rule comes before it: it starts a group (the fonts on this computer). */
  readonly isGroupStart?: boolean | undefined;
  /** Whether it can't be chosen now: announced, faded (a local font that would not load). */
  readonly isDisabled?: boolean | undefined;
}

/** Props of {@link CompactDropdown}. */
export interface CompactDropdownProps<T extends string> {
  /** Its accessible name ("Font size"); the trigger is named with the value after it. */
  readonly label: string;
  /** The value chosen. */
  readonly value: T;
  /** The choices, in order. */
  readonly options: readonly CompactDropdownOption<T>[];
  /** Receives a value chosen, only when it differs from {@link CompactDropdownProps.value}. */
  readonly onChange: (value: T) => void;
  /** Whether it is disabled: 38%, announced. */
  readonly isDisabled?: boolean | undefined;
  /**
   * `quiet` (the default) has no edge and takes the pressed surface on hover and open; `field`
   * always shows its control edge, on the raised surface at rest and the pressed one on hover
   * and open.
   */
  readonly variant?: 'quiet' | 'field' | undefined;
  /**
   * The trigger's width, px; as wide as its value if absent. With {@link CompactDropdownProps.maxWidth} it is the
   * least the trigger takes.
   */
  readonly width?: number | undefined;
  /**
   * The most the trigger takes, px: between {@link CompactDropdownProps.width} and this it is as wide as its value,
   * which ellipsizes only beyond it (the font's family). Exactly {@link CompactDropdownProps.width} if absent.
   */
  readonly maxWidth?: number | undefined;
  /** More attributes for its trigger: `data-dock-item` for a toolbar's roving focus. */
  readonly dataAttributes?: Readonly<Record<`data-${string}`, string>> | undefined;
  /**
   * Whether the selection differs on this field: the trigger shows "Mixed" and no
   * choice is checked.
   */
  readonly isMixed?: boolean | undefined;
  /**
   * Content after the choices in the menu (the font size's Custom field), given a function that
   * closes the menu and puts focus back on the trigger.
   */
  readonly footer?: ((close: () => void) => ReactNode) | undefined;
  /** The most the menu's list may take, px, scrolling beyond; unbounded if absent. */
  readonly maxListHeight?: number | undefined;
  /**
   * Rows after the choices, after a rule: actions and notes about them (the font menu's "Show
   * fonts on this computer…"). None if absent.
   */
  readonly extraEntries?: readonly MenuEntry[] | undefined;
  /**
   * Whether the trigger is named by the choice's name rather than its short trigger text (the
   * line ends: it shows "→" and is named "Ends: End"); false if absent.
   */
  readonly isNamedByLabel?: boolean | undefined;
}

/**
 * The trigger's size: a fixed width, or as wide as its value between a least and a most width.
 *
 * @param width - Its width, or its least width with a most one, px.
 * @param maxWidth - Its most width, px.
 * @returns Its style, or none to be as wide as its value.
 */
function triggerSize(
  width: number | undefined,
  maxWidth: number | undefined,
): CSSProperties | undefined {
  if (width === undefined) return maxWidth === undefined ? undefined : { maxWidth };
  return maxWidth === undefined ? { width } : { minWidth: width, maxWidth };
}

/**
 * A dropdown's menu rows: each shown choice a radio (a rule before one that starts a group), the
 * current one checked, then the extra rows after a rule.
 *
 * @param options - The choices.
 * @param chosen - The current choice, if any.
 * @param onChange - Receives a choice other than the current one.
 * @param extra - The rows after the choices.
 * @returns The rows.
 */
function menuEntriesOf<T extends string>(
  options: readonly CompactDropdownOption<T>[],
  chosen: CompactDropdownOption<T> | undefined,
  onChange: (value: T) => void,
  extra: readonly MenuEntry[] | undefined,
): MenuEntry[] {
  const entries = options
    .filter((option) => option.isHidden !== true)
    .flatMap((option): MenuEntry[] => {
      const item: MenuItemEntry = {
        kind: 'radio',
        id: option.value,
        label: option.label,
        meta: option.meta,
        labelStyle: option.labelStyle,
        onVisible: option.onVisible,
        isDisabled: option.isDisabled,
        isChecked: option === chosen,
        onSelect: () => {
          if (option !== chosen) onChange(option.value);
        },
      };
      return option.isGroupStart === true
        ? [{ kind: 'separator', id: `before ${option.value}` }, item]
        : [item];
    });
  if (extra !== undefined && extra.length > 0) {
    entries.push({ kind: 'separator', id: 'before extra rows' }, ...extra);
  }
  return entries;
}

/**
 * A compact dropdown (the properties popover's font and size, the Library's Select):
 * a 28 px trigger showing the value and a chevron, which opens a compact {@link Menu} under it
 * with a check by the current choice and each choice's value at its end. Click, Enter, Space or
 * Arrow Down open it on the current choice, Arrow Up on the last; inside, the menu's keys apply,
 * and choosing, Escape or Tab put focus back on the trigger. On a touch screen it is 48 px.
 *
 * @param props - Its name, value, choices and handler.
 * @returns The trigger and, while open, its menu.
 */
export function CompactDropdown<T extends string>(props: CompactDropdownProps<T>): ReactElement {
  const { label, value, options, variant = 'quiet' } = props;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setOpen] = useState(false);
  const [focusOnOpen, setFocusOnOpen] = useState<'checked' | 'last'>('checked');
  const isMixed = props.isMixed === true;
  const chosen = isMixed ? undefined : options.find((option) => option.value === value);
  const shown = isMixed ? 'Mixed' : (chosen?.triggerLabel ?? chosen?.label ?? '');
  const name = props.isNamedByLabel === true && chosen !== undefined ? chosen.label : shown;
  const entries = menuEntriesOf(options, chosen, props.onChange, props.extraEntries);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    setFocusOnOpen(event.key === 'ArrowDown' ? 'checked' : 'last');
    setOpen(true);
  };
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        data-variant={variant}
        style={triggerSize(props.width, props.maxWidth)}
        aria-label={`${label}: ${name}`}
        // With a footer (the font size's Custom field) it opens a dialog round the menu.
        aria-haspopup={props.footer === undefined ? 'menu' : 'dialog'}
        aria-expanded={isOpen}
        {...props.dataAttributes}
        disabled={props.isDisabled === true}
        onClick={() => {
          setFocusOnOpen('checked');
          setOpen((wasOpen) => !wasOpen);
        }}
        onKeyDown={onKeyDown}
      >
        <span className={styles.value}>{shown}</span>
        <Icon name="chevron-down" />
      </button>
      <Menu
        label={label}
        entries={entries}
        anchor={triggerRef}
        isOpen={isOpen}
        variant="compact"
        // The design's frame A: 12 px below the trigger, clear of the popover the trigger sits in.
        gap={12}
        initialFocus={focusOnOpen}
        maxListHeight={props.maxListHeight}
        footer={props.footer?.(() => {
          setOpen(false);
          triggerRef.current?.focus();
        })}
        onClose={(reason) => {
          setOpen(false);
          // Tab moves on from the menu; every other way out lands back on the trigger.
          if (reason !== 'tab' && reason !== 'outside') triggerRef.current?.focus();
        }}
      />
    </>
  );
}
