import { useRef, type MouseEvent, type ReactElement } from 'react';

import type { ObjectId, Rgba } from '@canvas/schema';
import { NOTE_COLORS } from '@canvas/tools';

import { notAvailableName } from '../controls/not-available.js';
import type { TextStyleChange, TextStyleContext } from '../engine/document-text.js';
import type { MountedEngine } from '../engine/mounted-engine.js';
import { focusTextEditor } from '../focus/text-bar-target.js';
import { isSameColour } from '../panels/controls/mixed-value.js';
import type { ShellAction } from '../state/shell-action.js';

import { ListControl } from './text-bar-list.js';
import { emphasisOf, textBarSizesOf } from './text-bar-model.js';
import styles from './text-bar.module.css';

/**
 * Keeps a pointer press from taking the keyboard from the text editor.
 *
 * @param event - The press.
 */
function keepEditorFocus(event: MouseEvent): void {
  event.preventDefault();
}

/**
 * A palette colour as a CSS colour, for its swatch.
 *
 * @param color - The colour, straight alpha, channels in [0, 1].
 * @returns The CSS `rgb()` value.
 */
function cssColourOf(color: Readonly<Rgba>): string {
  const [red = 0, green = 0, blue = 0] = color.map((channel) => Math.round(channel * 255));
  return `rgb(${String(red)} ${String(green)} ${String(blue)})`;
}

/**
 * CSS module classes as one `class` value.
 *
 * @param names - The classes; a missing one is skipped.
 * @returns The value.
 */
function classesOf(...names: readonly (string | undefined)[]): string {
  return names.filter((name) => name !== undefined).join(' ');
}

/** Props of {@link BarControls}. */
export interface BarControlsProps {
  /** The edited text's style. */
  readonly context: TextStyleContext;
  /** The sticky note being edited, whose colour the swatches set; none for other text. */
  readonly noteId: ObjectId | undefined;
  /** The engine: the note's colour. */
  readonly engine: MountedEngine | undefined;
  /** Applies a change to the edited text. */
  readonly onChange: (change: TextStyleChange) => void;
  /** The shell's dispatch, for a note colour. */
  readonly dispatch: (action: ShellAction) => void;
}

/**
 * The text bar's controls, in Figma's order (E1): size; bold, italic, underline, strikethrough
 * and the list menu; a sticky note's colours; link (not available yet).
 *
 * @param props - The style, the note and the callbacks.
 * @returns The controls.
 */
export function BarControls(props: BarControlsProps): ReactElement {
  const { context, onChange, noteId } = props;
  const { style } = context;
  const emphasis = emphasisOf(style);
  return (
    <>
      <SizeControl size={style.fontSize} onChange={onChange} />
      <span className={styles.divider} aria-hidden="true" />
      <button
        type="button"
        className={classesOf(styles.item, styles.bold)}
        data-text-bar-item=""
        aria-label="Bold"
        title="Bold"
        aria-pressed={emphasis.bold}
        onMouseDown={keepEditorFocus}
        onClick={() => {
          onChange({ kind: 'toggleBold' });
        }}
      >
        B
      </button>
      <button
        type="button"
        className={classesOf(styles.item, styles.italic)}
        data-text-bar-item=""
        aria-label="Italic"
        title="Italic"
        aria-pressed={emphasis.italic}
        onMouseDown={keepEditorFocus}
        onClick={() => {
          onChange({ kind: 'toggleItalic' });
        }}
      >
        I
      </button>
      <button
        type="button"
        className={classesOf(styles.item, styles.underline)}
        data-text-bar-item=""
        aria-label="Underline"
        title="Underline"
        aria-pressed={emphasis.isUnderlined}
        onMouseDown={keepEditorFocus}
        onClick={() => {
          onChange({ kind: 'toggleUnderline' });
        }}
      >
        U
      </button>
      <button
        type="button"
        className={classesOf(styles.item, styles.strikethrough)}
        data-text-bar-item=""
        aria-label="Strikethrough"
        title="Strikethrough"
        aria-pressed={emphasis.isStruckThrough}
        onMouseDown={keepEditorFocus}
        onClick={() => {
          onChange({ kind: 'toggleStrikethrough' });
        }}
      >
        S
      </button>
      <ListControl list={context.list} onChange={onChange} />
      {noteId !== undefined && (
        <>
          <span className={styles.divider} aria-hidden="true" />
          <NoteColours noteId={noteId} engine={props.engine} dispatch={props.dispatch} />
        </>
      )}
      <span className={styles.divider} aria-hidden="true" />
      <Unavailable label="Link" className={undefined}>
        Link
      </Unavailable>
    </>
  );
}

/** Props of {@link SizeControl}. */
interface SizeControlProps {
  /** The edited text's size, world px, or undefined when mixed. */
  readonly size: number | undefined;
  /** Applies a size. */
  readonly onChange: (change: TextStyleChange) => void;
}

/**
 * The size list: the bar's sizes and the text's own, "Text 14"; "Mixed" when the range has more
 * than one. A pointer choice gives the keyboard back to the text; a keyboard choice keeps it.
 *
 * @param props - The size and the change callback.
 * @returns The list.
 */
function SizeControl(props: SizeControlProps): ReactElement {
  const { size, onChange } = props;
  const isPointer = useRef(false);
  return (
    <select
      className={classesOf(styles.item, styles.size)}
      data-text-bar-item=""
      aria-label="Text size"
      value={size === undefined ? '' : String(size)}
      onPointerDown={() => {
        isPointer.current = true;
      }}
      onBlur={() => {
        isPointer.current = false;
      }}
      onChange={(event) => {
        const fontSize = Number(event.currentTarget.value);
        onChange({ kind: 'style', patch: { fontSize } });
        if (isPointer.current) focusTextEditor(event.currentTarget);
        isPointer.current = false;
      }}
    >
      {size === undefined && (
        <option value="" disabled>
          Mixed
        </option>
      )}
      {textBarSizesOf(size).map((option) => (
        <option key={option} value={String(option)}>
          {`Text ${String(option)}`}
        </option>
      ))}
    </select>
  );
}

/** Props of {@link Unavailable}. */
interface UnavailableProps {
  /** What it would do. */
  readonly label: string;
  /** Its look besides the item's. */
  readonly className: string | undefined;
  /** What it shows. */
  readonly children: string;
}

/**
 * A control whose feature is not built (the owner's rule for unbuilt features, 2026-10-05):
 * shown faint, focusable, named "<label> — not available yet", and does nothing.
 *
 * @param props - Its label, class and content.
 * @returns The button.
 */
function Unavailable(props: UnavailableProps): ReactElement {
  const name = notAvailableName(props.label);
  return (
    <button
      type="button"
      className={classesOf(styles.item, props.className)}
      data-text-bar-item=""
      aria-disabled="true"
      aria-label={name}
      title={name}
      onMouseDown={keepEditorFocus}
    >
      {props.children}
    </button>
  );
}

/** Props of {@link NoteColours}. */
interface NoteColoursProps {
  /** The note. */
  readonly noteId: ObjectId;
  /** The engine: the note's colour now. */
  readonly engine: MountedEngine | undefined;
  /** The shell's dispatch. */
  readonly dispatch: (action: ShellAction) => void;
}

/**
 * The note's colours: a swatch per `NOTE_COLORS` entry, the note's own pressed; a pick recolours
 * the note (one style change, one undo step) and becomes the sticky tool's colour, as the style
 * panel's note section does.
 *
 * @param props - The note, the engine and the dispatch.
 * @returns The swatches.
 */
function NoteColours(props: NoteColoursProps): ReactElement {
  const { noteId, dispatch } = props;
  const note = props.engine?.board.board.get(noteId);
  const current = note?.type === 'sticky' ? note.color : undefined;
  return (
    <span className={styles.swatches} role="group" aria-label="Note colour">
      {NOTE_COLORS.map(({ name, color }) => (
        <button
          key={name}
          type="button"
          className={styles.swatch}
          data-text-bar-item=""
          aria-label={name}
          title={name}
          aria-pressed={current !== undefined && isSameColour(current, color)}
          style={{ backgroundColor: cssColourOf(color) }}
          onMouseDown={keepEditorFocus}
          onClick={() => {
            dispatch({ type: 'style', changes: [{ id: noteId, style: { color: [...color] } }] });
            dispatch({ type: 'setToolStyle', tool: 'sticky', style: { color: [...color] } });
          }}
        />
      ))}
    </span>
  );
}
