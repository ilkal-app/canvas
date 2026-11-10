import { useEffect, useId, useRef, type ReactElement } from 'react';

import {
  INK,
  isTokenRef,
  resolveColor,
  type ColorMode,
  type InkableColor,
  type Rgba,
  type TokenRef,
  type TokenTable,
} from '@canvas/schema';

import { hexToRgba, rgbaToHex } from './colour-hex.js';
import { useColourTokens } from './colour-tokens-context.js';
import styles from './controls.module.css';
import { InkButton } from './ink-button.js';
import { inkPickerHex, inkSwatchBackground } from './ink-swatch.js';
import { MIXED, type Mixable } from './mixed-value.js';
import { TokenParts } from './token-parts.js';
import { useCommittedChange } from './use-committed-change.js';

/** Props of {@link ColourControl}. */
export interface ColourControlProps {
  /** The field's name. */
  readonly label: string;
  /**
   * The colour, the `ink` token (a stroke or text colour), a board colour token (`{ token }`,
   *), null for none, or {@link MIXED} when the selection disagrees.
   */
  readonly value: Mixable<InkableColor | null>;
  /** Whether the field can be none (a fill, an outline): shows a None toggle. */
  readonly canBeNone?: boolean;
  /** Whether the label is for assistive technology only (a gradient stop's row). */
  readonly isLabelHidden?: boolean;
  /** Receives the chosen colour (alpha kept from the value, 1 if it had none), or null. */
  readonly onChange: (value: Rgba | null) => void;
  /**
   * Sets the field to `ink`. When given, an Ink swatch shows first, pressed while the value is
   * `ink`; only stroke and text colours offer it (never fills, gradient stops or note colours).
   */
  readonly onInk?: () => void;
  /**
   * Sets the field to a board colour token. When given, a Tokens button
   * opens the board's tokens (`TokenList`); fills, backgrounds, note colours and strokes and text
   * offer them, gradient stops do not (v1).
   */
  readonly onToken?: (token: TokenRef) => void;
}

/** What the swatch shows. */
type SwatchState = 'mixed' | 'none' | 'ink' | 'token' | 'colour';

/**
 * What the swatch draws over the input: stripes for mixed, a stroke for none, the two inks
 * for `ink`; a token's value in the picker.
 *
 * @param value - The field's value.
 * @returns The swatch's state.
 */
function swatchState(value: Mixable<InkableColor | null>): SwatchState {
  if (value === MIXED) return 'mixed';
  if (value === INK) return 'ink';
  if (isTokenRef(value)) return 'token';
  return value === null ? 'none' : 'colour';
}

/**
 * The hex the picker shows for a value: the colour's, the light ink's for `ink`, a token's value
 * in the mode shown, or nothing (the picker keeps its last colour) for none and mixed.
 *
 * @param value - The field's value.
 * @param table - The board's token table.
 * @param mode - The mode a token is shown in.
 * @returns `#rrggbb`, or undefined.
 */
function pickerHexOf(
  value: Mixable<InkableColor | null>,
  table: TokenTable,
  mode: ColorMode,
): string | undefined {
  if (value === MIXED || value === null) return undefined;
  return value === INK ? inkPickerHex() : rgbaToHex(resolveColor(value, mode, table));
}

/**
 * A colour field: a colour input in a swatch, striped and reading
 * "Mixed" when the selection's colours differ, struck through when there is none and split light and dark for
 * `ink`, with an optional Ink swatch before it and an optional None toggle
 * (pressed again, it restores the picker's colour). The picker's choice is applied once, when it
 * closes (`change`), so it is one undo step; choosing a colour in a mixed or `ink` state sets
 * that colour on all. With `onToken` a Tokens button opens the board's colour tokens,
 * one press choosing one; a field naming a token shows the token's value in the mode shown
 * (`useColourTokens`) and, under the row, its name and "Detach colour", which sets that value.
 *
 * @param props - The label, value and handlers.
 * @returns The control.
 */
export function ColourControl(props: ColourControlProps): ReactElement {
  const { label, value, canBeNone = false, onChange, onInk, onToken } = props;
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const { table, mode } = useColourTokens();
  const state = swatchState(value);
  const alpha = Array.isArray(value) ? value[3] : 1;
  const hex = pickerHexOf(value, table, mode);
  const token = isTokenRef(value) ? value : undefined;
  // Uncontrolled, so React never resets the picker mid-choice; a new value from the document
  // is written in here (a none or mixed value leaves the last colour in the picker).
  useEffect(() => {
    if (hex !== undefined && inputRef.current !== null) inputRef.current.value = hex;
  }, [hex]);
  const commit = (chosen: string) => {
    const colour = hexToRgba(chosen, alpha);
    if (colour !== undefined) onChange(colour);
  };
  useCommittedChange(inputRef, commit);
  const isStateNamed = state === 'mixed' || state === 'none';
  return (
    <div className={onToken === undefined ? styles.control : styles.colourControl}>
      <label htmlFor={id} className={props.isLabelHidden === true ? styles.hidden : styles.label}>
        {label}
        {isStateNamed && <span className={styles.hidden}> ({state})</span>}
      </label>
      {onInk !== undefined && <InkButton isPressed={state === 'ink'} onInk={onInk} />}
      <span
        className={styles.swatch}
        data-state={state}
        style={state === 'ink' ? { background: inkSwatchBackground() } : undefined}
      >
        <input
          ref={inputRef}
          id={id}
          type="color"
          defaultValue={hex ?? '#000000'}
          onKeyDown={(event) => {
            // Enter confirms a typed value, as in the number fields; it does not open the
            // picker, which would hold the keyboard (and the next undo) after the edit.
            if (event.key === 'Enter') event.preventDefault();
          }}
        />
      </span>
      {state === 'mixed' && (
        <span className={styles.mixedCaption} aria-hidden="true">
          Mixed
        </span>
      )}
      {canBeNone && (
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={state === 'none'}
          aria-label={`No ${label.toLowerCase()}`}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={() => {
            // Pressed again, None gives the field back the picker's colour.
            if (state === 'none') commit(inputRef.current?.value ?? '#000000');
            else onChange(null);
          }}
        >
          None
        </button>
      )}
      <TokenParts label={label} token={token} onToken={onToken} onDetach={onChange} />
    </div>
  );
}
