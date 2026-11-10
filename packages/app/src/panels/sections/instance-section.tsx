import type { ReactElement } from 'react';

import type { BoardReader } from '@canvas/document';
import {
  INSTANCE_SCALE_MAX,
  INSTANCE_SCALE_MIN,
  selectedValues,
  type InstanceObject,
  type ObjectId,
  type VariantAxis,
} from '@canvas/schema';

import type { ComponentListItem } from '../components/component-list.js';
import { useBoardMains } from '../components/use-component-list.js';
import controls from '../controls/controls.module.css';
import { NumberControl } from '../controls/number-control.js';
import { SelectControl } from '../controls/select-control.js';
import { instanceOverrideRows, type InstanceOverrideRow } from '../instance-override-rows.js';
import type { StylePanelSection, StylePanelSectionProps } from '../panel-sections.js';
import { containingMainsOf } from '../slot-swap-choices.js';

import styles from './component-sections.module.css';
import { InstanceOverrideRowItem, overrideRowName } from './instance-override-row.js';
import { SwapOptionsGroup } from './instance-swap-controls.js';
import { mainClosureOf, useBoardChanges } from './use-board-changes.js';

/** Props of {@link VariantPickers}. */
interface VariantPickersProps {
  /** The instance. */
  readonly instance: InstanceObject;
  /** Its main's axes. */
  readonly axes: readonly VariantAxis[];
  /** Dispatches the choice. */
  readonly dispatch: StylePanelSectionProps['dispatch'];
}

/**
 * An instance's variant pickers: one per axis of its main, showing the value it shows
 * (its choice, else the axis default), each change one `setInstanceVariant`. None without axes.
 *
 * @param props - The instance, its main's axes and the dispatch.
 * @returns The pickers, or null.
 */
function VariantPickers(props: VariantPickersProps): ReactElement | null {
  const { instance, axes, dispatch } = props;
  if (axes.length === 0) return null;
  return (
    <div className={styles.pickers}>
      {selectedValues(axes, instance.variant).map(([axis, value]) => (
        <SelectControl
          key={axis}
          label={axis}
          value={value}
          options={(axes.find(({ name }) => name === axis)?.values ?? []).map((option) => ({
            value: option,
            label: option,
          }))}
          onChange={(chosen) => {
            const variant = { [axis]: chosen };
            dispatch({ type: 'component', command: 'setVariant', id: instance.id, variant });
          }}
        />
      ))}
    </div>
  );
}

/**
 * What the instance section reads of the board for an instance, following the whole board's
 * changes to its main and the main's content (`mainClosureOf`): its rows, the mains containing
 * it, and, where a slot row offers mains or it is a slot inside a main listing its swap
 * options, the board's live mains, followed too (`useBoardMains`).
 *
 * @param props - The panel's props.
 * @param board - The whole board.
 * @param instance - The instance, if one is selected.
 * @returns The rows, the containing mains (outermost first) and the live mains.
 */
function useInstanceReading(
  props: StylePanelSectionProps,
  board: BoardReader,
  instance: InstanceObject | undefined,
): {
  readonly rows: readonly InstanceOverrideRow[];
  readonly containing: readonly ObjectId[];
  readonly mains: readonly ComponentListItem[];
} {
  // The main may be on another page, whose changes the panel's feed does not tell.
  useBoardChanges(props.watchDefinitions, board, mainClosureOf, instance?.mainId);
  const rows = instance === undefined ? [] : instanceOverrideRows(board, instance);
  const containing = instance === undefined ? [] : containingMainsOf(board, instance);
  const isSwapping = containing.length > 0 || rows.some(({ slot }) => slot !== undefined);
  const mains = useBoardMains(props.watchDefinitions, board, isSwapping);
  return { rows, containing, mains };
}

/** Props of {@link InstanceActions}. */
interface InstanceActionsProps {
  /** The instance. */
  readonly instance: InstanceObject;
  /** Dispatches the commands. */
  readonly dispatch: StylePanelSectionProps['dispatch'];
}

/**
 * "Detach" (the instance becomes a frame of plain objects, one undo step) and "Reset all"
 * (disabled while it overrides nothing of its own).
 *
 * @param props - The instance and the dispatch.
 * @returns The buttons.
 */
function InstanceActions(props: InstanceActionsProps): ReactElement {
  const { instance, dispatch } = props;
  const { id } = instance;
  return (
    <div className={styles.actions}>
      <button
        type="button"
        className={controls.button}
        onClick={() => {
          dispatch({ type: 'component', command: 'detach', id });
        }}
      >
        Detach
      </button>
      <button
        type="button"
        className={controls.button}
        disabled={Object.keys(instance.overrides).length === 0}
        onClick={() => {
          dispatch({ type: 'component', command: 'resetOverrides', id });
        }}
      >
        Reset all
      </button>
    </div>
  );
}

/** The content scale bounds as the Scale field shows them, percent. */
const SCALE_PERCENT = { min: INSTANCE_SCALE_MIN * 100, max: INSTANCE_SCALE_MAX * 100 } as const;

/**
 * "Scale": how much larger the instance draws its content than its main, in percent
 * (100 is the main's size, 5 to 2000), committed as one `resizeObjects` scale (one undo step; the
 * box grows with it), and "Reset scale" back to 100, shown only while it is scaled.
 *
 * @param props - The instance and the dispatch.
 * @returns The field and its reset.
 */
function ScaleField(props: InstanceActionsProps): ReactElement {
  const { instance, dispatch } = props;
  const { id } = instance;
  const scale = instance.scale ?? 1;
  return (
    <div className={styles.actions}>
      <NumberControl
        label="Scale"
        value={Math.round(scale * 10_000) / 100}
        min={SCALE_PERCENT.min}
        max={SCALE_PERCENT.max}
        onChange={(percent) => {
          dispatch({ type: 'component', command: 'setScale', id, scale: percent / 100 });
        }}
      />
      {scale !== 1 && (
        <button
          type="button"
          className={controls.button}
          aria-label="Reset scale"
          onClick={() => {
            dispatch({ type: 'component', command: 'setScale', id, scale: 1 });
          }}
        >
          Reset
        </button>
      )}
    </div>
  );
}

/**
 * The inspector's instance section (rulings 1, 5 and 8): the main's name with "Go to
 * main" (which shows the main's page, selects it and zooms to it), "Detach" (the instance
 * becomes a frame of plain objects, one undo step), "Reset all" (disabled without overrides),
 * then, for a main with variant axes, a picker per axis showing the value the instance shows
 * (its choice, else the axis default), then a row per overridable child of the main
 * (`InstanceOverrideRowItem`, each showing what its chosen presets set), nested instances'
 * children by their nested path, a nested instance's with its "Main" picker; for a
 * slot inside a main, its "Swap options" (`SwapOptionsGroup`) before the rows. It reads the
 * whole board, and follows its changes to the main and the main's content (`mainClosureOf`):
 * the main may be on another page; and, while it offers mains, the board's live mains
 * (`useBoardMains`): one created, renamed or retired anywhere. Its "Scale" (`ScaleField`)
 * draws the content larger or smaller, in percent.
 * For a person who cannot edit, or a locked instance, everything but "Go to main" is disabled.
 * For several instances it speaks of the first. The instance's size is the layout section's.
 *
 * @param props - The panel's props.
 * @returns The controls.
 */
function InstanceSection(props: StylePanelSectionProps): ReactElement | null {
  const { selection, dispatch, canEdit = true } = props;
  const found = selection.find((object) => object.type === 'instance');
  const instance = found?.type === 'instance' ? found : undefined;
  const board = props.definitions ?? props.board;
  const { rows, containing, mains } = useInstanceReading(props, board, instance);
  if (instance === undefined) return null;
  const main = board.get(instance.mainId);
  const { id } = instance;
  const isDisabled = !canEdit || instance.locked;
  const axes = main?.type === 'component' ? (main.variantAxes ?? []) : [];
  return (
    <div className={styles.body}>
      <div className={styles.main}>
        <span className={styles.mainName}>
          {main?.type === 'component' ? main.name : 'Main not found'}
        </span>
        <button
          type="button"
          className={controls.button}
          disabled={main?.type !== 'component'}
          onClick={() => {
            dispatch({ type: 'component', command: 'goToMain', id: instance.mainId });
          }}
        >
          Go to main
        </button>
      </div>
      <fieldset className={styles.editing} disabled={isDisabled}>
        <InstanceActions instance={instance} dispatch={dispatch} />
        <ScaleField instance={instance} dispatch={dispatch} />
        {containing.length > 0 && (
          <SwapOptionsGroup
            board={board}
            slot={instance}
            containing={containing}
            mains={mains}
            isDisabled={isDisabled}
            dispatch={dispatch}
          />
        )}
        <VariantPickers instance={instance} axes={axes} dispatch={dispatch} />
        <div className={styles.rows}>
          {rows.map((row) => (
            <InstanceOverrideRowItem
              key={row.path}
              board={board}
              instanceId={id}
              row={row}
              name={overrideRowName(row.source, board)}
              mains={mains}
              set={(path, override) => {
                dispatch({ type: 'component', command: 'setOverride', id, path, override });
              }}
              reset={(path, fields) => {
                dispatch({ type: 'component', command: 'resetOverrides', id, path, fields });
              }}
            />
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/**
 * The inspector's instance section: shown when only instances are selected; it
 * disables its own controls, so "Go to main" stays usable for a locked instance or a viewer.
 */
export const stylePanelSection: StylePanelSection = {
  id: 'instance',
  title: 'Instance',
  context: 'instance',
  order: 5,
  isSelectionOnly: true,
  hasOwnLockState: true,
  render: InstanceSection,
};
