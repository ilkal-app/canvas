import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';

import { hexToHsv, hsvToHex, type Hsv } from './colour-picker-math.js';
import styles from './colour-picker.module.css';

/** A custom colour as typed: `#` and six hex digits, or six hex digits. */
const CUSTOM_PATTERN = /^#?([0-9a-f]{6})$/i;

/**
 * Reads a typed custom colour.
 *
 * @param text - What was typed.
 * @returns Lower-case `#rrggbb`, or undefined when it is not a hex colour.
 */
export function parseCustomColour(text: string): string | undefined {
  const match = CUSTOM_PATTERN.exec(text.trim());
  return match?.[1] === undefined ? undefined : `#${match[1].toLowerCase()}`;
}

/** The area's arrow keys: which of saturation and brightness each moves, and which way. */
const AREA_KEYS: Readonly<Record<string, readonly ['s' | 'v', 1 | -1]>> = {
  ArrowRight: ['s', 1],
  ArrowLeft: ['s', -1],
  ArrowUp: ['v', 1],
  ArrowDown: ['v', -1],
};

/**
 * A fraction stepped by whole percents and kept between 0 and 1.
 *
 * @param fraction - The fraction.
 * @param percents - The step, percent.
 * @returns The stepped fraction.
 */
function stepPercent(fraction: number, percents: number): number {
  return Math.min(100, Math.max(0, Math.round(fraction * 100) + percents)) / 100;
}

/**
 * A fraction of a length, kept between 0 and 1.
 *
 * @param offset - The distance along it.
 * @param length - The length.
 * @returns The fraction.
 */
function fractionOf(offset: number, length: number): number {
  return length <= 0 ? 0 : Math.min(1, Math.max(0, offset / length));
}

/**
 * The saturation and brightness under a point of the area.
 *
 * @param area - The area.
 * @param point - The point, window coordinates.
 * @param point.clientX - Its x.
 * @param point.clientY - Its y.
 * @param hue - The hue it shows.
 * @returns The colour there.
 */
function colourAt(
  area: HTMLElement,
  point: { readonly clientX: number; readonly clientY: number },
  hue: number,
): Hsv {
  const box = area.getBoundingClientRect();
  return {
    h: hue,
    s: fractionOf(point.clientX - box.left, box.width),
    v: 1 - fractionOf(point.clientY - box.top, box.height),
  };
}

/**
 * The saturation and brightness area over the hue: a press follows the pointer, anywhere on the
 * page, and applies where it is let go; the arrow keys step 1% (Shift 10%) and apply each step.
 *
 * @param props - The colour shown, and the handlers.
 * @param props.hsv - The colour shown.
 * @param props.onMove - Shows a colour, returning its hex.
 * @param props.onApply - Applies a colour.
 * @returns The area.
 */
function SaturationArea(props: {
  readonly hsv: Hsv;
  readonly onMove: (next: Hsv) => string;
  readonly onApply: (hex: string) => void;
}): ReactElement {
  const { hsv, onMove, onApply } = props;
  // Ends the press in progress: a palette closed under a held press applies nothing.
  const endPress = useRef<(() => void) | undefined>(undefined);
  useEffect(
    () => () => {
      endPress.current?.();
    },
    [],
  );
  const onPress = (event: ReactPointerEvent<HTMLDivElement>): void => {
    endPress.current?.();
    const area = event.currentTarget;
    const { h } = hsv;
    onMove(colourAt(area, event, h));
    // Followed on the window, so a press dragged past the area's edge keeps the edge's colour.
    const follow = (moved: PointerEvent): void => {
      onMove(colourAt(area, moved, h));
    };
    const release = (released: PointerEvent): void => {
      end();
      if (released.type === 'pointerup') onApply(onMove(colourAt(area, released, h)));
    };
    const end = (): void => {
      window.removeEventListener('pointermove', follow);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      endPress.current = undefined;
    };
    endPress.current = end;
    window.addEventListener('pointermove', follow);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = AREA_KEYS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const [field, sign] = step;
    onApply(onMove({ ...hsv, [field]: stepPercent(hsv[field], sign * (event.shiftKey ? 10 : 1)) }));
  };
  const saturation = Math.round(hsv.s * 100);
  const brightness = Math.round(hsv.v * 100);
  return (
    <div
      className={styles.area}
      role="slider"
      tabIndex={0}
      aria-label="Saturation and brightness"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={saturation}
      aria-valuetext={`Saturation ${String(saturation)}%, brightness ${String(brightness)}%`}
      style={{
        // The colours themselves: black below, white to the left, over the hue.
        background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${String(Math.round(hsv.h) % 360)} 100% 50%)`,
      }}
      onKeyDown={onKey}
      onPointerDown={onPress}
    >
      <span
        className={styles.thumb}
        style={{ left: `${String(hsv.s * 100)}%`, top: `${String((1 - hsv.v) * 100)}%` }}
      />
    </div>
  );
}

/**
 * The hue slider: it shows the hue as it moves (`input`) and applies it when let go (`change`).
 *
 * @param props - The colour shown, and the handlers.
 * @param props.hsv - The colour shown.
 * @param props.onMove - Shows a colour.
 * @param props.onApply - Applies a colour.
 * @returns The slider.
 */
function HueSlider(props: {
  readonly hsv: Hsv;
  readonly onMove: (next: Hsv) => string;
  readonly onApply: (hex: string) => void;
}): ReactElement {
  const hueRef = useRef<HTMLInputElement>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  useEffect(() => {
    const hue = hueRef.current;
    if (hue === null) return undefined;
    // React's onChange is the `input` event; the native `change` is the hue let go.
    const onCommit = (): void => {
      const { hsv, onApply } = latest.current;
      onApply(hsvToHex(Number(hue.value), hsv.s, hsv.v));
    };
    hue.addEventListener('change', onCommit);
    return () => {
      hue.removeEventListener('change', onCommit);
    };
  }, []);
  return (
    <input
      ref={hueRef}
      className={styles.hue}
      type="range"
      aria-label="Hue"
      min={0}
      max={360}
      step={1}
      value={Math.round(props.hsv.h) % 360}
      style={{
        background:
          'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00) center / 100% 8px no-repeat',
      }}
      onChange={(event) => {
        props.onMove({ ...props.hsv, h: Number(event.target.value) });
      }}
    />
  );
}

/** Props of {@link ColourPicker}. */
export interface ColourPickerProps {
  /** The colour it starts at, `#rrggbb`. */
  readonly start: string;
  /** Applies a colour moved to on the area or the hue, leaving the palette open. */
  readonly onApply: (hex: string) => void;
  /** Applies a colour typed in Hex (Enter), as choosing a swatch does. */
  readonly onPick: (hex: string) => void;
}

/**
 * The palette's custom colour (no one remembers RGB values): a saturation and
 * brightness area over the hue, a hue slider and a Hex field. The area takes a press (applied on
 * release) and the arrow keys (each applied; Shift steps 10%); the hue applies when it is let go;
 * Enter in Hex applies `#rrggbb` and closes the palette, as a swatch does.
 *
 * @param props - The colour it starts at and the handlers.
 * @returns The picker.
 */
export function ColourPicker(props: ColourPickerProps): ReactElement {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(props.start));
  const [text, setText] = useState(props.start);
  const hexId = useId();
  const move = (next: Hsv): string => {
    const hex = hsvToHex(next.h, next.s, next.v);
    setHsv(next);
    setText(hex);
    return hex;
  };
  const parsed = parseCustomColour(text);
  return (
    <div className={styles.picker}>
      <span className={styles.heading}>Custom</span>
      <SaturationArea hsv={hsv} onMove={move} onApply={props.onApply} />
      <HueSlider hsv={hsv} onMove={move} onApply={props.onApply} />
      <label className={styles.hexRow} htmlFor={hexId}>
        <span className={styles.heading}>Hex</span>
        <input
          id={hexId}
          className={styles.input}
          value={text}
          placeholder="#rrggbb"
          maxLength={7}
          spellCheck={false}
          aria-invalid={parsed === undefined}
          onChange={(event) => {
            setText(event.target.value);
            const typed = parseCustomColour(event.target.value);
            if (typed !== undefined) setHsv(hexToHsv(typed));
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || parsed === undefined) return;
            event.preventDefault();
            props.onPick(parsed);
          }}
        />
      </label>
    </div>
  );
}
