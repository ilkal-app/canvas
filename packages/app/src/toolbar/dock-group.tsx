import { useRef, useState, type ReactElement } from 'react';

import type { ShortcutRegistry } from '../shortcuts/shortcut-registry.js';
import { dockButtonAction, DOCK_BUTTONS, type DockButtonId } from '../state/dock-buttons.js';
import { dockGroupButtonOf, DOCK_GROUPS, type DockGroupId } from '../state/dock-groups.js';
import type { ShellAction } from '../state/shell-action.js';
import type { ShellState } from '../state/shell-reducer.js';
import { TOOL_AVAILABILITY } from '../state/tool-availability.js';

import { actionHint } from './action-hints.js';
import { DockButton } from './dock-button.js';
import { DockMenu, type DockMenuItem } from './dock-menu.js';

/** Props of {@link DockGroupButton}. */
export interface DockGroupButtonProps {
  /** The group. */
  readonly group: DockGroupId;
  /** The shell's shortcuts, for each item's hint. */
  readonly registry: ShortcutRegistry<ShellAction>;
  /** The shell state: the active tool, each group's tool, the tool styles. */
  readonly state: ShellState;
  /** Chooses a tool: the item's action. */
  readonly onChoose: (action: ShellAction) => void;
  /** Whether it is in the compact bottom bar: a 48 px target. False if absent. */
  readonly isCompact?: boolean | undefined;
}

/**
 * The menu's items: each of the group's buttons, the one the group shows checked.
 *
 * @param group - The group.
 * @param registry - The shortcuts, for hints.
 * @param shown - The item the group's button shows.
 * @returns The items.
 */
function itemsOf(
  group: DockGroupId,
  registry: ShortcutRegistry<ShellAction>,
  shown: DockButtonId | undefined,
): readonly DockMenuItem[] {
  return DOCK_GROUPS[group].items.map((id) => ({
    id,
    label: DOCK_BUTTONS[id].label,
    icon: id,
    hint: actionHint(registry, dockButtonAction(id)),
    isChecked: id === shown,
    isAvailable: TOOL_AVAILABILITY[id].isAvailable,
  }));
}

/**
 * A flyout group in the dock (shapes▾, lines▾): its button shows the item last chosen,
 * named as that tool's variant (`Shape: Ellipse (O)`), pressed while its tool is active, and
 * pressing it chooses that item again; Enter, ArrowUp, the corner caret or a held press open
 * the flyout, a menu of the group's items with their shortcuts. Choosing an item makes it the
 * group's and closes the flyout; Escape closes it with focus back on the button. Opened by the
 * pointer, focus goes back where it was when the flyout closes.
 *
 * @param props - The group, the shortcuts, the state and where a choice goes.
 * @returns The group's button and, when open, its flyout.
 */
export function DockGroupButton(props: DockGroupButtonProps): ReactElement {
  const { group, registry, state, onChoose } = props;
  const [isOpen, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<Element | null>(null);
  const model = dockGroupButtonOf(group, state.dockGroupTools, state.toolStyles);
  const isAvailable = state.availableTools.includes(model.tool);
  const open = (): void => {
    previousFocus.current = document.activeElement;
    setOpen(true);
  };
  const close = (isFocusReturned: boolean): void => {
    setOpen(false);
    const previous = previousFocus.current;
    if (isFocusReturned || previous === buttonRef.current) buttonRef.current?.focus();
    else if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
  };
  return (
    <DockButton
      buttonRef={buttonRef}
      label={model.label}
      name={model.name}
      icon={model.item ?? 'shapes'}
      hint={actionHint(registry, model.action)}
      isPressed={state.activeTool === model.tool}
      isAvailable={isAvailable}
      isCompact={props.isCompact}
      onSelect={() => {
        onChoose(model.action);
      }}
      menu={{
        isOpen,
        onOpen: () => {
          if (isOpen) close(false);
          else open();
        },
      }}
    >
      {isOpen && (
        <DockMenu
          label={DOCK_GROUPS[group].label}
          items={itemsOf(group, registry, model.item)}
          onChoose={(id) => {
            const item = DOCK_GROUPS[group].items.find((each) => each === id);
            close(previousFocus.current === buttonRef.current);
            const action = item === undefined ? undefined : dockButtonAction(item);
            if (action !== undefined) onChoose(action);
          }}
          onClose={close}
        />
      )}
    </DockButton>
  );
}
