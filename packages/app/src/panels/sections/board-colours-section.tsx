import type { ReactElement } from 'react';

import { BUILTIN_TOKEN_DEFAULTS, isBuiltinToken, type ColorMode, type Rgba } from '@canvas/schema';

import type { ColorTokenAction } from '../../state/color-token-action.js';
import { ColourControl } from '../controls/colour-control.js';
import { useColourTokens } from '../controls/colour-tokens-context.js';
import controls from '../controls/controls.module.css';
import { TextFieldControl } from '../controls/text-field-control.js';
import { nextTokenName, tokenOptionsOf, type TokenOption } from '../controls/token-options.js';
import type { StylePanelSection, StylePanelSectionProps } from '../panel-sections.js';

import styles from './board-colours-section.module.css';

/** The longest token name (`MAX_TOKEN_NAME_LENGTH` of the schema). */
const MAX_NAME_LENGTH = 40;

/** Props of {@link TokenRow}. */
interface TokenRowProps {
  /** The token. */
  readonly option: TokenOption;
  /** Dispatches its commands. */
  readonly dispatch: (action: ColorTokenAction) => void;
}

/**
 * One colour token of the board: its name (a field for a custom token, renamed on commit; a
 * built-in's fixed), its light and dark values (colours only), and Reset (an edited built-in) or
 * Delete (a custom token). Each change is one canvas action, one command and one undo step.
 *
 * @param props - The token and the dispatch.
 * @returns The row.
 */
function TokenRow(props: TokenRowProps): ReactElement {
  const { option, dispatch } = props;
  const { id, name, values } = option;
  // Only the edited mode travels: the name and the other value are read when the command runs,
  // so a collaborator's change made while this picker was open is kept.
  const setValue = (mode: ColorMode) => (colour: Rgba | null) => {
    if (colour === null) return;
    dispatch({ type: 'colorToken', command: 'setValue', id, mode, value: colour });
  };
  const action =
    option.isBuiltin && option.isEdited
      ? { label: 'Reset', command: 'reset' as const }
      : option.isBuiltin
        ? undefined
        : { label: 'Delete', command: 'delete' as const };
  return (
    <div className={styles.token} role="group" aria-label={name} data-token={id}>
      <div className={styles.heading}>
        {option.isBuiltin ? (
          <span className={styles.name}>{name}</span>
        ) : (
          <div className={styles.nameField}>
            <TextFieldControl
              label="Name"
              value={name}
              maxLength={MAX_NAME_LENGTH}
              onCommit={(next) => {
                if (next.trim() !== '')
                  dispatch({ type: 'colorToken', command: 'rename', id, name: next });
              }}
            />
          </div>
        )}
        {action !== undefined && (
          <button
            type="button"
            className={controls.toggle}
            aria-label={`${action.label} ${name}`}
            onClick={() => {
              if (action.command === 'delete')
                dispatch({ type: 'colorToken', command: 'delete', id });
              else if (isBuiltinToken(id)) dispatch({ type: 'colorToken', command: 'reset', id });
            }}
          >
            {action.label}
          </button>
        )}
      </div>
      <ColourControl label="Light" value={values.light} onChange={setValue('light')} />
      <ColourControl label="Dark" value={values.dark} onChange={setValue('dark')} />
    </div>
  );
}

/**
 * The inspector's Board colours section, shown with nothing selected: the board's colour
 * tokens (`useColourTokens`: the six built-ins, then the custom tokens by name), each with its
 * light and dark values; custom tokens are renamed and deleted here, an edited built-in reset to
 * its defaults, and Add colour makes a custom token ("Colour n", the accent's default values).
 * Every change is a document command applied at once, one undo step each (a `colorToken` canvas
 * action), never a form to save. A viewer has no inspector.
 *
 * @param props - The panel's props.
 * @returns The rows.
 */
function BoardColoursSection(props: StylePanelSectionProps): ReactElement {
  const { dispatch } = props;
  const { table } = useColourTokens();
  return (
    <div className={styles.body}>
      {tokenOptionsOf(table).map((option) => (
        <TokenRow key={option.id} option={option} dispatch={dispatch} />
      ))}
      <button
        type="button"
        className={controls.button}
        onClick={() => {
          const { light, dark } = BUILTIN_TOKEN_DEFAULTS.accent;
          const name = nextTokenName(table);
          dispatch({
            type: 'colorToken',
            command: 'set',
            name,
            light: [...light],
            dark: [...dark],
          });
        }}
      >
        Add colour
      </button>
    </div>
  );
}

/**
 * The inspector's Board colours section: with nothing selected and no creation tool's
 * style shown (the `none` context), last, collapsed until opened.
 */
export const stylePanelSection: StylePanelSection = {
  id: 'board-colours',
  title: 'Board colours',
  context: 'none',
  order: 90,
  isCollapsedByDefault: () => true,
  render: BoardColoursSection,
};
