import { useState, type ReactElement } from 'react';

import type { Gradient, GradientStop } from '@canvas/schema';

import { ColourControl } from '../controls/colour-control.js';
import { rgbaToHex } from '../controls/colour-hex.js';
import { NumberControl } from '../controls/number-control.js';

import {
  addStop,
  canAddStop,
  canRemoveStop,
  clampStopIndex,
  moveStop,
  recolourStop,
  removeStop,
  type StopEdit,
} from './gradient-edits.js';
import { GradientGeometryFields } from './gradient-geometry-fields.js';
import styles from './paint.module.css';

/** Props of {@link GradientEditor}. */
export interface GradientEditorProps {
  /** The gradient every target shares. */
  readonly gradient: Gradient;
  /** Receives the edited gradient: one call per committed edit, so one undo step. */
  readonly onChange: (gradient: Gradient) => void;
}

/**
 * The gradient as a CSS background for the preview bar, left to right.
 *
 * @param stops - The stops.
 * @returns A `linear-gradient(…)`.
 */
function previewOf(stops: readonly GradientStop[]): string {
  const parts = stops.map(({ offset, color }) => {
    const [r, g, b, a] = color.map((channel, index) =>
      index < 3 ? Math.round(channel * 255) : channel,
    );
    return `rgb(${String(r)} ${String(g)} ${String(b)} / ${String(a)}) ${String(offset * 100)}%`;
  });
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

/** Props of {@link StopRow}. */
interface StopRowProps {
  readonly stop: GradientStop;
  readonly index: number;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
  readonly onOffset: (offset: number) => void;
  readonly onColour: (colour: GradientStop['color']) => void;
}

/**
 * One stop: a button selecting it (for Add and Remove), its offset as a fraction in [0, 1] and
 * its colour. Focusing a field selects the stop too.
 *
 * @param props - The stop, whether it is selected and the handlers.
 * @returns The row.
 */
function StopRow(props: StopRowProps): ReactElement {
  const { stop, index, isSelected, onSelect } = props;
  const name = `Stop ${String(index + 1)}`;
  return (
    <li className={styles.stop} data-selected={isSelected} onFocus={onSelect}>
      <button
        type="button"
        className={styles.stopMarker}
        aria-pressed={isSelected}
        aria-label={name}
        title={`${name}: ${rgbaToHex(stop.color)} at ${String(stop.offset)}`}
        style={{ background: rgbaToHex(stop.color) }}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={onSelect}
      />
      <NumberControl
        label="Stop offset"
        isLabelHidden
        value={stop.offset}
        min={0}
        max={1}
        step={0.01}
        onChange={props.onOffset}
      />
      <ColourControl
        label="Stop colour"
        isLabelHidden
        value={stop.color}
        onChange={(colour) => {
          if (colour !== null) props.onColour(colour);
        }}
      />
    </li>
  );
}

/**
 * The gradient editor: a preview bar, a row per stop (select, offset,
 * colour), Add stop (midway between the selected stop and its neighbour, coloured as the
 * gradient is there; disabled at 8 stops) and Remove stop (disabled at 2), then the geometry
 * fields. Moving a stop re-sorts the stops and keeps it selected. Each committed edit calls
 * `onChange` once, which the panel turns into one `setStyle`, one undo step.
 *
 * @param props - The gradient and the change handler.
 * @returns The editor.
 */
export function GradientEditor(props: GradientEditorProps): ReactElement {
  const { gradient, onChange } = props;
  const [chosen, setChosen] = useState(0);
  const selected = clampStopIndex(gradient, chosen);
  const apply = (edit: StopEdit | undefined) => {
    if (edit === undefined) return;
    setChosen(edit.selected);
    onChange(edit.gradient);
  };
  const keepFocus = (event: { preventDefault: () => void }) => {
    event.preventDefault();
  };
  return (
    <div className={styles.gradient}>
      <div className={styles.preview} style={{ background: previewOf(gradient.stops) }} />
      <ol className={styles.stops} aria-label="Gradient stops">
        {gradient.stops.map((stop, index) => (
          <StopRow
            // Rows are positions: a moved stop's fields follow the stop the row now shows.
            key={index}
            stop={stop}
            index={index}
            isSelected={index === selected}
            onSelect={() => {
              setChosen(index);
            }}
            onOffset={(offset) => {
              apply(moveStop(gradient, index, offset));
            }}
            onColour={(colour) => {
              setChosen(index);
              onChange(recolourStop(gradient, index, colour));
            }}
          />
        ))}
      </ol>
      <div className={styles.stopActions}>
        <button
          type="button"
          className={styles.action}
          disabled={!canAddStop(gradient)}
          onMouseDown={keepFocus}
          onClick={() => {
            apply(addStop(gradient, selected));
          }}
        >
          Add stop
        </button>
        <button
          type="button"
          className={styles.action}
          disabled={!canRemoveStop(gradient)}
          onMouseDown={keepFocus}
          onClick={() => {
            apply(removeStop(gradient, selected));
          }}
        >
          Remove stop
        </button>
      </div>
      <GradientGeometryFields gradient={gradient} onChange={onChange} />
    </div>
  );
}
