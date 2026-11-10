import type { ReactElement } from 'react';

import { MIXED, type Mixable } from '../panels/controls/mixed-value.js';

import { CompactDropdown, type CompactDropdownOption } from './compact-dropdown.js';
import { CustomNumberFooter } from './custom-number-footer.js';

/** The font size menu's presets (frame A): each one's name and size, px. */
export const FONT_SIZE_PRESETS: readonly { readonly label: string; readonly size: number }[] = [
  { label: 'Small', size: 12 },
  { label: 'Medium', size: 16 },
  { label: 'Large', size: 24 },
  { label: 'Extra large', size: 32 },
];

/** The smallest size the Custom field takes, px. */
export const CUSTOM_FONT_SIZE_MIN = 8;

/** The largest size the Custom field takes, px. */
export const CUSTOM_FONT_SIZE_MAX = 400;

/** The trigger's width, px (frame A's size dropdown). */
const TRIGGER_WIDTH_PX = 52;

/** Props of {@link FontSizeDropdown}. */
export interface FontSizeDropdownProps {
  /** The size the selection shares, px, or mixed. */
  readonly value: Mixable<number>;
  /** Receives a size chosen, px, only when it differs. */
  readonly onChange: (size: number) => void;
  /** Whether it is disabled. */
  readonly isDisabled?: boolean | undefined;
}

/**
 * The font size dropdown (frame A): the size, or "Mixed", on a 52 px trigger; its
 * menu holds Small 12, Medium 16, Large 24 and Extra large 32 with a check by the current one,
 * then a rule and a Custom field for any whole size from 8 to 400 px.
 *
 * @param props - The size and the handler.
 * @returns The dropdown.
 */
export function FontSizeDropdown(props: FontSizeDropdownProps): ReactElement {
  const { value } = props;
  const isMixed = value === MIXED;
  const options: CompactDropdownOption<string>[] = FONT_SIZE_PRESETS.map((preset) => ({
    value: String(preset.size),
    label: preset.label,
    meta: String(preset.size),
    triggerLabel: String(preset.size),
  }));
  const shown = isMixed ? '' : String(value);
  // A size that is no preset still shows on the trigger, with nothing checked.
  const withCurrent = options.some((option) => option.value === shown)
    ? options
    : [...options, { value: shown, label: shown, triggerLabel: shown, isHidden: true }];
  return (
    <CompactDropdown
      label="Font size"
      value={shown}
      options={withCurrent}
      isMixed={isMixed}
      width={TRIGGER_WIDTH_PX}
      isDisabled={props.isDisabled}
      onChange={(size) => {
        props.onChange(Number(size));
      }}
      footer={(close) => (
        <CustomNumberFooter
          value={value}
          min={CUSTOM_FONT_SIZE_MIN}
          max={CUSTOM_FONT_SIZE_MAX}
          fieldLabel="Custom font size"
          groupLabel="Custom size"
          onCommit={props.onChange}
          close={close}
        />
      )}
    />
  );
}
