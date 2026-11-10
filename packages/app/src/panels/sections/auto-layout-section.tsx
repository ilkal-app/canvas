import type { ReactElement } from 'react';

import {
  DEFAULT_AUTO_LAYOUT,
  type AutoLayout,
  type BoardObject,
  type ObjectId,
} from '@canvas/schema';

import { Button } from '../../controls/button.js';
import type { CanvasAction } from '../../state/shell-action.js';
import { commonValue, MIXED, type Mixable } from '../controls/mixed-value.js';
import { NumberControl } from '../controls/number-control.js';
import { SelectControl, type SelectOption } from '../controls/select-control.js';
import type { StylePanelSection, StylePanelSectionProps } from '../panel-sections.js';

import styles from './auto-layout-section.module.css';
import { MAX_LAYOUT_SIZE } from './layout-section.js';

/** What an `autoLayout` canvas action changes. */
type AutoLayoutChange = Extract<CanvasAction, { readonly type: 'autoLayout' }>['change'];

/** A frame or main, with the auto-layout it has, if any. */
type Container = BoardObject & {
  readonly type: 'frame' | 'component';
  readonly autoLayout?: AutoLayout | undefined;
};

/** A container that has an auto-layout. */
type LaidOut = Container & { readonly autoLayout: AutoLayout };

/** The choices of each list field. */
const DIRECTIONS: readonly SelectOption[] = [
  { value: 'row', label: 'Row' },
  { value: 'column', label: 'Column' },
];
const ALIGNS: readonly SelectOption[] = [
  { value: 'start', label: 'Start' },
  { value: 'center', label: 'Center' },
  { value: 'end', label: 'End' },
  { value: 'stretch', label: 'Stretch' },
];
const JUSTIFIES: readonly SelectOption[] = [
  { value: 'start', label: 'Start' },
  { value: 'center', label: 'Center' },
  { value: 'end', label: 'End' },
  { value: 'space-between', label: 'Space between' },
];
const SIZINGS: readonly SelectOption[] = [
  { value: 'hug', label: 'Hug contents' },
  { value: 'fixed', label: 'Fixed' },
];

/** The padding fields, in reading order. */
const SIDES = [
  { side: 'top', label: 'Padding top', shortLabel: 'T' },
  { side: 'right', label: 'Padding right', shortLabel: 'R' },
  { side: 'bottom', label: 'Padding bottom', shortLabel: 'B' },
  { side: 'left', label: 'Padding left', shortLabel: 'L' },
] as const;

/**
 * The selected frames and mains.
 *
 * @param selection - The selection.
 * @returns The containers in it.
 */
function containersOf(selection: readonly BoardObject[]): Container[] {
  return selection.flatMap((object) =>
    object.type === 'frame' || object.type === 'component' ? [object as Container] : [],
  );
}

/**
 * Whether a container has an auto-layout.
 *
 * @param container - The container.
 * @returns True when it has one.
 */
function isLaidOut(container: Container): container is LaidOut {
  return container.autoLayout !== undefined;
}

/**
 * One list field's value across the laid-out containers.
 *
 * @param laidOut - The containers with an auto-layout.
 * @param read - Reads the field.
 * @returns The value they share, or {@link MIXED}.
 */
function shared<Value>(
  laidOut: readonly LaidOut[],
  read: (autoLayout: AutoLayout) => Value,
): Mixable<Value> {
  return commonValue(laidOut, (container) => read(container.autoLayout)) ?? MIXED;
}

/**
 * What the collapsed section's header says: "None" when no selected container has an
 * auto-layout, its direction and gap ("Row, gap 8") when they share them, else "Mixed".
 *
 * @param props - The panel's props.
 * @returns The summary.
 */
export function autoLayoutSummary(props: StylePanelSectionProps): string {
  const containers = containersOf(props.selection);
  const laidOut = containers.filter(isLaidOut);
  if (laidOut.length === 0) return 'None';
  const direction = shared(laidOut, (autoLayout) => autoLayout.direction);
  const gap = shared(laidOut, (autoLayout) => autoLayout.gap);
  if (laidOut.length < containers.length || direction === MIXED || gap === MIXED) return 'Mixed';
  return `${direction === 'row' ? 'Row' : 'Column'}, gap ${String(gap)}`;
}

/** What {@link AutoLayoutFields} edits. */
interface AutoLayoutFieldsProps {
  /** The selected containers that have an auto-layout. */
  readonly laidOut: readonly LaidOut[];
  /** Changes some fields of each one's own layout. */
  readonly patch: (fields: AutoLayoutPatch) => void;
}

/** Some fields of an auto-layout, padding per side, as `patchAutoLayout` takes them. */
type AutoLayoutPatch = Omit<Partial<AutoLayout>, 'padding'> & {
  readonly padding?: Partial<AutoLayout['padding']>;
};

/**
 * A list field of the section.
 *
 * @param props - The field.
 * @param props.label - Its name.
 * @param props.value - Its value across the containers.
 * @param props.options - Its choices.
 * @param props.onChange - Receives a choice.
 * @returns The field, across the grid.
 */
function ListField(props: {
  readonly label: string;
  readonly value: Mixable<string>;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string) => void;
}): ReactElement {
  return (
    <div className={styles.wide}>
      <SelectControl {...props} />
    </div>
  );
}

/**
 * The fields of the section's laid-out containers: direction, gap, padding per side, align,
 * justify, and each axis' sizing, "Mixed" where they differ.
 *
 * @param props - The containers and what edits them.
 * @param props.laidOut - The selected containers that have an auto-layout.
 * @param props.patch - Changes some fields of each one's own layout.
 * @returns The fields.
 */
function AutoLayoutFields({ laidOut, patch }: AutoLayoutFieldsProps): ReactElement {
  const value = <Value,>(read: (autoLayout: AutoLayout) => Value) => shared(laidOut, read);
  return (
    <div className={styles.grid}>
      <ListField
        label="Direction"
        value={value((autoLayout) => autoLayout.direction)}
        options={DIRECTIONS}
        onChange={(next) => {
          patch({ direction: next as AutoLayout['direction'] });
        }}
      />
      <div className={styles.wide}>
        <NumberControl
          label="Gap"
          value={value((autoLayout) => autoLayout.gap)}
          min={-MAX_LAYOUT_SIZE}
          max={MAX_LAYOUT_SIZE}
          onChange={(gap) => {
            patch({ gap });
          }}
        />
      </div>
      {SIDES.map(({ side, label, shortLabel }) => (
        <div key={side} className={styles.cell} data-side={side}>
          <NumberControl
            label={label}
            shortLabel={shortLabel}
            value={value((autoLayout) => autoLayout.padding[side])}
            min={0}
            max={MAX_LAYOUT_SIZE}
            onChange={(next) => {
              patch({ padding: { [side]: next } });
            }}
          />
        </div>
      ))}
      <ListField
        label="Align"
        value={value((autoLayout) => autoLayout.align)}
        options={ALIGNS}
        onChange={(next) => {
          patch({ align: next as AutoLayout['align'] });
        }}
      />
      <ListField
        label="Justify"
        value={value((autoLayout) => autoLayout.justify)}
        options={JUSTIFIES}
        onChange={(next) => {
          patch({ justify: next as AutoLayout['justify'] });
        }}
      />
      <ListField
        label="Width"
        value={value((autoLayout) => autoLayout.width)}
        options={SIZINGS}
        onChange={(next) => {
          patch({ width: next as AutoLayout['width'] });
        }}
      />
      <ListField
        label="Height"
        value={value((autoLayout) => autoLayout.height)}
        options={SIZINGS}
        onChange={(next) => {
          patch({ height: next as AutoLayout['height'] });
        }}
      />
    </div>
  );
}

/**
 * The inspector's auto-layout section: a frame's or main's live auto-layout, a row
 * or column stack of its children. With none, an "Add auto layout" button sets the default one
 * (a hugging row, no gap or padding). With one: its fields ({@link AutoLayoutFields}) and a
 * "Remove auto layout" button, which leaves the children where they are. Each committed edit is
 * one `autoLayout` canvas action, one command that lays the containers out in the same step, so
 * one undo step; an edit changes only that field (or padding side) of each container's own
 * layout. Containers in the selection without one keep an "Add auto layout" button of their own.
 *
 * @param props - The panel's props.
 * @returns The controls.
 */
function AutoLayoutSection(props: StylePanelSectionProps): ReactElement {
  const { selection, dispatch } = props;
  const containers = containersOf(selection);
  const laidOut = containers.filter(isLaidOut);
  const laidOutIds = laidOut.map((container) => container.id);
  const bareIds = containers.flatMap((container) => (isLaidOut(container) ? [] : [container.id]));
  const change = (ids: readonly ObjectId[], next: AutoLayoutChange): void => {
    dispatch({ type: 'autoLayout', ids, change: next });
  };
  const add =
    bareIds.length === 0 ? null : (
      <Button
        onClick={() => {
          change(bareIds, { kind: 'set', autoLayout: DEFAULT_AUTO_LAYOUT });
        }}
      >
        Add auto layout
      </Button>
    );
  if (laidOut.length === 0) return <div className={styles.actions}>{add}</div>;
  return (
    <>
      <AutoLayoutFields
        laidOut={laidOut}
        patch={(fields) => {
          change(laidOutIds, { kind: 'patch', patch: fields });
        }}
      />
      <div className={styles.actions}>
        {add}
        <Button
          kind="ghost"
          onClick={() => {
            change(laidOutIds, { kind: 'set', autoLayout: null });
          }}
        >
          Remove auto layout
        </Button>
      </div>
    </>
  );
}

/**
 * The auto-layout section: for frames and mains, selection only, after the frame
 * or main section (order 5) and before fill and stroke (7), as agreed with frames and effects;
 * also for a selection of frames and mains together (the `mixed` context), and for no other
 * mixed selection.
 */
export const stylePanelSection: StylePanelSection = {
  id: 'auto-layout',
  title: 'Auto layout',
  context: ['frame', 'component', 'mixed'],
  order: 6,
  isSelectionOnly: true,
  isShownFor: (selection) => containersOf(selection).length === selection.length,
  summary: autoLayoutSummary,
  render: AutoLayoutSection,
};
