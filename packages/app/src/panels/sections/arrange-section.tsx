import { useRef, type ReactElement } from 'react';

import type { BoardObject } from '@canvas/schema';

import { Tooltip, type TooltipPlacement } from '../../feedback/tooltip.js';
import type { InspectorIconName } from '../../icons/icon-paths.js';
import { Icon } from '../../icons/icon.js';
import type { ShortcutRegistry } from '../../shortcuts/shortcut-registry.js';
import type { ArrangeCommand, ShellAction } from '../../state/shell-action.js';
import { actionHint } from '../../toolbar/action-hints.js';
import { useRovingFocus } from '../../toolbar/use-roving-focus.js';
import type { StylePanelSection, StylePanelSectionProps } from '../panel-sections.js';

import styles from './arrange-section.module.css';

/** One icon button of the arrange rows. */
export interface ArrangeButton {
  /** What it dispatches: the same `ArrangeCommand` as its shortcut. */
  readonly command: ArrangeCommand;
  /** Its icon. */
  readonly icon: InspectorIconName;
  /**
   * Why it cannot apply to a selection, which its tooltip says while it is disabled; undefined
   * when it applies. It always applies if absent.
   */
  readonly whyUnavailable?: (selection: readonly BoardObject[]) => string | undefined;
}

/** A row of the arrange section: its name and its groups of buttons, a rule between them. */
export interface ArrangeRow {
  /** The row's accessible name. */
  readonly label: string;
  /** Its groups, in order. */
  readonly groups: readonly (readonly ArrangeButton[])[];
}

/**
 * The reason a button needs at least some objects selected, or undefined when there are.
 *
 * @param action - The action's name, as the reason starts.
 * @param count - How many it needs.
 * @returns The check.
 */
function needs(
  action: string,
  count: number,
): (selection: readonly BoardObject[]) => string | undefined {
  return (selection) =>
    selection.length >= count ? undefined : `${action} needs ${String(count)} or more objects`;
}

/**
 * The arrange section's three rows (Figma "Inspector by selection"): align, left,
 * horizontal centres and right, then top, vertical centres and bottom; distribute horizontally
 * and vertically and tidy up, then group and ungroup; and the four order commands. Every
 * `ArrangeCommand` of the default keymap but create component (ruling 2: its shortcut,
 * the context menu and the dock) has exactly one button (`arrange-section.test.tsx`).
 * The disabled rules are today's: distribute needs three objects, tidy and group two, ungroup a
 * group in the selection.
 */
export const ARRANGE_ROWS: readonly ArrangeRow[] = [
  {
    label: 'Align',
    groups: [
      [
        { command: 'alignLeft', icon: 'align-left' },
        { command: 'alignCentre', icon: 'align-centre' },
        { command: 'alignRight', icon: 'align-right' },
      ],
      [
        { command: 'alignTop', icon: 'align-top' },
        { command: 'alignMiddle', icon: 'align-middle' },
        { command: 'alignBottom', icon: 'align-bottom' },
      ],
    ],
  },
  {
    label: 'Distribute and group',
    groups: [
      [
        {
          command: 'distributeHorizontally',
          icon: 'distribute-horizontally',
          whyUnavailable: needs('Distribute', 3),
        },
        {
          command: 'distributeVertically',
          icon: 'distribute-vertically',
          whyUnavailable: needs('Distribute', 3),
        },
        { command: 'tidyUp', icon: 'tidy-up', whyUnavailable: needs('Tidy up', 2) },
      ],
      [
        { command: 'group', icon: 'arrange-group', whyUnavailable: needs('Group', 2) },
        {
          command: 'ungroup',
          icon: 'ungroup',
          whyUnavailable: (selection) =>
            selection.some((object) => object.type === 'group')
              ? undefined
              : 'Ungroup needs a group in the selection',
        },
      ],
    ],
  },
  {
    label: 'Order',
    groups: [
      [
        { command: 'bringToFront', icon: 'bring-to-front' },
        { command: 'bringForward', icon: 'bring-forward' },
        { command: 'sendBackward', icon: 'send-backward' },
        { command: 'sendToBack', icon: 'send-to-back' },
      ],
    ],
  },
];

/** What a locked selection's buttons say (the header's lock undoes it). */
export const LOCKED_ARRANGE_REASON = 'Locked — unlock to arrange';

/** How an arrange button is named and described. */
export interface ArrangeButtonText {
  /** The action's name, the keymap's description of its shortcut (`Align left`). */
  readonly name: string;
  /** Its shortcut as the platform writes it (`⌥A`, `Alt+A`); none without one. */
  readonly shortcut: string | undefined;
  /** Its shortcut for `aria-keyshortcuts`; none without one. */
  readonly ariaKeyShortcuts: string | undefined;
  /** Its accessible name: the name and, in brackets, the shortcut (`Align left (⌥A)`). */
  readonly label: string;
}

/**
 * An arrange button's name and shortcut, from the keymap, so the button says what its shortcut
 * does and which keys do it (the reference card: "Align left ⌥A").
 *
 * @param registry - The shell's shortcuts.
 * @param command - The button's command.
 * @returns Its name, shortcut and accessible name.
 */
export function arrangeButtonText(
  registry: ShortcutRegistry<ShellAction>,
  command: ArrangeCommand,
): ArrangeButtonText {
  const action: ShellAction = { type: 'arrange', command };
  const entry = registry.entries.find(
    (candidate) =>
      candidate.action.type === 'arrange' && candidate.action.command === action.command,
  );
  const name = entry?.description ?? command;
  const hint = actionHint(registry, action);
  return {
    name,
    shortcut: hint?.label,
    ariaKeyShortcuts: hint?.ariaKeyShortcuts,
    label: hint === undefined ? name : `${name} (${hint.label})`,
  };
}

/**
 * Where a button's tooltip opens: from the start for the first two of a row, to the end for the
 * last two, so a long tooltip stays inside the drawer; centred otherwise.
 *
 * @param index - The button's place in its row.
 * @param count - How many buttons the row has.
 * @returns The placement.
 */
function placementOf(index: number, count: number): TooltipPlacement {
  if (index < 2) return 'above-start';
  if (index >= count - 2) return 'above-end';
  return 'above';
}

/** Props of {@link ArrangeToolbar}. */
interface ArrangeToolbarProps {
  /** The row. */
  readonly row: ArrangeRow;
  /** The panel's props. */
  readonly section: StylePanelSectionProps;
}

/**
 * One row of the arrange section: a toolbar (one tab stop; the arrows, Home and End move along
 * it) of 40 px icon buttons, each with a tooltip of its name and shortcut. A button that cannot
 * apply shows at 38% opacity, stays focusable and is `aria-disabled`, its tooltip saying why. A
 * press keeps the focus where it was.
 *
 * @param props - The row and the panel's props.
 * @returns The toolbar.
 */
function ArrangeToolbar(props: ArrangeToolbarProps): ReactElement {
  const { row, section } = props;
  const { selection, dispatch, shortcuts, isLocked } = section;
  const ref = useRef<HTMLDivElement>(null);
  const roving = useRovingFocus(ref);
  const count = row.groups.reduce((total, group) => total + group.length, 0);
  let index = -1;
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={row.label}
      className={styles.row}
      onKeyDown={roving.onKeyDown}
      onFocus={roving.onFocus}
    >
      {row.groups.map((group, groupIndex) => (
        <div key={group[0]?.command} className={styles.group}>
          {groupIndex > 0 && <span className={styles.rule} aria-hidden="true" />}
          {group.map((button) => {
            index += 1;
            const text = arrangeButtonText(shortcuts, button.command);
            const reason = isLocked ? LOCKED_ARRANGE_REASON : button.whyUnavailable?.(selection);
            const isAvailable = reason === undefined;
            return (
              <Tooltip
                key={button.command}
                text={reason ?? text.name}
                shortcut={isAvailable ? text.shortcut : undefined}
                placement={placementOf(index, count)}
              >
                {(tooltipId) => (
                  <button
                    type="button"
                    className={styles.button}
                    data-dock-item=""
                    data-command={button.command}
                    aria-label={text.label}
                    aria-describedby={tooltipId}
                    aria-keyshortcuts={text.ariaKeyShortcuts}
                    aria-disabled={isAvailable ? undefined : true}
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={() => {
                      if (isAvailable) dispatch({ type: 'arrange', command: button.command });
                    }}
                  >
                    <Icon name={button.icon} />
                  </button>
                )}
              </Tooltip>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * The arrange section's rows.
 *
 * @param props - The panel's props.
 * @returns The rows.
 */
function ArrangeRows(props: StylePanelSectionProps): ReactElement {
  return (
    <div className={styles.rows}>
      {ARRANGE_ROWS.map((row) => (
        <ArrangeToolbar key={row.label} row={row} section={props} />
      ))}
    </div>
  );
}

/**
 * The inspector's arrange section: align, distribute, tidy, group and order as icon
 * buttons in three rows, for every selection. Each dispatches the same `ArrangeCommand` as its
 * shortcut and the context menu; the engine's document side runs the commands, so the section holds
 * no command code. Buttons that cannot apply, and every button of a locked selection, are disabled
 * and say why.
 */
export const stylePanelSection: StylePanelSection = {
  id: 'arrange',
  title: 'Arrange',
  context: [
    'text',
    'note',
    'vector',
    'shape',
    'line',
    'image',
    'frame',
    'group',
    'component',
    'instance',
    'mixed',
  ],
  order: 1000,
  isSelectionOnly: true,
  hasOwnLockState: true,
  render: ArrangeRows,
};
