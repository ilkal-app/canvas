import { useRef, useState, type ReactElement } from 'react';

import { Menu } from '../controls/menu.js';
import { Icon } from '../icons/icon.js';
import { FLOATING_DOCK_TOOLS, type FloatingDockToolId } from '../state/floating-dock.js';

import dockStyles from './dock.module.css';

/** Props of {@link FloatingMoreTools}. */
export interface FloatingMoreToolsProps {
  /** The tools behind it, in the menu's order. */
  readonly tools: readonly FloatingDockToolId[];
  /** The tool shown pressed in the bar, if any: one of these makes More pressed. */
  readonly pressed: FloatingDockToolId | undefined;
  /** Whether a tool can be chosen now. */
  readonly isAvailable: (tool: FloatingDockToolId) => boolean;
  /** Chooses a tool, as its dock button would. */
  readonly onChoose: (tool: FloatingDockToolId) => void;
}

/**
 * The compact floating bar's "More tools": a 48 px button that opens a menu of the
 * editor's less-used tools (Section, Image, Connector, Reactions), each a radio checked while it
 * is the chosen tool, the button pressed then. Choosing one does what its dock button does;
 * choosing or Escape closes the menu and gives focus back to the button.
 *
 * @param props - The tools, the pressed one and how to choose.
 * @returns The button and its menu.
 */
export function FloatingMoreTools(props: FloatingMoreToolsProps): ReactElement {
  const { tools, pressed } = props;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const isMorePressed = pressed !== undefined && tools.includes(pressed);
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={dockStyles.compactButton}
        data-dock-item=""
        aria-label="More tools"
        title="More tools"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-pressed={isMorePressed}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          setIsOpen(!isOpen);
        }}
      >
        <Icon name="more" />
      </button>
      <Menu
        label="More tools"
        isOpen={isOpen}
        anchor={buttonRef}
        side="top"
        align="end"
        gap={8}
        initialFocus="checked"
        entries={tools.map((tool) => ({
          kind: 'radio',
          id: tool,
          label: FLOATING_DOCK_TOOLS[tool].label,
          isChecked: pressed === tool,
          isDisabled: !props.isAvailable(tool),
          onSelect: () => {
            props.onChoose(tool);
          },
        }))}
        onClose={() => {
          setIsOpen(false);
          buttonRef.current?.focus();
        }}
      />
    </>
  );
}
