import { useEffect, useState, type ReactElement } from 'react';

import type { BoardReader } from '@canvas/document';
import {
  MAX_VARIANT_AXES,
  MAX_VARIANT_VALUES,
  parsePresetKey,
  presetKey,
  type ComponentObject,
  type VariantAxis,
} from '@canvas/schema';

import type { ShellAction } from '../../state/shell-action.js';
import controls from '../controls/controls.module.css';
import { SelectControl } from '../controls/select-control.js';
import { TextFieldControl } from '../controls/text-field-control.js';
import { mainOverrideRows } from '../instance-override-rows.js';
import type { StylePanelSection, StylePanelSectionProps } from '../panel-sections.js';
import {
  addAxis,
  addValue,
  FIRST_AXES,
  isVariantName,
  makeDefault,
  removeAxis,
  removeValue,
  renameAxis,
  renameValue,
  type AxesEdit,
} from '../variant-axes-edits.js';

import styles from './component-sections.module.css';
import { InstanceOverrideRowItem, overrideRowName } from './instance-override-row.js';
import { mainAndInstancesOf, useBoardChanges } from './use-board-changes.js';

/** What "Edit preset" shows when no preset is being edited. */
const NO_PRESET = '';

/** Props of {@link AxisGroup}. */
interface AxisGroupProps {
  /** Every axis of the main. */
  readonly axes: readonly VariantAxis[];
  /** This axis's place. */
  readonly index: number;
  /** Stores an edit of the axes. */
  readonly edit: (edit: AxesEdit) => void;
}

/**
 * One axis of a main: its name, each value with "Make default" (all but the first) and
 * "Remove value" (not the last one left), "Add value" and "Remove axis". A name that is blank,
 * has `=` or is another's reverts and writes nothing.
 *
 * @param props - The axes, this axis's place and the edit.
 * @returns The group.
 */
function AxisGroup(props: AxisGroupProps): ReactElement | null {
  const { axes, index, edit } = props;
  const axis = axes[index];
  if (axis === undefined) return null;
  const otherAxes = axes.filter((each, at) => at !== index).map(({ name }) => name);
  return (
    <div role="group" aria-label={axis.name} className={styles.axis}>
      <TextFieldControl
        label="Name"
        value={axis.name}
        accepts={(name) => isVariantName(name, otherAxes)}
        onCommit={(name) => {
          edit(renameAxis(axes, index, name));
        }}
      />
      {axis.values.map((value, at) => (
        <div key={value} className={styles.variantValue}>
          <TextFieldControl
            label="Value"
            value={value}
            accepts={(name) =>
              isVariantName(
                name,
                axis.values.filter((each) => each !== value),
              )
            }
            onCommit={(name) => {
              edit(renameValue(axes, index, value, name));
            }}
          />
          <div className={styles.variantActions}>
            {at > 0 && (
              <button
                type="button"
                className={controls.toggle}
                onClick={() => {
                  edit(makeDefault(axes, index, value));
                }}
              >
                Make default
              </button>
            )}
            <button
              type="button"
              className={controls.toggle}
              disabled={axis.values.length === 1}
              onClick={() => {
                edit(removeValue(axes, index, value));
              }}
            >
              Remove value
            </button>
          </div>
        </div>
      ))}
      <div className={styles.actions}>
        <button
          type="button"
          className={controls.button}
          disabled={axis.values.length >= MAX_VARIANT_VALUES}
          onClick={() => {
            edit(addValue(axes, index));
          }}
        >
          Add value
        </button>
        <button
          type="button"
          className={controls.button}
          onClick={() => {
            edit(removeAxis(axes, index));
          }}
        >
          Remove axis
        </button>
      </div>
    </div>
  );
}

/** Props of {@link PresetEditor}. */
interface PresetEditorProps {
  /** The whole board. */
  readonly board: BoardReader;
  /** The main. */
  readonly main: ComponentObject;
  /** Dispatches the preset commands and the preview. */
  readonly dispatch: (action: ShellAction) => void;
}

/**
 * "Edit preset": choosing an axis value shows the main's rows against that value's preset,
 * whose edits and resets write the preset, and previews the main in it on the canvas until
 * `None` is chosen or the main is no longer shown here.
 *
 * @param props - The board, the main and the dispatch.
 * @returns The picker and the rows.
 */
function PresetEditor(props: PresetEditorProps): ReactElement {
  const { board, main, dispatch } = props;
  const [chosen, setChosen] = useState(NO_PRESET);
  const keys = (main.variantAxes ?? []).flatMap(({ name, values }) =>
    values.map((value) => presetKey(name, value)),
  );
  const selected = keys.includes(chosen) ? parsePresetKey(chosen) : undefined;
  const records = selected === undefined ? undefined : main.variantPresets?.[chosen];
  // The preview follows the preset's records, so an edit made here shows at once.
  const shown = JSON.stringify(records ?? null);
  const axis = selected?.axis;
  const value = selected?.value;
  useEffect(() => {
    if (axis === undefined || value === undefined) return undefined;
    dispatch({ type: 'component', command: 'previewPreset', id: main.id, axis, value });
    return () => {
      dispatch({ type: 'component', command: 'previewPreset', id: main.id });
    };
  }, [dispatch, main.id, axis, value, shown]);
  const rows = selected === undefined ? [] : mainOverrideRows(board, main.id, records ?? {});
  return (
    <>
      <SelectControl
        label="Edit preset"
        value={selected === undefined ? NO_PRESET : chosen}
        options={[
          { value: NO_PRESET, label: 'None' },
          ...keys.map((key) => ({ value: key, label: key })),
        ]}
        onChange={setChosen}
      />
      {selected !== undefined && (
        <div className={styles.rows}>
          {rows.map((row) => (
            <InstanceOverrideRowItem
              key={row.path}
              board={board}
              row={row}
              name={overrideRowName(row.source, board)}
              set={(path, override) => {
                dispatch({
                  type: 'component',
                  command: 'setPreset',
                  id: main.id,
                  ...selected,
                  path,
                  override,
                });
              }}
              reset={(path, fields) => {
                dispatch({
                  type: 'component',
                  command: 'resetPreset',
                  id: main.id,
                  ...selected,
                  path,
                  fields,
                });
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * The inspector's Variants section for a main: "Add variants" for a main without
 * axes; otherwise each axis (`AxisGroup`), "Add axis", and "Edit preset" (`PresetEditor`). Each
 * axis edit is one `setVariantAxes` with the whole new list, renames carrying presets and
 * instances' choices; each preset edit one `setVariantPreset` or `resetVariantPreset`. The panel
 * disables it for a person who cannot edit and for a locked main.
 *
 * @param props - The panel's props.
 * @returns The controls.
 */
function VariantsSection(props: StylePanelSectionProps): ReactElement | null {
  const { selection, dispatch } = props;
  const main = selection.find((object) => object.type === 'component');
  const board = props.definitions ?? props.board;
  const mainId = main?.type === 'component' ? main.id : undefined;
  useBoardChanges(props.watchDefinitions, board, mainAndInstancesOf, mainId);
  if (main?.type !== 'component') return null;
  const axes = main.variantAxes ?? [];
  const edit = ({ axes: next, renames }: AxesEdit): void => {
    dispatch({
      type: 'component',
      command: 'setVariantAxes',
      id: main.id,
      axes: next.length === 0 ? null : next,
      ...(renames === undefined ? {} : { renames }),
    });
  };
  if (axes.length === 0) {
    return (
      <div className={styles.body}>
        <button
          type="button"
          className={controls.button}
          onClick={() => {
            edit({ axes: FIRST_AXES.map(({ name, values }) => ({ name, values: [...values] })) });
          }}
        >
          Add variants
        </button>
      </div>
    );
  }
  return (
    <div className={styles.body}>
      {axes.map((axis, index) => (
        <AxisGroup key={axis.name} axes={axes} index={index} edit={edit} />
      ))}
      <button
        type="button"
        className={controls.button}
        disabled={axes.length >= MAX_VARIANT_AXES}
        onClick={() => {
          edit(addAxis(axes));
        }}
      >
        Add axis
      </button>
      <PresetEditor key={main.id} board={board} main={main} dispatch={dispatch} />
    </div>
  );
}

/** The inspector's Variants section: shown when only mains are selected. */
export const stylePanelSection: StylePanelSection = {
  id: 'variants',
  title: 'Variants',
  context: 'component',
  order: 7,
  isSelectionOnly: true,
  render: VariantsSection,
};
