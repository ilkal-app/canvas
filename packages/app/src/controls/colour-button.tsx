import { useRef, useState, type KeyboardEvent, type ReactElement, type RefObject } from 'react';

import { nextRovingIndex } from '../focus/roving-index.js';
import { Icon } from '../icons/icon.js';

import { AnchoredPopover } from './anchored-popover.js';
import styles from './colour-button.module.css';
import { ColourPicker, parseCustomColour } from './colour-picker.js';

/** One colour a {@link ColourButton}'s palette offers. */
export interface ColourChoice {
  /** What choosing it reports: a token's id, a hex colour. */
  readonly value: string;
  /** Its name ("Yellow", "Brand blue"), its swatch's accessible name. */
  readonly label: string;
  /** Its swatch's fill, as CSS (`#f6e39a`, `rgb(…)`, `var(--…)`). */
  readonly swatch: string;
}

/** A labelled group of a palette: the sticky colours, the board's tokens, the recent ones. */
export interface ColourGroup {
  /** Its heading ("Sticky", "Board colours", "Recent"). */
  readonly label: string;
  /** Its colours, in order. */
  readonly choices: readonly ColourChoice[];
}

/** Props of {@link ColourButton}. */
export interface ColourButtonProps {
  /** Its accessible name ("Fill"); the button is named with the colour after it. */
  readonly label: string;
  /** The value chosen; a swatch with it shows as pressed. */
  readonly value: string;
  /** The current colour's name, for the button's name ("Yellow", "#3c6fb0"). */
  readonly valueLabel: string;
  /** The current colour's swatch fill, as CSS. */
  readonly swatch: string;
  /** The palette's groups, in order; an empty group is left out. */
  readonly groups: readonly ColourGroup[];
  /** Whether the palette ends with a custom hex field; true if absent. */
  readonly canTakeCustom?: boolean | undefined;
  /** Receives a value chosen (a choice's, or a custom `#rrggbb`), only when it differs. */
  readonly onChange: (value: string) => void;
  /** Whether it is disabled: 38%, announced. */
  readonly isDisabled?: boolean | undefined;
  /** More attributes for its trigger: `data-dock-item` for a toolbar's roving focus. */
  readonly dataAttributes?: Readonly<Record<`data-${string}`, string>> | undefined;
  /**
   * Whether the selection differs on this colour: the button is named "label: Mixed",
   * its swatch crossed, and no swatch pressed.
   */
  readonly isMixed?: boolean | undefined;
  /**
   * The colours used last, most recent first: a "Recent" group after the others, without those
   * the palette already offers.
   */
  readonly recent?: readonly ColourChoice[] | undefined;
  /** Space between the trigger and its palette, px; 4 if absent (12 in a popover, frame A). */
  readonly gap?: number | undefined;
}

export { parseCustomColour } from './colour-picker.js';

/**
 * The swatch a key moves to in the palette: the arrows step through every swatch in order
 * (Left and Right mirrored in a right-to-left page), Home and End jump.
 *
 * @param event - The key.
 * @param index - The swatch focused now.
 * @param count - How many swatches.
 * @returns The next swatch, or undefined when the key does not move.
 */
function nextSwatch(event: KeyboardEvent<HTMLElement>, index: number, count: number) {
  const isRtl = getComputedStyle(event.currentTarget).direction === 'rtl';
  const forward = isRtl ? 'ArrowLeft' : 'ArrowRight';
  const back = isRtl ? 'ArrowRight' : 'ArrowLeft';
  const key = event.key === forward ? 'ArrowDown' : event.key === back ? 'ArrowUp' : event.key;
  return nextRovingIndex(key, index, count);
}

/** What the palette needs. */
interface PaletteProps {
  readonly props: ColourButtonProps;
  readonly onPick: (value: string) => void;
  /** Applies a colour the custom picker moved to, leaving the palette open. */
  readonly onApply: (value: string) => void;
}

/**
 * Where the custom picker starts: the current colour when it is a hex colour, else the
 * current swatch's when that is one, else black.
 *
 * @param props - The button's props.
 * @returns `#rrggbb`.
 */
function pickerStartOf(props: ColourButtonProps): string {
  return parseCustomColour(props.value) ?? parseCustomColour(props.swatch) ?? '#000000';
}

/**
 * The palette: each group's heading and swatches (one Tab stop for all of them, the arrows
 * between), then the custom colour picker.
 *
 * @param palette - The button's props and the pick handler.
 * @returns The palette's contents.
 */
function Palette(palette: PaletteProps): ReactElement {
  const { props, onPick, onApply } = palette;
  const listRef = useRef<HTMLDivElement>(null);
  const groups = props.groups.filter((group) => group.choices.length > 0);
  const choices = groups.flatMap((group) => group.choices);
  // Where each group's swatches start in the palette's order (a colour may be in two groups).
  const starts = groups.map((group) => {
    const before = groups.slice(0, groups.indexOf(group));
    return before.reduce((sum, earlier) => sum + earlier.choices.length, 0);
  });
  // The swatches' one Tab stop: the current colour's at first, then wherever focus moved.
  const [tabStop, setTabStop] = useState(() =>
    Math.max(
      0,
      choices.findIndex((choice) => choice.value === props.value),
    ),
  );
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const swatches = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-swatch]') ?? [])];
    const focused = swatches.findIndex((swatch) => swatch === document.activeElement);
    if (focused === -1) return;
    const next = nextSwatch(event, focused, swatches.length);
    if (next === undefined) return;
    event.preventDefault();
    swatches[next]?.focus();
  };
  return (
    <>
      <div ref={listRef} className={styles.groups} onKeyDown={onKeyDown}>
        {groups.map((group, groupIndex) => (
          <div key={group.label} role="group" aria-label={group.label} className={styles.group}>
            <span className={styles.heading} aria-hidden="true">
              {group.label}
            </span>
            <div className={styles.swatches}>
              {group.choices.map((choice, index) => (
                <button
                  key={choice.value}
                  type="button"
                  className={styles.swatch}
                  {...swatchFill(choice.swatch)}
                  aria-label={choice.label}
                  aria-pressed={props.isMixed !== true && choice.value === props.value}
                  tabIndex={(starts[groupIndex] ?? 0) + index === tabStop ? 0 : -1}
                  data-swatch=""
                  onFocus={() => {
                    setTabStop((starts[groupIndex] ?? 0) + index);
                  }}
                  onClick={() => {
                    onPick(choice.value);
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      {props.canTakeCustom === false ? null : (
        <ColourPicker start={pickerStartOf(props)} onApply={onApply} onPick={onPick} />
      )}
    </>
  );
}

/**
 * A swatch's fill: the colour inline, or, for no colour (`transparent`), `data-none`,
 * which the stylesheet draws as a checkerboard rather than letting what is behind show through.
 *
 * @param swatch - The swatch's fill, as CSS.
 * @returns The swatch's attributes.
 */
function swatchFill(swatch: string): {
  readonly style?: { readonly background: string };
  readonly 'data-none'?: '';
} {
  return swatch === 'transparent' ? { 'data-none': '' } : { style: { background: swatch } };
}

/**
 * The trigger: the current colour's 20 px swatch and a chevron.
 *
 * @param props - The button's props, its ref, state and toggle.
 * @param props.button - The button's props.
 * @param props.triggerRef - Receives the trigger.
 * @param props.isOpen - Whether the palette is open.
 * @param props.onToggle - Opens or closes it.
 * @returns The trigger.
 */
function Trigger(props: {
  readonly button: ColourButtonProps;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
}): ReactElement {
  const { button } = props;
  return (
    <button
      ref={props.triggerRef}
      type="button"
      className={styles.trigger}
      aria-label={`${button.label}: ${button.isMixed === true ? 'Mixed' : button.valueLabel}`}
      aria-haspopup="dialog"
      {...button.dataAttributes}
      aria-expanded={props.isOpen}
      disabled={button.isDisabled === true}
      aria-disabled={button.isDisabled === true ? true : undefined}
      onClick={props.onToggle}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown') return;
        event.preventDefault();
        if (!props.isOpen) props.onToggle();
      }}
    >
      <span
        className={styles.current}
        data-mixed={button.isMixed === true ? '' : undefined}
        {...(button.isMixed === true ? {} : swatchFill(button.swatch))}
      />
      <Icon name="chevron-down" />
    </button>
  );
}

/**
 * A colour button (the properties popover's colour, the Library's Swatch): a 28 px
 * trigger with the current colour's 20 px swatch and a chevron, named "label: colour", which
 * opens a palette under it: each group's swatches (the sticky colours, the board's tokens, the
 * recent ones) as one Tab stop moved through by the arrows, the current one pressed, then a
 * custom colour picker: a saturation and brightness area, a hue slider and a Hex field
 * (Enter applies `#rrggbb`); the area and the hue apply as they are let go, leaving it open. Choosing closes it with focus back on the trigger;
 * Escape too; a press outside closes it. It takes the popup stack (a child of the popover it
 * sits in). Light and dark come from the tokens; only the swatches' fills are the colours.
 *
 * @param given - Its name, value, palette and handler.
 * @returns The trigger and, while open, its palette.
 */
export function ColourButton(given: ColourButtonProps): ReactElement {
  // A recent colour the palette already offers shows once, in its group.
  const offered = new Set(
    given.groups.flatMap((group) => group.choices.map((choice) => choice.value)),
  );
  const recent = (given.recent ?? []).filter((choice) => !offered.has(choice.value));
  const props =
    recent.length === 0
      ? given
      : { ...given, groups: [...given.groups, { label: 'Recent', choices: recent }] };
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setOpen] = useState(false);
  const close = (): void => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  return (
    <>
      <Trigger
        button={props}
        triggerRef={triggerRef}
        isOpen={isOpen}
        onToggle={() => {
          setOpen((wasOpen) => !wasOpen);
        }}
      />
      <AnchoredPopover
        anchor={triggerRef}
        isOpen={isOpen}
        label={`${props.label} colours`}
        role="dialog"
        shape="stack"
        side="bottom"
        align="start"
        gap={props.gap ?? 4}
        initialFocus='[data-swatch][tabindex="0"]'
        onClose={() => {
          setOpen(false);
        }}
      >
        <Palette
          props={props}
          onPick={(value) => {
            close();
            if (value !== props.value) props.onChange(value);
          }}
          onApply={(value) => {
            if (value !== props.value) props.onChange(value);
          }}
        />
      </AnchoredPopover>
    </>
  );
}
