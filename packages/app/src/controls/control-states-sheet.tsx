import { useState, type ReactElement } from 'react';

import { Skeleton } from '../feedback/skeleton.js';
import { Spinner } from '../feedback/spinner.js';
import { Toast, type ToastContent } from '../feedback/toast.js';
import type { WhiteboardChrome } from '../shell/whiteboard-chrome.js';
import { DockButton } from '../toolbar/dock-button.js';

import { Button, type ButtonKind } from './button.js';
import styles from './control-states-sheet.module.css';
import { FloatingStates } from './floating-states.js';
import { SelectMenu, type SelectMenuOption } from './select-menu.js';
import { StatesRow as Row } from './states-row.js';
import { TextField } from './text-field.js';
import { Toggle } from './toggle.js';

/**
 * Takes a value and does nothing with it: the sheet's controls edit nothing.
 *
 * @returns Nothing.
 */
const IGNORE = (): void => undefined;

/** Each button kind's words, and what its busy state says (the sheet's rows). */
const BUTTON_ROWS: readonly (readonly [kind: ButtonKind, label: string, busy: string])[] = [
  ['primary', 'Save', 'Saving…'],
  ['secondary', 'Duplicate', 'Duplicating…'],
  ['ghost', 'Cancel', 'Cancelling…'],
  ['danger', 'Move to trash', 'Moving…'],
];

/** The select's choices (the sheet's role select). */
const ROLES: readonly SelectMenuOption<'editor' | 'commenter' | 'viewer'>[] = [
  { value: 'editor', label: 'Can edit' },
  { value: 'commenter', label: 'Can comment' },
  { value: 'viewer', label: 'Can view' },
];

/** The sheet's toasts: Info, Success, Error with Retry, and the protected undo (35:1786). */
const TOASTS: readonly (readonly [role: 'status' | 'alert', toast: ToastContent])[] = [
  ['status', { kind: 'info', message: 'Link copied' }],
  [
    'status',
    {
      kind: 'success',
      message: 'Invite sent to sam@example.com',
      action: { label: 'Undo', onAction: IGNORE },
    },
  ],
  [
    'alert',
    {
      kind: 'error',
      message: 'Couldn’t save the name',
      action: { label: 'Retry', onAction: IGNORE },
    },
  ],
  ['status', { kind: 'info', message: 'Can’t undo — Mira changed this since' }],
];

/**
 * The text fields in their states, each holding its own value.
 *
 * @returns The fields.
 */
function Fields(): ReactElement {
  const [filled, setFilled] = useState('Q4 launch plan');
  const [empty, setEmpty] = useState('');
  return (
    <>
      <TextField label="Empty" value={empty} placeholder="Add a description" onChange={setEmpty} />
      <TextField label="Filled" value={filled} onChange={setFilled} />
      <TextField
        label="Error"
        type="email"
        value="sam@exmple"
        error="Enter a full email address"
        onChange={IGNORE}
      />
      <TextField label="Disabled" value="Q4 launch plan" isDisabled onChange={IGNORE} />
    </>
  );
}

/**
 * The dock tool button default, active and not built yet, on the dock's sheet.
 *
 * @returns The row.
 */
function DockStates(): ReactElement {
  return (
    <Row name="Dock tool button">
      <div role="toolbar" aria-label="Tool states" className={styles.dock}>
        <DockButton
          label="Note"
          icon="note"
          hint={{ label: 'N', ariaKeyShortcuts: 'N' }}
          isPressed={false}
          isAvailable
          onSelect={IGNORE}
        />
        <DockButton
          label="Select"
          icon="select"
          hint={{ label: 'V', ariaKeyShortcuts: 'V' }}
          isPressed
          isAvailable
          onSelect={IGNORE}
        />
        <DockButton
          label="Pen"
          icon="pen"
          hint={undefined}
          isPressed={false}
          isAvailable={false}
          onSelect={IGNORE}
        />
      </div>
    </Row>
  );
}

/**
 * The spinner's three sizes and a skeleton.
 *
 * @returns The row.
 */
function LoadingStates(): ReactElement {
  return (
    <Row name="Progress and loading">
      <span className={styles.spinners}>
        <Spinner size={12} />
        <Spinner size={16} />
        <Spinner size={24} />
      </span>
      <span className={styles.skeletons}>
        <Skeleton shape="block" width={212} height={120} />
        <Skeleton width={180} height={12} />
        <Skeleton width={120} height={10} />
      </span>
    </Row>
  );
}

/** Props of {@link ControlStatesSheet}. */
export interface ControlStatesSheetProps {
  /**
   * The whiteboard chrome the sheet shows controls for ('s flag): `floating` adds the
   * floating primitives after the classic rows; `classic`, the default, leaves the
   * sheet as its baselines hold it.
   */
  readonly chrome?: WhiteboardChrome | undefined;
}

/**
 * The control states sheet (Figma 35:1786; UI-18): every shared control and feedback component
 * in the states that hold still (default, disabled, busy, filled, error, on, off, active, not
 * built yet, each toast kind, the spinner's sizes, the skeleton). Hover, pressed, focus, the
 * open select and the tooltips are shown by pointing at and tabbing to them. The token sheet
 * (`?view=tokens`) shows it for the shell's screenshot baselines, axe and the keyboard checks;
 * with `?chrome=floating` it adds the whiteboard's floating primitives (`FloatingStates`).
 *
 * @param props - The chrome it shows controls for.
 * @returns The sheet's section.
 */
export function ControlStatesSheet(props: ControlStatesSheetProps): ReactElement {
  const [isOn, setOn] = useState(true);
  const [role, setRole] = useState<'editor' | 'commenter' | 'viewer'>('editor');
  return (
    <div className={styles.sheet} data-control-states="">
      {BUTTON_ROWS.map(([kind, label, busy]) => (
        <Row key={kind} name={`${kind[0]?.toUpperCase() ?? ''}${kind.slice(1)} button`}>
          <Button kind={kind} onClick={IGNORE}>
            {label}
          </Button>
          <Button kind={kind} isDisabled>
            {label}
          </Button>
          <Button kind={kind} busyLabel={busy}>
            {label}
          </Button>
        </Row>
      ))}
      <Row name="Not built yet">
        <Button isAvailable={false}>Export</Button>
      </Row>
      <Row name="Text field">
        <Fields />
      </Row>
      <Row name="Select and toggle">
        <SelectMenu
          label="Role"
          value={role}
          options={ROLES}
          isDisabled={false}
          variant="field"
          onChange={setRole}
        />
        <SelectMenu
          label="Role, disabled"
          value="viewer"
          options={ROLES}
          isDisabled
          onChange={IGNORE}
        />
        <Toggle label="Toggle on" isOn={isOn} onChange={setOn} />
        <Toggle label="Toggle off" isOn={false} onChange={IGNORE} />
        <Toggle label="Toggle disabled" isOn isDisabled onChange={IGNORE} />
      </Row>
      <DockStates />
      <Row name="Toasts">
        {TOASTS.map(([role, toast]) => (
          <Toast key={toast.message} role={role} toast={toast} />
        ))}
      </Row>
      <LoadingStates />
      {props.chrome === 'floating' ? <FloatingStates /> : null}
    </div>
  );
}
