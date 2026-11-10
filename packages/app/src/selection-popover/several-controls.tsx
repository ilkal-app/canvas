import { useRef, useState, type ReactElement } from 'react';

import { Menu, type MenuEntry } from '../controls/menu.js';
import type { ScreenRect } from '../controls/placement.js';
import type { IconName } from '../icons/icon-paths.js';
import { Icon } from '../icons/icon.js';
import { isSelectionLocked } from '../panels/inspector-header.js';
import type { ArrangeCommand } from '../state/shell-commands.js';

import { noteArrangeUsed, useArrangeLastUsed, type ArrangeMenuId } from './arrange-last-used.js';
import type { PopoverStyleControlsProps } from './popover-controls.js';
import { Divider, RowButton } from './popover-row-parts.js';
import { PopoverColourButton } from './popover-shared.js';
import { measureWindowReservedZones } from './reserved-zones.js';
import styles from './selection-popover.module.css';
import { colourChangesOf, sharedColourOf, takesColour } from './several-values.js';

/** One arrange menu's choice: its name, command and icon. */
interface ArrangeChoice {
  readonly label: string;
  readonly command: ArrangeCommand;
  readonly icon: IconName;
}

/** One of the popover's three arrange menus (round 2): its name, choices and floor. */
interface ArrangeMenuSpec {
  readonly id: ArrangeMenuId;
  readonly label: string;
  readonly choices: readonly ArrangeChoice[];
  /** The fewest objects it needs. */
  readonly least: number;
}

/** The three menus, in the row's order: align across, align down, distribute. */
const ARRANGE_MENUS: readonly ArrangeMenuSpec[] = [
  {
    id: 'alignHorizontal',
    label: 'Align horizontally',
    least: 2,
    choices: [
      { label: 'Align left', command: 'alignLeft', icon: 'align-left' },
      { label: 'Align centre', command: 'alignCentre', icon: 'align-centre' },
      { label: 'Align right', command: 'alignRight', icon: 'align-right' },
    ],
  },
  {
    id: 'alignVertical',
    label: 'Align vertically',
    least: 2,
    choices: [
      { label: 'Align top', command: 'alignTop', icon: 'align-top' },
      { label: 'Align middle', command: 'alignMiddle', icon: 'align-middle' },
      { label: 'Align bottom', command: 'alignBottom', icon: 'align-bottom' },
    ],
  },
  {
    id: 'distribute',
    label: 'Distribute',
    least: 3,
    choices: [
      {
        label: 'Distribute horizontally',
        command: 'distributeHorizontally',
        icon: 'distribute-horizontally',
      },
      {
        label: 'Distribute vertically',
        command: 'distributeVertically',
        icon: 'distribute-vertically',
      },
    ],
  },
];

/**
 * The several-objects row (the SEVERAL OBJECTS card): "N selected" | align
 * horizontally, align vertically and distribute (item 2), tidy up | one colour for every
 * object that takes one (texts keep theirs) and group. Each choice is one action, so one undo step; a locked
 * selection gets none of them.
 *
 * @param props - The controls' props.
 * @param props.controls - The popover's controls' props.
 * @returns The controls.
 */
export function SeveralControls(props: {
  readonly controls: PopoverStyleControlsProps;
}): ReactElement {
  const { controls } = props;
  const { selection, dispatch } = controls;
  const isLocked = isSelectionLocked(selection);
  return (
    <>
      <span className={styles.count}>{`${String(selection.length)} selected`}</span>
      <Divider />
      <ArrangeButtons controls={controls} />
      <Divider />
      {selection.some(takesColour) ? (
        <PopoverColourButton
          kind="colour"
          value={sharedColourOf(selection)}
          controls={controls}
          isDisabled={isLocked}
          onChange={(color) => {
            if (color === null || color === 'ink') return;
            dispatch({ type: 'style', changes: colourChangesOf(selection, color) });
          }}
        />
      ) : null}
      <GroupButton controls={controls} />
    </>
  );
}

/**
 * The arrange and Group end of a row for several objects of one type (item 13): their
 * own row (the note colours, the fill, the line) then, as the several-objects row has them,
 * the three arrange menus, tidy up and group. A locked
 * selection gets none of them.
 *
 * @param props - The controls' props and whether a rule leads them.
 * @param props.controls - The popover's controls' props.
 * @param props.hasLeadingRule - Whether to rule them off from the row before; false where that
 *   row already ends in a rule (unlabelled shapes).
 * @returns The controls.
 */
export function SameTypeArrangeControls(props: {
  readonly controls: PopoverStyleControlsProps;
  readonly hasLeadingRule: boolean;
}): ReactElement {
  return (
    <>
      {props.hasLeadingRule ? <Divider /> : null}
      <ArrangeButtons controls={props.controls} />
      <GroupButton controls={props.controls} />
    </>
  );
}

/**
 * One arrange menu (round 2): an icon button showing the command it last ran
 * (`useArrangeLastUsed`), whose menu offers its choices, each one action through the command
 * layer, so one undo step. Off for a locked selection or fewer objects than it needs.
 *
 * @param props - The menu, the selection, what it last ran and the dispatch.
 * @param props.spec - The menu.
 * @param props.controls - The popover's controls' props.
 * @param props.lastUsed - The command it last ran.
 * @returns The button and, while open, its menu.
 */
function ArrangeMenu(props: {
  readonly spec: ArrangeMenuSpec;
  readonly controls: PopoverStyleControlsProps;
  readonly lastUsed: ArrangeCommand;
}): ReactElement {
  const { spec, lastUsed } = props;
  const { selection, dispatch } = props.controls;
  const isDisabled = isSelectionLocked(selection) || selection.length < spec.least;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setOpen] = useState(false);
  const [reserved, setReserved] = useState<readonly ScreenRect[]>();
  const shown = spec.choices.find((choice) => choice.command === lastUsed) ?? spec.choices[0];
  const entries = spec.choices.map((choice): MenuEntry => ({
    kind: 'item',
    id: choice.command,
    label: choice.label,
    onSelect: () => {
      noteArrangeUsed(spec.id, choice.command);
      dispatch({ type: 'arrange', command: choice.command });
    },
  }));
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styles.iconButton}
        aria-label={spec.label}
        aria-description={shown?.label}
        title={spec.label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-disabled={isDisabled ? true : undefined}
        data-last-used={shown?.command}
        onClick={() => {
          if (isDisabled) return;
          setReserved(measureWindowReservedZones(buttonRef.current));
          setOpen((wasOpen) => !wasOpen);
        }}
      >
        <Icon name={shown?.icon ?? 'align-left'} />
      </button>
      <Menu
        label={spec.label}
        entries={entries}
        anchor={buttonRef}
        isOpen={isOpen && !isDisabled}
        side="bottom"
        align="start"
        // The popover's menus open 12 px from their button (the design's frame A).
        gap={12}
        reserved={reserved}
        onClose={(reason) => {
          setOpen(false);
          if (reason !== 'tab' && reason !== 'outside') buttonRef.current?.focus();
        }}
      />
    </>
  );
}

/**
 * The arrange controls (item 2, round 2): align horizontally (left, centre, right), align
 * vertically (top, middle, bottom) and distribute (horizontally, vertically; three or more), each
 * a menu whose button shows what it last ran, then Tidy up. A locked selection gets none of them.
 *
 * @param props - The controls' props.
 * @param props.controls - The popover's controls' props.
 * @returns The three menus and Tidy up.
 */
function ArrangeButtons(props: { readonly controls: PopoverStyleControlsProps }): ReactElement {
  const { selection, dispatch } = props.controls;
  const lastUsed = useArrangeLastUsed();
  return (
    <>
      {ARRANGE_MENUS.map((spec) => (
        <ArrangeMenu
          key={spec.id}
          spec={spec}
          controls={props.controls}
          lastUsed={lastUsed[spec.id]}
        />
      ))}
      <RowButton
        label="Tidy up"
        icon="tidy-up"
        isDisabled={isSelectionLocked(selection) || selection.length < 2}
        onPress={() => {
          dispatch({ type: 'arrange', command: 'tidyUp' });
        }}
      />
    </>
  );
}

/**
 * Group, one action: off for a locked selection.
 *
 * @param props - The controls' props.
 * @param props.controls - The popover's controls' props.
 * @returns The button.
 */
function GroupButton(props: { readonly controls: PopoverStyleControlsProps }): ReactElement {
  const { selection, dispatch } = props.controls;
  return (
    <RowButton
      label="Group"
      icon="arrange-group"
      isDisabled={isSelectionLocked(selection)}
      onPress={() => {
        dispatch({ type: 'arrange', command: 'group' });
      }}
    />
  );
}
