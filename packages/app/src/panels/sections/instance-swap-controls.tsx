import type { ReactElement } from 'react';

import type { BoardReader } from '@canvas/document';
import type { InstanceObject, ObjectId, OverrideRecord } from '@canvas/schema';

import type { ComponentAction } from '../../state/shell-action.js';
import type { ComponentListItem } from '../components/component-list.js';
import { SelectControl } from '../controls/select-control.js';
import type { SlotPlacement } from '../instance-override-rows.js';
import { MAX_SWAP_OPTIONS, slotSwapChoices, swapOptionChoices } from '../slot-swap-choices.js';

import styles from './component-sections.module.css';
import { ResetField } from './reset-field.js';

/** Props of {@link SlotMainPicker}. */
export interface SlotMainPickerProps {
  /** The whole board. */
  readonly board: BoardReader;
  /** The slot, the main it shows, its stored main and the mains above it. */
  readonly placement: SlotPlacement;
  /** The instance's record at the slot's path, if any. */
  readonly override: OverrideRecord | undefined;
  /** What the chosen variant's presets set at the slot's path, under the record. */
  readonly preset?: OverrideRecord | undefined;
  /** The board's live mains. */
  readonly mains: readonly ComponentListItem[];
  /** Merges fields into the record. */
  readonly set: (record: OverrideRecord) => void;
  /** Clears the given fields of the record. */
  readonly reset: (cleared: readonly (keyof OverrideRecord)[]) => () => void;
}

/**
 * A slot row's "Main": a native select of the mains the slot may show
 * (`slotSwapChoices`), on the one it shows. Choosing another stores a `mainId` override, one
 * `setInstanceOverride`; choosing the stored main clears it, as "Reset main" does, shown while
 * the instance's record swaps the slot (`resetInstanceOverrides` of `mainId` alone). Where a
 * chosen variant's preset swaps the slot, that main shows "From variant" and is what
 * clearing goes back to; choosing the stored main then stores it as the record's own `mainId`.
 *
 * @param props - The board, the slot, its record, the mains and how to set and reset fields.
 * @returns The field.
 */
export function SlotMainPicker(props: SlotMainPickerProps): ReactElement {
  const { placement, set, reset } = props;
  const choices = slotSwapChoices(props.board, placement, props.mains);
  // The main the slot shows with no own `mainId`: a preset's swap, else the stored main.
  const fallback = props.preset?.mainId ?? placement.storedMainId;
  return (
    <ResetField
      label="main"
      isOverridden={props.override?.mainId !== undefined}
      isFromVariant={props.preset?.mainId !== undefined}
      onReset={reset(['mainId'])}
    >
      <SelectControl
        label="Main"
        value={placement.instance.mainId}
        options={choices.map(({ id, name }) => ({ value: id, label: name }))}
        onChange={(value) => {
          if (value === fallback) reset(['mainId'])();
          else set({ mainId: value as ObjectId });
        }}
      />
    </ResetField>
  );
}

/** Props of {@link SwapOptionsGroup}. */
export interface SwapOptionsGroupProps {
  /** The whole board. */
  readonly board: BoardReader;
  /** The slot, an instance inside a main. */
  readonly slot: InstanceObject;
  /** The mains containing it, outermost first. */
  readonly containing: readonly ObjectId[];
  /** The board's live mains. */
  readonly mains: readonly ComponentListItem[];
  /** Whether it is disabled, as the section's editing controls are (a viewer, a locked slot). */
  readonly isDisabled: boolean;
  /** Dispatches its component actions. */
  readonly dispatch: (action: ComponentAction) => void;
}

/**
 * A slot's "Swap options" in its main: "Any main", checked while the slot lists none,
 * then a checkbox per main it may list (`swapOptionChoices`). Checking or clearing one writes
 * the checked mains in the list's order, one `setSwapOptions`; clearing the last, or checking
 * "Any main", clears the list. Once `MAX_SWAP_OPTIONS` are checked, the others are disabled.
 *
 * @param props - The board, the slot, its mains and the dispatch.
 * @returns The group.
 */
export function SwapOptionsGroup(props: SwapOptionsGroupProps): ReactElement {
  const { slot, dispatch } = props;
  const choices = swapOptionChoices(props.board, slot, props.containing, props.mains);
  const checked = new Set(slot.swapOptions);
  const setOptions = (options: readonly ObjectId[] | null): void => {
    dispatch({ type: 'component', command: 'setSwapOptions', id: slot.id, options });
  };
  const toggle = (id: ObjectId, isChecked: boolean): void => {
    const next = choices
      .map((choice) => choice.id)
      .filter((choiceId) => (choiceId === id ? isChecked : checked.has(choiceId)));
    setOptions(next.length === 0 ? null : next);
  };
  const isFull = checked.size >= MAX_SWAP_OPTIONS;
  return (
    <fieldset className={styles.swapOptions} disabled={props.isDisabled}>
      <legend className={styles.caption}>Swap options</legend>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={slot.swapOptions === undefined}
          onChange={(event) => {
            if (event.currentTarget.checked) setOptions(null);
          }}
        />
        Any main
      </label>
      {choices.map(({ id, name }) => (
        <label key={id} className={styles.check}>
          <input
            type="checkbox"
            checked={checked.has(id)}
            disabled={isFull && !checked.has(id)}
            onChange={(event) => {
              toggle(id, event.currentTarget.checked);
            }}
          />
          {name}
        </label>
      ))}
    </fieldset>
  );
}
