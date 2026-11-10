import type { ReactElement } from 'react';

import type { BoardReader } from '@canvas/document';
import type { BoardObject, InkableColor, ObjectId, OverrideRecord } from '@canvas/schema';

import { SHAPE_KIND_LABELS } from '../../state/tool-variants.js';
import type { ComponentListItem } from '../components/component-list.js';
import { ColourControl } from '../controls/colour-control.js';
import { TextFieldControl } from '../controls/text-field-control.js';
import { ToggleControl } from '../controls/toggle-control.js';
import type { InstanceOverrideRow } from '../instance-override-rows.js';

import styles from './component-sections.module.css';
import { SlotMainPicker } from './instance-swap-controls.js';
import { OverrideOpacityField } from './override-opacity-field.js';
import { ReplaceImageControl } from './replace-image-control.js';
import { ResetField } from './reset-field.js';

/** How far each level of a row's depth is indented, CSS px, as in the layers panel. */
const INDENT_PX = 12;

/** The longest text a row's name quotes, in characters. */
const MAX_QUOTED_LENGTH = 24;

/** Each type's name in a row, for the types a row names by type alone. */
const TYPE_LABELS: Readonly<Partial<Record<BoardObject['type'], string>>> = {
  image: 'Image',
  video: 'Video',
  line: 'Line',
  connector: 'Connector',
  path: 'Pen path',
  group: 'Group',
  frame: 'Frame',
  component: 'Component',
};

/** The colour fields a row may show, each with its control's name. */
const COLOUR_FIELDS = [
  ['fill', 'Fill'],
  ['strokeColor', 'Stroke'],
  ['color', 'Colour'],
] as const;

/** The fields an image replacement writes, which its Reset clears together. */
const IMAGE_FIELDS = [
  'assetId',
  'naturalSize',
  'crop',
] as const satisfies readonly (keyof OverrideRecord)[];

/**
 * A text quoted in a row's name: its first line, shortened.
 *
 * @param text - The text.
 * @returns The quote, with its marks.
 */
function quoted(text: string): string {
  const [line = ''] = text.split('\n');
  const short = line.length > MAX_QUOTED_LENGTH ? `${line.slice(0, MAX_QUOTED_LENGTH)}…` : line;
  return `“${short}”`;
}

/**
 * A row's name: a text's or a note's words, a shape's kind, a nested instance's main, a
 * frame's name, else its type.
 *
 * @param source - The child, as its main stores it.
 * @param board - The whole board, for a nested instance's main.
 * @returns The name.
 */
export function overrideRowName(source: BoardObject, board: BoardReader): string {
  switch (source.type) {
    case 'text':
      return `Text ${quoted(source.text)}`;
    case 'sticky':
      return `Note ${quoted(source.text)}`;
    case 'shape':
      return SHAPE_KIND_LABELS[source.kind];
    case 'instance': {
      const main = board.get(source.mainId);
      return main?.type === 'component' ? `Instance of ${main.name}` : 'Instance';
    }
    case 'frame':
      return source.name === '' ? 'Frame' : source.name;
    default:
      return TYPE_LABELS[source.type] ?? source.type;
  }
}

/**
 * The text a child shows, which a text override replaces: a text's or a note's, a shape's or a
 * connector's label; none for a shape without a label, which a text override would not show.
 *
 * @param source - The child.
 * @returns Its text, or undefined.
 */
function sourceText(source: BoardObject): string | undefined {
  if (source.type === 'text' || source.type === 'sticky') return source.text;
  if (source.type === 'shape' || source.type === 'connector') return source.label?.text;
  return undefined;
}

/**
 * The colour a child's text shows, which a `textStyle.color` override replaces: its first run's;
 * none for a child without text.
 *
 * @param source - The child.
 * @returns The colour, or undefined.
 */
function sourceTextColour(source: BoardObject): InkableColor | undefined {
  if (source.type === 'text' || source.type === 'sticky') return source.runs[0]?.style.color;
  if (source.type === 'shape' || source.type === 'connector') {
    return source.label?.runs[0]?.style.color;
  }
  return undefined;
}

/**
 * The colour a child shows in a field, which an override of it replaces: a plain fill (a
 * gradient shows as none), an existing stroke's colour, a note's colour.
 *
 * @param source - The child.
 * @param field - The field.
 * @returns The colour, null for none, or undefined when the child shows nothing of it.
 */
function sourceColour(
  source: BoardObject,
  field: (typeof COLOUR_FIELDS)[number][0],
): InkableColor | null | undefined {
  if (field === 'fill') {
    // A frame's fill is its background: a plain colour shows, a gradient or
    // image shows as none, as a shape's fill does.
    if (source.type === 'frame') return Array.isArray(source.background) ? source.background : null;
    if (source.type !== 'shape' && source.type !== 'path') return undefined;
    return Array.isArray(source.fill) ? source.fill : null;
  }
  if (field === 'color') return source.type === 'sticky' ? source.color : undefined;
  return 'stroke' in source ? source.stroke?.color : undefined;
}

/** Props of {@link TextFields}. */
interface TextFieldsProps {
  /** The fields the child takes. */
  readonly fields: ReadonlySet<keyof OverrideRecord>;
  /** The child, as its main stores it. */
  readonly source: BoardObject;
  /** Its record in the instance, if any. */
  readonly override: OverrideRecord | undefined;
  /** What its chosen variant's presets set, under the record. */
  readonly preset: OverrideRecord | undefined;
  /** Merges fields into the record. */
  readonly set: (record: OverrideRecord) => void;
  /** Clears the given fields of the record. */
  readonly reset: (cleared: readonly (keyof OverrideRecord)[]) => () => void;
}

/**
 * A child's text fields: its text, which a `text` override replaces in the main's styles, and its
 * "Text colour", `textStyle.color`, written beside the record's other style fields.
 * Each has its own Reset; the colour's clears the colour alone (the whole style when it held
 * only the colour). Nothing for a child that shows no text.
 *
 * @param props - The child's fields, the child, its record, and how to set and reset fields.
 * @returns The fields, or null.
 */
function TextFields(props: TextFieldsProps): ReactElement | null {
  const { fields, source, override, preset, set, reset } = props;
  const text = fields.has('text') ? sourceText(source) : undefined;
  const shown = fields.has('textStyle') ? sourceTextColour(source) : undefined;
  const textStyle = override?.textStyle;
  const presetColour = preset?.textStyle?.color;
  const resetColour = (): void => {
    const { color, ...rest } = textStyle ?? {};
    if (Object.values(rest).some((value) => value !== undefined)) set({ textStyle: rest });
    else if (color !== undefined) reset(['textStyle'])();
  };
  return (
    <>
      {text !== undefined && (
        <ResetField
          label="text"
          isOverridden={override?.text !== undefined}
          isFromVariant={preset?.text !== undefined}
          onReset={reset(['text'])}
        >
          <TextFieldControl
            label="Text"
            value={override?.text ?? preset?.text ?? text}
            onCommit={(value) => {
              set({ text: value });
            }}
          />
        </ResetField>
      )}
      {shown !== undefined && (
        <ResetField
          label="text colour"
          isOverridden={textStyle?.color !== undefined}
          isFromVariant={presetColour !== undefined}
          onReset={resetColour}
        >
          <ColourControl
            label="Text colour"
            value={textStyle?.color ?? presetColour ?? shown}
            onChange={(colour) => {
              if (colour !== null) set({ textStyle: { ...textStyle, color: colour } });
            }}
            onToken={(token) => {
              set({ textStyle: { ...textStyle, color: token } });
            }}
          />
        </ResetField>
      )}
    </>
  );
}

/** Props of {@link HiddenToggle}. */
interface HiddenToggleProps {
  /** The row's record, if any. */
  readonly override: OverrideRecord | undefined;
  /** What its chosen variant's presets set, under the record. */
  readonly preset: OverrideRecord | undefined;
  /** Merges fields into the record. */
  readonly set: (record: OverrideRecord) => void;
  /** Clears the given fields of the record. */
  readonly reset: (cleared: readonly (keyof OverrideRecord)[]) => () => void;
}

/**
 * A row's "Hidden": hides the child, and shows it again by clearing that field alone, so it is
 * its own reset; a child its chosen preset hides shows hidden, "From variant", and is shown again
 * by a record saying so.
 *
 * @param props - The record, the preset, and how to set and reset fields.
 * @returns The toggle, with its caption.
 */
function HiddenToggle(props: HiddenToggleProps): ReactElement {
  const { override, preset, set, reset } = props;
  return (
    <>
      <ToggleControl
        label="Hidden"
        value={(override?.isHidden ?? preset?.isHidden) === true}
        onChange={(isHidden) => {
          if (isHidden) set({ isHidden: true });
          else if (preset?.isHidden === true) set({ isHidden: false });
          else reset(['isHidden'])();
        }}
      />
      {override?.isHidden === undefined && preset?.isHidden !== undefined && (
        <span className={styles.fromVariant}>From variant</span>
      )}
    </>
  );
}

/** Props of {@link InstanceOverrideRowItem}. */
export interface InstanceOverrideRowItemProps {
  /** The whole board: an image child's box in the instance is read from it. */
  readonly board: BoardReader;
  /**
   * The instance, whose image child "Replace image…" sizes in its box; absent when the row edits
   * a main's preset, which has no instance box and offers no replacement.
   */
  readonly instanceId?: ObjectId;
  /** The row. */
  readonly row: InstanceOverrideRow;
  /** Its name. */
  readonly name: string;
  /**
   * The board's live mains, which a nested instance's Main picker offers; no picker
   * when absent, as for a preset's rows.
   */
  readonly mains?: readonly ComponentListItem[];
  /** Merges fields into the row's record: an instance's override, or a preset's record. */
  readonly set: (path: string, record: OverrideRecord) => void;
  /** Clears fields of the row's record. */
  readonly reset: (path: string, fields: readonly (keyof OverrideRecord)[]) => void;
}

/**
 * One overridable child of an instance's main in the instance section (ruling 1): its
 * name, indented by depth; "Hidden", which hides it (and shows it again by clearing that field
 * alone, so it is its own reset); its text and its text colour (`TextFields`), for a
 * child that shows text; a nested instance's "Main" (`SlotMainPicker`); its fill,
 * stroke or note colour; its opacity in percent; an image's "Replace image…"
 * (`ReplaceImageControl`), where the page has images. Each change is one
 * `setInstanceOverride`; each overridden property has its own "Reset", which
 * clears that property alone (an image's asset, size and crop together), one
 * `resetInstanceOverrides` with its fields (rule 4; the section's "Reset all" clears the rest).
 *
 * @param props - The board, the instance, the row, its name and the dispatch.
 * @returns The row.
 */
export function InstanceOverrideRowItem(props: InstanceOverrideRowItemProps): ReactElement {
  const { instanceId: id, row } = props;
  const { path, source, override, preset } = row;
  const fields = new Set<keyof OverrideRecord>(row.fields);
  const set = (record: OverrideRecord): void => {
    props.set(path, record);
  };
  const reset = (cleared: readonly (keyof OverrideRecord)[]) => (): void => {
    props.reset(path, cleared);
  };

  const isImageReplaced = IMAGE_FIELDS.some((field) => override?.[field] !== undefined);
  return (
    <div
      role="group"
      aria-label={props.name}
      className={styles.row}
      style={{ paddingInlineStart: `${String(row.depth * INDENT_PX)}px` }}
    >
      <div className={styles.rowHeading}>
        <span className={styles.rowName}>{props.name}</span>
        <HiddenToggle override={override} preset={preset} set={set} reset={reset} />
      </div>
      {row.slot !== undefined && props.mains !== undefined && (
        <SlotMainPicker
          board={props.board}
          placement={row.slot}
          override={override}
          preset={preset}
          mains={props.mains}
          set={set}
          reset={reset}
        />
      )}
      <TextFields {...{ fields, source, override, preset, set, reset }} />
      {COLOUR_FIELDS.map(([field, label]) => {
        const shown = fields.has(field) ? sourceColour(source, field) : undefined;
        if (shown === undefined) return null;
        return (
          <ResetField
            key={field}
            label={label.toLowerCase()}
            isOverridden={override?.[field] !== undefined}
            isFromVariant={preset?.[field] !== undefined}
            onReset={reset([field])}
          >
            <ColourControl
              label={label}
              value={override?.[field] ?? preset?.[field] ?? shown}
              onChange={(colour) => {
                if (colour !== null) set({ [field]: colour });
              }}
              onToken={(token) => {
                set({ [field]: token });
              }}
            />
          </ResetField>
        );
      })}
      {fields.has('opacity') && (
        <OverrideOpacityField {...{ source, override, preset, set, reset }} />
      )}
      {source.type === 'image' && fields.has('assetId') && id !== undefined && (
        <ResetField label="image" isOverridden={isImageReplaced} onReset={reset(IMAGE_FIELDS)}>
          <ReplaceImageControl
            board={props.board}
            instanceId={id}
            path={path}
            source={source}
            set={set}
          />
        </ResetField>
      )}
    </div>
  );
}
