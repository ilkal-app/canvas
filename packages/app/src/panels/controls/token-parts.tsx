import { useId, useRef, useState, type ReactElement } from 'react';

import { resolveColor, type Rgba, type TokenRef } from '@canvas/schema';

import { useColourTokens } from './colour-tokens-context.js';
import controls from './controls.module.css';
import { TokenList } from './token-list.js';
import { tokenNameOf } from './token-options.js';
import styles from './token-parts.module.css';

/** Props of {@link TokenParts}. */
export interface TokenPartsProps {
  /** The field's name: the button is "<label> tokens". */
  readonly label: string;
  /** The token the field names now; undefined for a colour, none or mixed. */
  readonly token: TokenRef | undefined;
  /** Sets the field to a token; without it there is no Tokens button. */
  readonly onToken?: ((token: TokenRef) => void) | undefined;
  /** Sets the field to a plain colour: the token's value as shown (Detach colour). */
  readonly onDetach: (colour: Rgba) => void;
}

/**
 * The board colour token parts of a colour field, in a wrapping row: a
 * Tokens button (with `onToken`) that opens the board's tokens (`TokenList`) under the row,
 * where a press chooses one; and, while the field names a token, a line with its name and
 * "Detach colour", which gives the field the token's value in the mode shown (`useColourTokens`),
 * a plain colour from then on. Presses keep the focus where it was; Escape in the list closes it
 * and gives the keyboard back to the button.
 *
 * @param props - The label, the token and the handlers.
 * @returns The parts.
 */
export function TokenParts(props: TokenPartsProps): ReactElement {
  const { label, token, onToken, onDetach } = props;
  const { table, mode } = useColourTokens();
  const listId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setOpen] = useState(false);
  const keepFocus = (event: { preventDefault: () => void }) => {
    event.preventDefault();
  };
  return (
    <>
      {onToken !== undefined && (
        <button
          ref={buttonRef}
          type="button"
          className={controls.toggle}
          aria-label={`${label} tokens`}
          aria-expanded={isOpen}
          aria-controls={isOpen ? listId : undefined}
          onMouseDown={keepFocus}
          onClick={() => {
            setOpen(!isOpen);
          }}
        >
          Tokens
        </button>
      )}
      {token !== undefined && (
        <div className={styles.tokenLine} data-token-part="">
          <span className={styles.tokenName} data-token={token.token}>
            {tokenNameOf(token.token, table)}
          </span>
          <button
            type="button"
            className={controls.toggle}
            onMouseDown={keepFocus}
            onClick={() => {
              onDetach(resolveColor(token, mode, table));
            }}
          >
            Detach colour
          </button>
        </div>
      )}
      {onToken !== undefined && isOpen && (
        <TokenList
          id={listId}
          label={label}
          current={token?.token}
          onToken={(chosen) => {
            setOpen(false);
            onToken(chosen);
          }}
          onClose={() => {
            setOpen(false);
            buttonRef.current?.focus();
          }}
        />
      )}
    </>
  );
}
