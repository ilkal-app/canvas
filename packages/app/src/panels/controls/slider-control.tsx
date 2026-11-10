import { useEffect, useId, useRef, useState, type ReactElement } from 'react';

import styles from './controls.module.css';
import { MIXED, type Mixable } from './mixed-value.js';
import { useCommittedChange } from './use-committed-change.js';

/** Props of {@link SliderControl}. */
export interface SliderControlProps {
  /** The field's name. */
  readonly label: string;
  /** The value, or {@link MIXED} when the selection disagrees. */
  readonly value: Mixable<number>;
  /** The smallest value. */
  readonly min: number;
  /** The largest value. */
  readonly max: number;
  /** The step; 1 if absent. */
  readonly step?: number;
  /** How the value reads beside the slider (`50%`); the number itself if absent. */
  readonly format?: (value: number) => string;
  /** Receives a committed value that differs from the one shown. */
  readonly onChange: (value: number) => void;
  /**
   * Receives each value while the slider is dragged, before it is committed (the text
   * axes preview a drag on the canvas).
   */
  readonly onPreview?: (value: number) => void;
  /**
   * Called once when a drag ends: before its commit, when it ends where it began, or when the
   * slider loses focus or unmounts mid-drag.
   */
  readonly onPreviewEnd?: () => void;
}

/**
 * A slider field: a range input with its value read out beside it. A
 * drag previews in the control (the thumb and the read-out follow it), and `onPreview` lets the
 * caller show each dragged value elsewhere too; it commits once, on release (the
 * input's native `change`, `useCommittedChange`), after `onPreviewEnd`, so a drag is one command
 * and one undo step; arrow keys commit a step at a time. A mixed selection reads `Mixed` with the
 * thumb at the middle until a value is chosen.
 *
 * @param props - The label, value, bounds, format and handler.
 * @returns The control.
 */
export function SliderControl(props: SliderControlProps): ReactElement {
  const {
    label,
    value,
    min,
    max,
    step = 1,
    format = String,
    onChange,
    onPreview,
    onPreviewEnd,
  } = props;
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragged, setDragged] = useState<number | undefined>(undefined);
  const shown = value === MIXED ? (min + max) / 2 : value;
  // Whether a drag is previewing, and the latest end callback: a drag ends once, however it ends.
  const isPreviewing = useRef(false);
  const previewEndRef = useRef(onPreviewEnd);
  useEffect(() => {
    previewEndRef.current = onPreviewEnd;
  });
  const endPreview = (): void => {
    if (!isPreviewing.current) return;
    isPreviewing.current = false;
    previewEndRef.current?.();
  };
  useEffect(
    () => () => {
      if (isPreviewing.current) previewEndRef.current?.();
    },
    [],
  );
  // A new value from the document ends any preview of the old one.
  useEffect(() => {
    setDragged(undefined);
  }, [value]);
  useCommittedChange(inputRef, (committed) => {
    const number = Number(committed);
    setDragged(undefined);
    endPreview();
    if (number !== value) onChange(number);
  });
  const readOut = dragged === undefined && value === MIXED ? 'Mixed' : format(dragged ?? shown);
  return (
    <div className={styles.control}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        className={styles.slider}
        type="range"
        min={min}
        max={max}
        step={step}
        value={dragged ?? shown}
        aria-valuetext={readOut}
        onChange={(event) => {
          const dragged = Number(event.currentTarget.value);
          setDragged(dragged);
          isPreviewing.current = true;
          onPreview?.(dragged);
        }}
        onBlur={() => {
          setDragged(undefined);
          endPreview();
        }}
      />
      <output htmlFor={id} className={styles.readOut}>
        {readOut}
      </output>
    </div>
  );
}
