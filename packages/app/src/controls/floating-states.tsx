import { useRef, useState, type ReactElement } from 'react';

import type { IconName } from '../icons/icon-paths.js';
import { Icon } from '../icons/icon.js';
import { whiteboardChromeContext } from '../shell/whiteboard-chrome.js';

import { AnchoredPopover } from './anchored-popover.js';
import { Button } from './button.js';
import { Chip } from './chip.js';
import { ColourButton, type ColourGroup } from './colour-button.js';
import { CompactDropdown, type CompactDropdownOption } from './compact-dropdown.js';
import styles from './control-states-sheet.module.css';
import { FloatingSheet } from './floating-sheet.js';
import { Menu, type MenuEntry, type MenuItemEntry } from './menu.js';
import { StatesRow } from './states-row.js';

/** The sticky's font sizes, as the design's size menu lists them. */
const SIZES: readonly CompactDropdownOption<'s' | 'm' | 'l' | 'xl'>[] = [
  { value: 's', label: 'Small', meta: '12', triggerLabel: '12' },
  { value: 'm', label: 'Medium', meta: '16', triggerLabel: '16' },
  { value: 'l', label: 'Large', meta: '24', triggerLabel: '24' },
  { value: 'xl', label: 'Extra large', meta: '32', triggerLabel: '32' },
];

/** The Library's Select. */
const KINDS: readonly CompactDropdownOption<'primary' | 'secondary'>[] = [
  { value: 'primary', label: 'Primary' },
  { value: 'secondary', label: 'Secondary' },
];

/**
 * The design's board menu, each item reporting what was chosen.
 *
 * @param onChoose - Receives the chosen item's name.
 * @returns The menu's lines.
 */
function boardMenu(onChoose: (label: string) => void): readonly MenuEntry[] {
  const item = (label: string, meta?: string): MenuItemEntry => ({
    kind: 'item',
    id: label,
    label,
    meta,
    onSelect: () => {
      onChoose(label);
    },
  });
  return [
    item('All boards', '⌘⇧H'),
    { kind: 'separator', id: 'rule-1' },
    item('Rename'),
    item('Duplicate board'),
    { ...item('Export', 'PNG, PDF'), submenu: [item('PNG'), item('PDF')] },
    item('Version history', '⌥⌘H'),
    { kind: 'separator', id: 'rule-2' },
    item('Share and permissions'),
    {
      ...item('Theme', 'System'),
      submenu: [item('Graphite'), item('Vellum'), item('System')],
    },
    item('Keyboard shortcuts', '?'),
    { kind: 'separator', id: 'rule-3' },
    { ...item('Delete board'), isDanger: true },
  ];
}

/**
 * The compact dropdown's row: the popover's size dropdown, the Library's Select and a disabled
 * one.
 *
 * @returns The row.
 */
function DropdownStates(): ReactElement {
  const [size, setSize] = useState<'s' | 'm' | 'l' | 'xl'>('m');
  const [kind, setKind] = useState<'primary' | 'secondary'>('primary');
  return (
    <StatesRow name="Compact dropdown">
      <CompactDropdown label="Font size" value={size} options={SIZES} onChange={setSize} />
      <CompactDropdown
        label="Kind"
        value={kind}
        options={KINDS}
        variant="field"
        width={168}
        onChange={setKind}
      />
      <CompactDropdown
        label="Font size, disabled"
        value="m"
        options={SIZES}
        isDisabled
        onChange={() => undefined}
      />
    </StatesRow>
  );
}

/**
 * The menu's row: a button that opens the design's board menu, and what was last chosen.
 *
 * @returns The row.
 */
function MenuStates(): ReactElement {
  const [isOpen, setOpen] = useState(false);
  const [chosen, setChosen] = useState('Nothing yet');
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <StatesRow name="Menu">
      <Button
        kind="secondary"
        buttonRef={anchorRef}
        onClick={() => {
          setOpen((wasOpen) => !wasOpen);
        }}
      >
        Board menu
      </Button>
      <output className={styles.sample} aria-label="Chosen">
        {chosen}
      </output>
      <Menu
        label="Board menu"
        entries={boardMenu(setChosen)}
        anchor={anchorRef}
        isOpen={isOpen}
        onClose={() => {
          setOpen(false);
        }}
      />
    </StatesRow>
  );
}

/** The whiteboard chrome's icons and the draw tools', each with its name. */
const WHITEBOARD_ICONS: readonly (readonly [IconName, string])[] = [
  ['home', 'Home'],
  ['minimap', 'Minimap'],
  ['lasso', 'Lasso'],
  ['highlighter', 'Highlighter'],
  ['reactions', 'Reactions'],
  ['section', 'Section'],
  ['timer', 'Timer'],
  ['vote', 'Vote'],
  ['pencil', 'Pencil'],
  ['brush', 'Marker'],
  ['eraser', 'Eraser'],
];

/**
 * The whiteboard icons' row: each icon at the app's 20 px, named.
 *
 * @returns The row.
 */
function IconStates(): ReactElement {
  return (
    <StatesRow name="Whiteboard icons">
      {WHITEBOARD_ICONS.map(([name, label]) => (
        <span key={name} role="img" aria-label={label} className={styles.icon}>
          <Icon name={name} />
        </span>
      ))}
    </StatesRow>
  );
}

/** The sticky colours and a board token, as the properties popover's palette offers them. */
const PALETTE: readonly ColourGroup[] = [
  {
    label: 'Sticky',
    choices: [
      { value: 'yellow', label: 'Yellow', swatch: '#f6e39a' },
      { value: 'orange', label: 'Orange', swatch: '#f4cfa6' },
      { value: 'pink', label: 'Pink', swatch: '#f3c3cf' },
      { value: 'purple', label: 'Purple', swatch: '#dacdef' },
      { value: 'blue', label: 'Blue', swatch: '#bcd6ee' },
      { value: 'green', label: 'Green', swatch: '#c8e4b6' },
    ],
  },
  { label: 'Board colours', choices: [{ value: 'brand', label: 'Brand', swatch: '#3c6fb0' }] },
];

/**
 * The colour button's and the chip's row: a colour button holding its colour, chips default,
 * active and disabled.
 *
 * @returns The row.
 */
function ColourChipStates(): ReactElement {
  const [colour, setColour] = useState('pink');
  const [isSquare, setSquare] = useState(true);
  const choice = PALETTE.flatMap((group) => group.choices).find((c) => c.value === colour);
  return (
    <StatesRow name="Colour button and chip">
      <ColourButton
        label="Fill"
        value={colour}
        valueLabel={choice?.label ?? colour}
        swatch={choice?.swatch ?? colour}
        groups={PALETTE}
        onChange={setColour}
      />
      <Chip label="Square" isActive={isSquare} onToggle={setSquare} />
      <Chip
        label="Wide"
        isActive={!isSquare}
        onToggle={(isWide) => {
          setSquare(!isWide);
        }}
      />
      <Chip label="Disabled" isActive={false} isDisabled onToggle={() => undefined} />
    </StatesRow>
  );
}

/**
 * The anchored popover's row: a button that opens a toolbar popover under it, as the
 * properties popover opens beside a selection.
 *
 * @returns The row.
 */
function PopoverStates(): ReactElement {
  const [isOpen, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <StatesRow name="Anchored popover">
      <Button
        kind="secondary"
        buttonRef={anchorRef}
        onClick={() => {
          setOpen((wasOpen) => !wasOpen);
        }}
      >
        Show popover
      </Button>
      <AnchoredPopover
        anchor={anchorRef}
        isOpen={isOpen}
        label="Sample properties"
        role="toolbar"
        side="bottom"
        onClose={() => {
          setOpen(false);
        }}
      >
        <Button kind="ghost">Colour</Button>
        <Button kind="ghost">Size</Button>
        <Button kind="ghost">More</Button>
      </AnchoredPopover>
    </StatesRow>
  );
}

/**
 * The whiteboard's floating primitives in the control states sheet, shown only with
 * the floating chrome (`?view=tokens&chrome=floating`): the floating sheet in each shape, an
 * anchored popover opened from a button, the compact dropdown, the board menu, the colour
 * button, the chip and the whiteboard's icons, under the floating chrome's context so their icons
 * are the design Library's.
 *
 * @returns The rows.
 */
export function FloatingStates(): ReactElement {
  return (
    <whiteboardChromeContext.Provider value="floating">
      <StatesRow name="Floating sheet">
        <FloatingSheet shape="toolbar" role="group" label="Toolbar sheet">
          <span className={styles.sample}>Toolbar · 40 px</span>
        </FloatingSheet>
        <FloatingSheet shape="bar" role="group" label="Bar sheet">
          <span className={styles.sample}>Bar · 44 px</span>
        </FloatingSheet>
        <FloatingSheet shape="stack" role="group" label="Stack sheet">
          <span className={styles.sample}>Stack</span>
          <span className={styles.sample}>of rows</span>
        </FloatingSheet>
      </StatesRow>
      <PopoverStates />
      <DropdownStates />
      <MenuStates />
      <ColourChipStates />
      <IconStates />
    </whiteboardChromeContext.Provider>
  );
}
