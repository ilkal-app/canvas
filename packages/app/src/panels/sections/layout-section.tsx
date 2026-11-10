import type { ReactElement } from 'react';

import type { BoardObject } from '@canvas/schema';

import controls from '../controls/controls.module.css';
import { commonValue, MIXED, type Mixable } from '../controls/mixed-value.js';
import { NumberControl } from '../controls/number-control.js';
import { ToggleControl } from '../controls/toggle-control.js';
import { layoutBoxOf, type LayoutBox, type LayoutField } from '../layout-box.js';
import type { StylePanelSection, StylePanelSectionProps } from '../panel-sections.js';

import styles from './layout-section.module.css';

/** The farthest a position field goes from the board's origin, world units. */
export const MAX_LAYOUT_POSITION = 1_000_000;

/** The largest size a size field takes, world units. */
export const MAX_LAYOUT_SIZE = 100_000;

/** One field of the layout section. */
interface LayoutFieldSpec {
  /** The field. */
  readonly field: LayoutField;
  /** Its name, for assistive technology. */
  readonly label: string;
  /** What its label shows. */
  readonly shortLabel: string;
  /** The smallest value it takes. */
  readonly min: number;
  /** The largest value it takes. */
  readonly max: number;
}

/** The section's fields, in the frames' order: X and Y, W and H, then rotation. */
export const LAYOUT_FIELDS: readonly LayoutFieldSpec[] = [
  { field: 'x', label: 'X', shortLabel: 'X', min: -MAX_LAYOUT_POSITION, max: MAX_LAYOUT_POSITION },
  { field: 'y', label: 'Y', shortLabel: 'Y', min: -MAX_LAYOUT_POSITION, max: MAX_LAYOUT_POSITION },
  { field: 'width', label: 'Layout width', shortLabel: 'W', min: 0, max: MAX_LAYOUT_SIZE },
  { field: 'height', label: 'Layout height', shortLabel: 'H', min: 0, max: MAX_LAYOUT_SIZE },
  { field: 'rotation', label: 'Rotation, degrees', shortLabel: 'R', min: -180, max: 180 },
];

/** The object types an auto-layout container stacks: the boxes. */
const STACKED_TYPES: ReadonlySet<BoardObject['type']> = new Set([
  'text',
  'sticky',
  'image',
  'video',
  'shape',
  'frame',
  'component',
  'instance',
]);

/**
 * Whether every selected object is a box its parent's live auto-layout places: its
 * place then follows the layout, and it can fill the space left.
 *
 * @param props - The panel's props.
 * @returns True when the selection is all stacked children.
 */
export function isStackedSelection(props: StylePanelSectionProps): boolean {
  return (
    props.selection.length > 0 &&
    props.selection.every((object) => {
      if (!STACKED_TYPES.has(object.type) || typeof object.parentId !== 'string') return false;
      const parent = props.board.get(object.parentId);
      return (
        (parent?.type === 'frame' || parent?.type === 'component') &&
        parent.autoLayout !== undefined
      );
    })
  );
}

/**
 * The selected objects' boxes, as the section shows them.
 *
 * @param props - The panel's props.
 * @returns One box per object whose place can be worked out.
 */
function boxesOf(props: StylePanelSectionProps): LayoutBox[] {
  return props.selection.flatMap((object) => {
    const box = layoutBoxOf(props.board, object);
    return box === undefined ? [] : [box];
  });
}

/**
 * A field's value across the selection.
 *
 * @param boxes - The selected objects' boxes.
 * @param field - The field.
 * @returns The value they share, or {@link MIXED}.
 */
function valueOf(boxes: readonly LayoutBox[], field: LayoutField): Mixable<number> {
  return commonValue(boxes, (box) => box[field]) ?? MIXED;
}

/**
 * What the collapsed layout section's header says: `176 × 120 at 412, 268`, the size
 * and the position of the selection's box, or "Mixed" when the selected objects' differ.
 *
 * @param props - The panel's props.
 * @returns The summary, or undefined with nothing to measure.
 */
export function layoutSummary(props: StylePanelSectionProps): string | undefined {
  const boxes = boxesOf(props);
  if (boxes.length === 0) return undefined;
  const values = (['width', 'height', 'x', 'y'] as const).map((field) => valueOf(boxes, field));
  if (values.some((value) => value === MIXED)) return 'Mixed';
  const [width, height, x, y] = values.map(String);
  return `${width ?? ''} × ${height ?? ''} at ${x ?? ''}, ${y ?? ''}`;
}

/**
 * The inspector's layout section: the selection's X and Y (its box's left and top on
 * the board), W and H, and rotation in degrees, as number fields that scrub, step and validate
 * as's do, "Mixed" where the selected objects differ. A committed value is one `layout`
 * canvas action, which the engine runs as the existing `moveObjects`, `resizeObjects` or
 * `rotateObjects` command, one undo step. W and H are disabled for a selection with nothing
 * `resizeObjects` takes (lines, paths, connectors), and every field for a locked selection
 * (the panel's lock), whose commands would refuse it. For boxes their parent's live auto-layout
 * places, X and Y are read-only, since the layout would undo a move, and "Fill
 * container" sets whether they take the space left along the stack (one `autoLayout` action).
 *
 * @param props - The panel's props.
 * @returns The fields.
 */
function LayoutSection(props: StylePanelSectionProps): ReactElement {
  const { selection, dispatch } = props;
  const boxes = boxesOf(props);
  const canResize = boxes.some((box) => box.canResize);
  const ids = selection.map((object) => object.id);
  const isStacked = isStackedSelection(props);
  const isFilling =
    commonValue(
      selection,
      (object) => 'layoutChild' in object && object.layoutChild?.fill === true,
    ) ?? MIXED;
  const isPlaced = (field: LayoutField) => isStacked && (field === 'x' || field === 'y');
  return (
    <>
      <div className={styles.grid}>
        {LAYOUT_FIELDS.map((spec) => (
          <div
            key={spec.field}
            className={spec.field === 'rotation' ? styles.rotation : styles.cell}
            data-field={spec.field}
          >
            <NumberControl
              label={spec.label}
              shortLabel={spec.shortLabel}
              value={boxes.length === 0 ? MIXED : valueOf(boxes, spec.field)}
              min={spec.min}
              max={spec.max}
              isDisabled={
                isPlaced(spec.field) ||
                (!canResize && (spec.field === 'width' || spec.field === 'height'))
              }
              onChange={(value) => {
                dispatch({ type: 'layout', ids, field: spec.field, value });
              }}
            />
          </div>
        ))}
      </div>
      {isStacked && (
        <>
          <p className={styles.note}>Auto layout places this.</p>
          <div className={controls.control}>
            <ToggleControl
              label="Fill container"
              value={isFilling}
              onChange={(isFilled) => {
                dispatch({
                  type: 'autoLayout',
                  ids,
                  change: { kind: 'child', layoutChild: { fill: isFilled } },
                });
              }}
            />
          </div>
        </>
      )}
    </>
  );
}

/**
 * The layout section: for every kind with a place and a size (text, notes, paths,
 * shapes, images, frames, groups), selection only; collapsed at first for notes, whose frames
 * show it folded with its summary.
 */
export const stylePanelSection: StylePanelSection = {
  id: 'layout',
  title: 'Layout',
  context: ['text', 'note', 'vector', 'shape', 'image', 'frame', 'group', 'component', 'instance'],
  order: 900,
  isSelectionOnly: true,
  isCollapsedByDefault: (props) => props.context === 'note',
  summary: layoutSummary,
  render: LayoutSection,
};
