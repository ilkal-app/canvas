import { useRef, useState, type ReactElement } from 'react';

import { Menu, type MenuEntry } from '../controls/menu.js';
import type { IconName } from '../icons/icon-paths.js';
import { Icon } from '../icons/icon.js';
import { MIXED, type Mixable } from '../panels/controls/mixed-value.js';

import { POPUP_GAP_PX } from './popover-shared.js';
import styles from './selection-popover.module.css';
import { POPOVER_SHAPE_KINDS, type PopoverShapeKind } from './shape-connector-values.js';

/** Each kind's name and icon. */
const KINDS: Readonly<Record<PopoverShapeKind, readonly [string, IconName]>> = {
  rectangle: ['Rectangle', 'rectangle'],
  ellipse: ['Ellipse', 'ellipse'],
  triangle: ['Triangle', 'triangle'],
  diamond: ['Diamond', 'diamond'],
  polygon: ['Polygon', 'polygon'],
  star: ['Star', 'star'],
};

/** Props of {@link ShapeKindDropdown}. */
export interface ShapeKindDropdownProps {
  /** The kind the shapes share, or mixed. */
  readonly kind: Mixable<PopoverShapeKind>;
  /** Receives a kind chosen, only when it differs. */
  readonly onChange: (kind: PopoverShapeKind) => void;
}

/**
 * The shape row's swap (the SHAPE card): a 28 px icon button showing the shapes' kind,
 * named "Shape: <Kind>" (or "Shape: Mixed"), whose compact menu offers every kind with a check by
 * the current one. Swapping changes the kind alone: the shape keeps its size, label and
 * connections.
 *
 * @param props - The kind and the handler.
 * @returns The button and, while open, its menu.
 */
export function ShapeKindDropdown(props: ShapeKindDropdownProps): ReactElement {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setOpen] = useState(false);
  const { kind } = props;
  const [name, icon] = kind === MIXED ? ['Mixed', 'shapes' as const] : KINDS[kind];
  const entries: MenuEntry[] = POPOVER_SHAPE_KINDS.map((value) => ({
    kind: 'radio',
    id: value,
    label: KINDS[value][0],
    isChecked: kind === value,
    onSelect: () => {
      if (kind !== value) props.onChange(value);
    },
  }));
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styles.iconButton}
        aria-label={`Shape: ${name}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => {
          setOpen((wasOpen) => !wasOpen);
        }}
      >
        <Icon name={icon} />
      </button>
      <Menu
        label="Shape"
        entries={entries}
        anchor={buttonRef}
        isOpen={isOpen}
        variant="compact"
        gap={POPUP_GAP_PX}
        initialFocus="checked"
        onClose={(reason) => {
          setOpen(false);
          if (reason !== 'tab' && reason !== 'outside') buttonRef.current?.focus();
        }}
      />
    </>
  );
}
