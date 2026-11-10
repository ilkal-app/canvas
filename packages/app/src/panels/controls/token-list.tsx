import type { ReactElement } from 'react';

import type { TokenId, TokenRef } from '@canvas/schema';

import { swatchBackground } from './colour-hex.js';
import { useColourTokens } from './colour-tokens-context.js';
import { tokenOptionsOf } from './token-options.js';
import styles from './token-parts.module.css';

/** Props of {@link TokenList}. */
export interface TokenListProps {
  /** The list's id, which its opener's `aria-controls` names. */
  readonly id: string;
  /** The field's name: the list is "<label> tokens". */
  readonly label: string;
  /** The token the field names now, pressed in the list; none for a colour, none or mixed. */
  readonly current: TokenId | undefined;
  /** Receives the token chosen. */
  readonly onToken: (token: TokenRef) => void;
  /** Closes the list (Escape), giving the keyboard back to its opener. */
  readonly onClose: () => void;
}

/**
 * The board's colour tokens as a list of buttons: the built-ins, then the custom tokens
 * by name (`tokenOptionsOf`), each a swatch in the mode the colour controls show
 * (`useColourTokens`: the selection's effective mode) and its name, pressed for the token the field
 * names. A press chooses it and keeps the focus where it was; Escape closes the list.
 *
 * @param props - The id, label, current token and handlers.
 * @returns The list.
 */
export function TokenList(props: TokenListProps): ReactElement {
  const { table, mode } = useColourTokens();
  return (
    <div
      id={props.id}
      className={styles.tokenList}
      data-token-part=""
      role="group"
      aria-label={`${props.label} tokens`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        props.onClose();
      }}
    >
      {tokenOptionsOf(table).map((option) => (
        <button
          key={option.id}
          type="button"
          className={styles.tokenOption}
          aria-pressed={option.id === props.current}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            props.onToken({ token: option.id });
          }}
        >
          <span
            className={styles.tokenSwatch}
            style={{ background: swatchBackground(option.values[mode]) }}
            aria-hidden="true"
          />
          <span className={styles.tokenName}>{option.name}</span>
        </button>
      ))}
    </div>
  );
}
