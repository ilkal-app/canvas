import type { ReactElement } from 'react';

import { INK, MAX_FONT_SIZE, MIN_FONT_SIZE } from '@canvas/schema';
import { isBoldWeight, shownTextStyle, type TextStylePatch } from '@canvas/tools';

import type { TextStyleChange, TextStyleContext } from '../../engine/document-text.js';
import { Icon } from '../../icons/icon.js';
import { weightPatchOf } from '../../text-input/curated-variable.js';
import { useFamilyAxes, type FamilyAxes } from '../../text-input/family-axes.js';
import { FontPicker } from '../../text-input/font-picker.js';
import { textToolStyleOf } from '../../tool-styles/text-style.js';
import { ColourControl } from '../controls/colour-control.js';
import { MIXED, type Mixable } from '../controls/mixed-value.js';
import { NumberControl } from '../controls/number-control.js';
import { SelectControl, type SelectOption } from '../controls/select-control.js';
import { ToggleControl } from '../controls/toggle-control.js';
import type { StylePanelSection, StylePanelSectionProps } from '../panel-sections.js';
import { useTextStyleControl } from '../text-style-control.js';

import { AxesRow, hasShownAxes } from './text-axes-row.js';
import { ALIGNS, DirectionRow, shownAlign } from './text-direction-row.js';
import { FaceRow } from './text-face-row.js';
import { FeaturesRow } from './text-features-row.js';
import { LanguageRow } from './text-language-row.js';
import {
  letterSpacingUnitPatch,
  letterSpacingValuePatch,
  lineHeightUnitPatch,
  lineHeightValuePatch,
  shownLetterSpacing,
  shownLineHeight,
  type LineHeightChoice,
  type SpacingUnit,
} from './text-spacing.js';
import styles from './text-style-section.module.css';
import { toolPatchOf } from './text-tool-patch.js';
import { WeightControl } from './text-weight-control.js';

/** Props of {@link TextStyleSection}. */
export interface TextStyleSectionProps {
  /** What the section shows: the targeted text's shared style. */
  readonly context: TextStyleContext;
  /** Applies a change to the targeted text. */
  readonly onChange: (change: TextStyleChange) => void;
}

/**
 * A field that may be missing (mixed across the targeted text) as a control's value.
 *
 * @param value - The shared value, or undefined when mixed.
 * @returns The value, or {@link MIXED}.
 */
function mixable<Value>(value: Value | undefined): Mixable<Value> {
  return value ?? MIXED;
}

/**
 * The family, size, weight (the weights the family supplies) and colour controls. Each
 * change is one command: the family and weight on choosing, the size and colour on commit (Enter, leaving the field, the picker closing), never per
 * keystroke or per drag of the picker (`panels/controls/`).
 *
 * @param props - The context and the change callback.
 * @returns The controls.
 */
function FontControls(
  props: TextStyleSectionProps & { readonly axes: FamilyAxes | undefined },
): ReactElement {
  const { context, onChange } = props;
  const { style } = context;
  const set = (patch: TextStylePatch) => {
    onChange({ kind: 'style', patch });
  };
  return (
    <>
      <FontPicker
        value={mixable(style.fontFamily)}
        // While editing, pointer selection or Enter/Escape returns the keyboard to the editor;
        // arrow-key choices keep the family list focused while it is explored.
        shouldReleaseFocus={context.isEditing}
        onChange={(fontFamily) => {
          set({ fontFamily });
        }}
      />
      <FaceRow context={context} onChange={onChange} />
      <NumberControl
        label="Size"
        value={mixable(style.fontSize)}
        min={MIN_FONT_SIZE}
        max={MAX_FONT_SIZE}
        onChange={(fontSize) => {
          set({ fontSize });
        }}
      />
      <WeightControl style={style} isEditing={context.isEditing} axes={props.axes} onStyle={set} />
      <ColourControl
        label="Colour"
        value={mixable(style.color)}
        onChange={(color) => {
          if (color !== null) set({ color });
        }}
        onInk={() => {
          set({ color: INK });
        }}
        onToken={(token) => {
          set({ color: token });
        }}
      />
    </>
  );
}

/**
 * The bold, italic and alignment toggles; a press keeps the editor's focus and selection.
 *
 * @param props - The context and the change callback.
 * @returns The row.
 */
function EmphasisRow(props: TextStyleSectionProps): ReactElement {
  const { context, onChange } = props;
  const { style } = context;
  const align = shownAlign(context);
  return (
    <div className={styles.row} role="group" aria-label="Emphasis and alignment">
      <ToggleControl
        label="Bold"
        value={style.weight === undefined ? MIXED : isBoldWeight(style.weight)}
        onChange={(isBold) => {
          // On a variable family the weight drives the weight axis: an explicit `wght`
          // is removed so the new weight shows (`weightPatchOf`).
          onChange({ kind: 'style', patch: weightPatchOf(isBold ? 700 : 400, style.fontFamily) });
        }}
      >
        B
      </ToggleControl>
      <ToggleControl
        label="Italic"
        value={mixable(style.italic)}
        onChange={(isItalic) => {
          onChange({ kind: 'style', patch: { italic: isItalic } });
        }}
      >
        I
      </ToggleControl>
      {context.canAlign !== false &&
        ALIGNS.map(([value, label, icon]) => (
          <ToggleControl
            key={value}
            label={`Text ${label.toLowerCase()}`}
            value={align === undefined ? MIXED : align === value}
            onChange={() => {
              onChange({ kind: 'align', align: value });
            }}
          >
            <Icon name={icon} />
          </ToggleControl>
        ))}
    </div>
  );
}

/** The letter-spacing's units. */
const LETTER_SPACING_UNITS: readonly SelectOption[] = [
  { value: 'percent', label: '%' },
  { value: 'px', label: 'px' },
];

/** The line-height's choices: auto, or a unit. */
const LINE_HEIGHT_UNITS: readonly SelectOption[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'percent', label: '%' },
  { value: 'px', label: 'px' },
];

/**
 * The line-height and letter-spacing fields, each a number and its unit as Figma shows
 * them: a typed number sets the field in its unit (percent while auto); a unit choice converts
 * the shown number through the shared font size, or sets auto. Each commit is one command.
 *
 * @param props - The context and the change callback.
 * @returns The fields.
 */
function SpacingFields(props: TextStyleSectionProps): ReactElement {
  const { context, onChange } = props;
  const { style } = context;
  const set = (patch: TextStylePatch | undefined) => {
    if (patch !== undefined) onChange({ kind: 'style', patch });
  };
  // A unit select calls back with an unchanged choice when Enter or Escape hands focus back to
  // the editor; the same value is a no-op edit that still reaches the text input bridge. A
  // mixed field has nothing to convert: while editing, an empty patch hands focus back alone.
  const setUnit = (patch: TextStylePatch | undefined) => {
    set(patch ?? (context.isEditing ? {} : undefined));
  };
  const lineHeight = shownLineHeight(style);
  const letterSpacing = shownLetterSpacing(style);
  return (
    <div className={styles.spacing} role="group" aria-label="Spacing">
      <div className={styles.spacingRow}>
        <NumberControl
          label="Line height"
          value={lineHeight.value}
          min={lineHeight.min}
          max={lineHeight.max}
          onChange={(value) => {
            set(lineHeightValuePatch(style, value));
          }}
        />
        <SelectControl
          label="Line height unit"
          isLabelHidden
          value={lineHeight.unit}
          options={LINE_HEIGHT_UNITS}
          shouldReleaseFocus={context.isEditing}
          onChange={(choice) => {
            setUnit(lineHeightUnitPatch(style, choice as LineHeightChoice));
          }}
        />
      </div>
      <div className={styles.spacingRow}>
        <NumberControl
          label="Letter spacing"
          value={letterSpacing.value}
          min={letterSpacing.min}
          max={letterSpacing.max}
          step={0.1}
          onChange={(value) => {
            set(letterSpacingValuePatch(style, value));
          }}
        />
        <SelectControl
          label="Letter spacing unit"
          isLabelHidden
          value={letterSpacing.unit}
          options={LETTER_SPACING_UNITS}
          shouldReleaseFocus={context.isEditing}
          onChange={(unit) => {
            setUnit(letterSpacingUnitPatch(style, unit as SpacingUnit));
          }}
        />
      </div>
    </div>
  );
}

/**
 * The style panel's text section (the prototype's toolbar, webgl-whiteboard `src/app/toolbar.ts`),
 * built from the shared controls of `panels/controls/`: family, size, colour, bold, italic,
 * alignment, line-height and letter-spacing of the text being edited (its selection or
 * caret), of the selected text objects, or of the text tool's defaults. A field that differs across
 * the targeted text is mixed (a "Mixed" family, a blank size with a dash, a striped swatch,
 * `aria-pressed="mixed"`), and choosing a value sets that field alone. Each edit is one command and
 * one undo step, committed on the control's change, never per keystroke or per drag. The editor's
 * selection lives in the editor, not the page, so focusing a control keeps it.
 *
 * @param props - The context and the change callback.
 * @returns The section's controls.
 */
export function TextStyleSection(props: TextStyleSectionProps): ReactElement {
  // Read once for the weight field and the axes row; static families read nothing.
  const axes = useFamilyAxes(props.context.style.fontFamily);
  return (
    <div className={styles.section}>
      <FontControls {...props} axes={axes} />
      <EmphasisRow {...props} />
      {props.context.canDirect !== false && <DirectionRow {...props} />}
      {props.context.canSetLanguage !== false && <LanguageRow {...props} />}
      {props.context.canSetFeatures !== false && <FeaturesRow {...props} />}
      <SpacingFields {...props} />
      {hasShownAxes(axes) && (
        <AxesRow
          axes={axes}
          style={props.context.style}
          axisValues={props.context.axisValues}
          onChange={props.onChange}
        />
      )}
    </div>
  );
}

/**
 * Whether a change to the text tool's style picks its colour as Ink (true) or a fixed colour
 * (false), for the text the tool creates (`ShellState.pickedInk`); undefined for any other
 * change, or another tool's style (a shape's label, a note's text: not resolved at creation).
 *
 * @param props - The panel's props.
 * @param change - The change.
 * @returns The pick, if any.
 */
function textInkPickOf(
  props: StylePanelSectionProps,
  change: TextStyleChange,
): boolean | undefined {
  if (props.activeTool !== 'text' || change.kind !== 'style') return undefined;
  const { color } = change.patch;
  return color === undefined ? undefined : color === INK;
}

/**
 * The text tool's defaults as the section's target, while it is active with nothing selected or
 * edited (the panel's `defaults`): its style over the catalogue's default, changes going to the
 * tool's style through `applyStyle`.
 *
 * @param props - The panel's props.
 * @returns The target, or undefined when the panel shows no tool's style.
 */
function toolDefaultsOf(props: StylePanelSectionProps): TextStyleSectionProps | undefined {
  const { defaults, applyStyle } = props;
  if (defaults === undefined) return undefined;
  const { textStyle, align } = textToolStyleOf(defaults);
  const style = shownTextStyle(textStyle);
  // The shape tool's labels are always centred: its style has no alignment to set.
  const alignment = props.context === 'shape' ? { align: undefined, canAlign: false } : { align };
  // The tool's style has no direction: new text is auto.
  return {
    context: {
      style,
      ...alignment,
      canDirect: false,
      canSetLanguage: false,
      canSetFeatures: false,
      isEditing: false,
    },
    onChange: (change) => {
      applyStyle(toolPatchOf(change, style), textInkPickOf(props, change));
    },
  };
}

/**
 * The text section as the contextual panel mounts it: the text the shell provides
 * (`TextStyleProvider`: the text being edited, or the selected text objects), else the text
 * tool's defaults, else a hint. Text is restyled through the text commands the provider runs
 * (`restyleTextObjects`, `setTextRuns` through the editing session) rather than the panel's
 * generic `applyStyle`, because a text's measured size must be written in the same step as its
 * new style; only the tool's defaults go through `applyStyle`.
 *
 * @param props - The panel's props: its defaults and `applyStyle` for the text tool's style.
 * @returns The controls, or the hint.
 */
function TextStylePanelSection(props: StylePanelSectionProps): ReactElement {
  const { context, onChange } = useTextStyleControl();
  const target = context === undefined ? toolDefaultsOf(props) : { context, onChange };
  if (target === undefined) {
    const hint =
      props.context === 'shape'
        ? 'Double-click a shape to add a label.'
        : 'Click the board to add text, or select a text.';
    return <p className={styles.hint}>{hint}</p>;
  }
  return <TextStyleSection {...target} />;
}

/**
 * The style panel's text section: shown for text objects and the text tool (the `text`
 * context), first among that context's sections, for sticky notes and the sticky tool (the `note`
 * context), after the palette: a note's text is rich text, styled as a text object's; and
 * for shapes and the shape tool (the `shape` context): a label's text, without the
 * alignment toggles (a label is always centred), after the fill and stroke and collapsed until a
 * selected shape has a label.
 */
export const stylePanelSection: StylePanelSection = {
  id: 'text-style',
  title: 'Text',
  context: ['text', 'note', 'shape'],
  order: 10,
  isCollapsedByDefault: hasNoLabel,
  render: TextStylePanelSection,
};

/**
 * Whether the section starts collapsed: for shapes, until one selected has a label
 * with text; the shape tool's style, notes and text start expanded.
 *
 * @param props - The panel's props.
 * @returns True for selected shapes none of which has a label.
 */
export function hasNoLabel(props: StylePanelSectionProps): boolean {
  if (props.context !== 'shape' || props.selection.length === 0) return false;
  return props.selection.every(
    (object) => object.type !== 'shape' || object.label === null || object.label.text === '',
  );
}
