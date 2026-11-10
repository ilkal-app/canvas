import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type RefObject,
} from 'react';

import styles from './controls.module.css';
import { MIXED, type Mixable } from './mixed-value.js';
import { scrubValue } from './scrub.js';
import { useCommittedChange } from './use-committed-change.js';

/** Props of {@link NumberControl}. */
export interface NumberControlProps {
  /** The field's name. */
  readonly label: string;
  /** The number, or {@link MIXED} when the selection disagrees. */
  readonly value: Mixable<number>;
  /** The smallest value accepted. */
  readonly min: number;
  /** The largest value accepted. */
  readonly max: number;
  /** The spinner's step; 1 if absent. */
  readonly step?: number;
  /**
   * Whether the label is for assistive technology only (a gradient stop's row). Such a field
   * has no label to drag, so it does not scrub.
   */
  readonly isLabelHidden?: boolean;
  /**
   * What the field's label shows when it is shorter than its name (the layout's `W` for
   * "Layout width"): the field is then compact, its label a narrow column, and its
   * name, `label`, is for assistive technology. The label shows `label` if absent.
   */
  readonly shortLabel?: string;
  /**
   * Whether the field is disabled (the control states sheet): shown at 38% opacity,
   * with no hover, no scrub and no edit; enabled if absent.
   */
  readonly isDisabled?: boolean;
  /** Receives a committed value within [`min`, `max`] that differs from the one shown. */
  readonly onChange: (value: number) => void;
}

/** The scrub hint the field shows while it has focus. */
const SCRUB_HINT = 'drag to scrub · ⇧ ×10';

/** A drag of the field's label under way: where it started and the value it shows now. */
interface Scrub {
  /** The pointer being tracked. */
  readonly pointerId: number;
  /** The pointer's x when the drag started, CSS px. */
  readonly startX: number;
  /** The field's value when the drag started. */
  readonly from: number;
  /** The value the drag has reached. */
  readonly to: number;
}

/**
 * The message an invalid entry shows: what the field accepts.
 *
 * @param min - The smallest value accepted.
 * @param max - The largest value accepted.
 * @returns The message.
 */
function rangeMessage(min: number, max: number): string {
  return `Enter a number from ${String(min)} to ${String(max)}`;
}

/** What {@link useScrub} needs of the field. */
interface ScrubField {
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly value: Mixable<number>;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly canScrub: boolean;
  readonly onChange: (value: number) => void;
}

/**
 * Scrubbing a number field by dragging its label: the field takes focus, its
 * value follows the pointer (`scrubValue`; Shift steps by ten) and is committed once, when the
 * pointer is let go, so a scrub is one undo step. A cancelled pointer puts the value back.
 *
 * @param field - The input, its value, bounds and step, whether it scrubs, and the handler.
 * @returns The drag under way, if any, and the label's pointer handlers.
 */
function useScrub(field: ScrubField) {
  const { inputRef, value, min, max, step, canScrub, onChange } = field;
  const [scrub, setScrub] = useState<Scrub>();
  const end = (event: ReactPointerEvent<HTMLLabelElement>, shouldCommit: boolean): void => {
    if (scrub?.pointerId !== event.pointerId) return;
    setScrub(undefined);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const input = inputRef.current;
    if (!shouldCommit) {
      if (input !== null) input.value = String(scrub.from);
      return;
    }
    if (scrub.to !== scrub.from) onChange(scrub.to);
  };
  const handlers = {
    onPointerDown: (event: ReactPointerEvent<HTMLLabelElement>) => {
      if (!canScrub || value === MIXED || event.button !== 0) return;
      // No text selection and no label activation: the drag is the gesture.
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      inputRef.current?.focus();
      setScrub({ pointerId: event.pointerId, startX: event.clientX, from: value, to: value });
    },
    onPointerMove: (event: ReactPointerEvent<HTMLLabelElement>) => {
      if (scrub?.pointerId !== event.pointerId) return;
      const to = scrubValue({
        start: scrub.from,
        deltaPx: event.clientX - scrub.startX,
        step,
        min,
        max,
        isCoarse: event.shiftKey,
      });
      if (inputRef.current !== null) inputRef.current.value = String(to);
      if (to !== scrub.to) setScrub({ ...scrub, to });
    },
    onPointerUp: (event: ReactPointerEvent<HTMLLabelElement>) => {
      end(event, true);
    },
    onPointerCancel: (event: ReactPointerEvent<HTMLLabelElement>) => {
      end(event, false);
    },
  };
  return { scrub, handlers };
}

/** Props of {@link FieldOverlays}. */
interface FieldOverlaysProps {
  /** Whether the selection's values differ. */
  readonly isMixed: boolean;
  /** The drag under way, if any. */
  readonly scrub: Scrub | undefined;
}

/**
 * What shows over a number field, hidden from assistive technology (the label says "(mixed)"):
 * "Mixed" while the selection's values differ, else the scrub read-out, which the stylesheet
 * shows while the field has focus or is scrubbed: where a drag took the value, and how to scrub.
 *
 * @param props - Whether the value is mixed, and the drag.
 * @returns The overlays.
 */
function FieldOverlays(props: FieldOverlaysProps): ReactElement {
  const { isMixed, scrub } = props;
  if (isMixed) {
    return (
      <span className={styles.mixed} aria-hidden="true">
        Mixed
      </span>
    );
  }
  return (
    <span className={styles.scrubReadOut} aria-hidden="true">
      {scrub === undefined ? null : <span>{`${String(scrub.from)} → ${String(scrub.to)}`}</span>}
      <span className={styles.scrubHint}>{SCRUB_HINT}</span>
    </span>
  );
}

/**
 * Keeps an uncontrolled field showing a value, so a document change never clobbers what is
 * being typed: after every render the field takes the value shown unless it has focus (a refused
 * edit reverts once it leaves).
 *
 * @param inputRef - The field.
 * @param shown - What it shows.
 */
function useShownValue(inputRef: RefObject<HTMLInputElement | null>, shown: string): void {
  useEffect(() => {
    const input = inputRef.current;
    if (input === null || input.ownerDocument.activeElement === input) return;
    if (input.value !== shown) input.value = shown;
  });
}

/**
 * A field's label: its name, or its short label shown with the name for assistive technology.
 *
 * @param props - The name and the short label.
 * @param props.label - The field's name.
 * @param props.shortLabel - What the label shows instead, if anything.
 * @returns The label's text.
 */
function LabelText(props: {
  readonly label: string;
  readonly shortLabel: string | undefined;
}): ReactElement {
  const { label, shortLabel } = props;
  if (shortLabel === undefined || shortLabel === label) return <>{label}</>;
  return (
    <>
      <span aria-hidden="true">{shortLabel}</span>
      <span className={styles.hidden}>{label}</span>
    </>
  );
}

/**
 * A number field: reading "Mixed" when the selection's values differ
 * (blank, with a `–` placeholder once it has focus), and a value entered then applies to every
 * selected object. A value is applied when committed (Enter, leaving the field, a spinner step),
 * not per keystroke, so each is one undo step; an empty or unchanged one is dropped, and one out
 * of range or not a number shows the field's error state, saying what it accepts, while the
 * field keeps its last good value (the control states sheet). Dragging the label
 * scrubs the value (Shift steps by ten), with a read-out while the field has focus;
 * a field whose label is for assistive technology only (`isLabelHidden`) has none to drag.
 * Enter and Escape hand the keyboard back to the canvas, as in the prototype
 * (webgl-whiteboard `src/app/toolbar.ts`), and go no further; Escape also drops the edit.
 *
 * @param props - The label, value, bounds, whether it is disabled, and handler.
 * @returns The control.
 */
export function NumberControl(props: NumberControlProps): ReactElement {
  const { label, value, min, max, step = 1, isDisabled = false, onChange } = props;
  const isLabelHidden = props.isLabelHidden === true;
  const id = useId();
  const errorId = `${id}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const shown = value === MIXED ? '' : String(value);
  const canScrub = !isDisabled && !isLabelHidden && value !== MIXED;
  const { scrub, handlers } = useScrub({ inputRef, value, min, max, step, canScrub, onChange });
  useShownValue(inputRef, shown);
  useCommittedChange(inputRef, (typed, input) => {
    const number = Number(typed);
    const isBlank = typed.trim() === '';
    const isInRange = !isBlank && number >= min && number <= max;
    setError(isBlank || isInRange ? undefined : rangeMessage(min, max));
    if (isInRange && number !== value) onChange(number);
    else input.value = shown;
  });
  return (
    <div
      className={styles.numberControl}
      data-disabled={isDisabled ? '' : undefined}
      data-label-hidden={isLabelHidden ? '' : undefined}
      data-compact={props.shortLabel === undefined ? undefined : ''}
    >
      <div className={styles.control}>
        <label
          htmlFor={id}
          className={isLabelHidden ? styles.hidden : styles.label}
          data-scrub={canScrub ? '' : undefined}
          {...handlers}
        >
          <LabelText label={label} shortLabel={props.shortLabel} />
          {value === MIXED && <span className={styles.hidden}> (mixed)</span>}
        </label>
        <span className={styles.field} data-scrubbing={scrub === undefined ? undefined : ''}>
          <input
            ref={inputRef}
            id={id}
            className={styles.number}
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step={step}
            placeholder="–"
            disabled={isDisabled}
            aria-invalid={error === undefined ? undefined : true}
            aria-describedby={error === undefined ? undefined : errorId}
            data-mixed={value === MIXED ? '' : undefined}
            defaultValue={shown}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.currentTarget.value = shown;
                setError(undefined);
              }
              if (event.key !== 'Enter' && event.key !== 'Escape') return;
              // The key ends here: once the field lets go, the canvas (the text editor's input,
              // which takes the keyboard back) must not receive it as a line break or an Escape.
              event.preventDefault();
              event.currentTarget.blur();
            }}
          />
          {(value === MIXED || canScrub) && (
            <FieldOverlays isMixed={value === MIXED} scrub={scrub} />
          )}
        </span>
      </div>
      <span id={errorId} className={styles.fieldError} aria-live="polite">
        {error}
      </span>
    </div>
  );
}
