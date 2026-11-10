import { useId, type ReactElement } from 'react';

import { Toggle } from '../controls/toggle.js';
import type { ShellAction } from '../state/shell-action.js';

import styles from './style-panel.module.css';

/** Props of {@link ConnectorPreference}. */
export interface ConnectorPreferenceProps {
  /** Whether deleting objects deletes the connectors attached to them. */
  readonly isOn: boolean;
  /** The shell's dispatch. */
  readonly dispatch: (action: ShellAction) => void;
}

/**
 * The person's "delete connectors with their objects" preference, a switch in the style
 * panel while nothing is selected (Figma "Nothing selected"), its label before it:
 * checked, deleting objects deletes the connectors attached to them; unchecked (the default), it
 * detaches them, their ends staying where they were. Kept with the view preferences in the browser,
 * never in the board. It sits in the panel, not the toolbar, whose one row has no room for another
 * control at desktop width (a wrapped toolbar moves the canvas).
 *
 * @param props - Whether it is on, and the dispatch.
 * @returns The section.
 */
export function ConnectorPreference(props: ConnectorPreferenceProps): ReactElement {
  const id = useId();
  return (
    <div className={styles.preference}>
      <label htmlFor={id}>Delete connectors with their objects</label>
      <Toggle
        id={id}
        isOn={props.isOn}
        onChange={() => {
          props.dispatch({ type: 'toggleDeleteConnectors' });
        }}
      />
    </div>
  );
}
