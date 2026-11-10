import { useRef, useState, type ReactElement } from 'react';

import { Menu, type MenuEntry } from '../controls/menu.js';
import type { IconName } from '../icons/icon-paths.js';
import { Icon } from '../icons/icon.js';
import { MIXED, type Mixable } from '../panels/controls/mixed-value.js';

import type { PopoverAlign, VerticalAlign } from './popover-values.js';
import styles from './selection-popover.module.css';

/** The horizontal alignments: each one's value, name and icon. */
const ALIGNS: readonly (readonly [PopoverAlign, string, IconName])[] = [
  ['left', 'Left', 'text-left'],
  ['center', 'Centre', 'text-centre'],
  ['right', 'Right', 'text-right'],
];

/** The vertical alignments: each one's value and name. */
const VERTICAL_ALIGNS: readonly (readonly [VerticalAlign, string])[] = [
  ['top', 'Top'],
  ['middle', 'Middle'],
  ['bottom', 'Bottom'],
];

/** Props of {@link AlignDropdown}. */
export interface AlignDropdownProps {
  /** The horizontal alignment the selection shares, or mixed. */
  readonly align: Mixable<PopoverAlign>;
  /** The vertical alignment the selection shares, or mixed; its rows show only with a handler. */
  readonly verticalAlign?: Mixable<VerticalAlign> | undefined;
  /** Receives a horizontal alignment chosen, only when it differs. */
  readonly onAlign: (align: PopoverAlign) => void;
  /** Receives a vertical alignment chosen, only when it differs; stickies only. */
  readonly onVerticalAlign?: ((align: VerticalAlign) => void) | undefined;
}

/**
 * The menu's lines: the horizontal alignments, then for stickies a rule and the vertical ones.
 *
 * @param props - The dropdown's props.
 * @returns The lines.
 */
function entriesOf(props: AlignDropdownProps): readonly MenuEntry[] {
  const { onVerticalAlign } = props;
  const horizontal: MenuEntry[] = ALIGNS.map(([value, label]) => ({
    kind: 'radio',
    id: value,
    label,
    isChecked: props.align === value,
    onSelect: () => {
      if (props.align !== value) props.onAlign(value);
    },
  }));
  if (onVerticalAlign === undefined) return horizontal;
  return [
    ...horizontal,
    { kind: 'separator', id: 'vertical' },
    ...VERTICAL_ALIGNS.map(([value, label]): MenuEntry => ({
      kind: 'radio',
      id: value,
      label,
      isChecked: props.verticalAlign === value,
      onSelect: () => {
        if (props.verticalAlign !== value) onVerticalAlign(value);
      },
    })),
  ];
}

/**
 * The alignment dropdown (frame A): a 28 px icon button showing the current horizontal
 * alignment (left when mixed), whose compact menu offers left, centre and right, and for a
 * sticky top, middle and bottom after a rule, a check by each current one.
 *
 * @param props - The alignments and their handlers.
 * @returns The button and, while open, its menu.
 */
export function AlignDropdown(props: AlignDropdownProps): ReactElement {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setOpen] = useState(false);
  const icon = ALIGNS.find(([value]) => value === props.align)?.[2] ?? 'text-left';
  const shown = props.align === MIXED ? 'Mixed' : undefined;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styles.iconButton}
        aria-label="Alignment"
        aria-description={shown}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => {
          setOpen((wasOpen) => !wasOpen);
        }}
      >
        <Icon name={icon} />
      </button>
      <Menu
        label="Alignment"
        entries={entriesOf(props)}
        anchor={buttonRef}
        isOpen={isOpen}
        variant="compact"
        gap={12}
        initialFocus="checked"
        onClose={(reason) => {
          setOpen(false);
          if (reason !== 'tab' && reason !== 'outside') buttonRef.current?.focus();
        }}
      />
    </>
  );
}
