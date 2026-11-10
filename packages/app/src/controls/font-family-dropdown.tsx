import { useCallback, useMemo, useState, type ReactElement } from 'react';

import { MIXED, type Mixable } from '../panels/controls/mixed-value.js';
import { prepareFontPreview } from '../text-input/font-preview.js';
import { loadLocalFont } from '../text-input/local-fonts.js';
import {
  useLocalFontFamilies,
  type LocalFontFamilies,
} from '../text-input/use-local-font-families.js';

import { CompactDropdown, type CompactDropdownOption } from './compact-dropdown.js';
import type { MenuEntry } from './menu.js';

/** The trigger's least width, px (frame A's font dropdown). */
const TRIGGER_WIDTH_PX = 80;

/**
 * The most the trigger grows to show a long family whole, px ("Liberation Serif" was
 * cut at 80): beyond it the name ellipsizes, and the popover's row stays clear of the viewport.
 */
const TRIGGER_MAX_WIDTH_PX = 160;

/** The most the family list takes before it scrolls, px: ten rows. */
const LIST_MAX_HEIGHT_PX = 300;

/** The row under the families for each state of the fonts on this computer, but `granted`. */
const LOCAL_ROWS: Readonly<
  Record<Exclude<LocalFontFamilies['status'], 'granted'>, { readonly label: string }>
> = {
  prompt: { label: 'Show fonts on this computer…' },
  reading: { label: 'Reading fonts on this computer…' },
  denied: { label: "Fonts on this computer are blocked in this site's settings" },
  unsupported: { label: 'Fonts on this computer need Chrome or Edge on a computer' },
};

/**
 * The style that writes a family's name in its own face, the UI face until that has loaded.
 *
 * @param family - The family.
 * @returns The style.
 */
function previewStyle(family: string): { readonly fontFamily: string } {
  return { fontFamily: `${JSON.stringify(`Canvas preview ${family}`)}, var(--font-ui)` };
}

/**
 * The style that writes a local family's name in its own face: the browser draws the
 * installed font by name, so the row reads no font file; the UI face where it cannot.
 *
 * @param family - The family, installed on this computer.
 * @returns The style.
 */
function localStyle(family: string): { readonly fontFamily: string } {
  return { fontFamily: `${JSON.stringify(family)}, var(--font-ui)` };
}

/**
 * The menu's rows for the fonts on this computer: their families after a rule, each
 * written in the installed font and disabled once it would not load when chosen (a row
 * shown reads nothing, so scrolling never queues files ahead of the choice); or, before that, one
 * row for where things stand: the press that asks (`prompt`), or a note.
 *
 * @param local - The fonts on this computer.
 * @param library - The library's families, which a local family of the same name does not repeat.
 * @param failed - The local families that would not load.
 * @param request - Asks for the fonts on this computer.
 * @returns Their options and the row after them.
 */
function localRows(
  local: LocalFontFamilies,
  library: readonly string[],
  failed: ReadonlySet<string>,
  request: () => void,
): { readonly options: CompactDropdownOption<string>[]; readonly extra: MenuEntry[] } {
  if (local.status !== 'granted') {
    const row = LOCAL_ROWS[local.status];
    const isAsk = local.status === 'prompt';
    return {
      options: [],
      extra: [
        {
          kind: 'item',
          id: 'local fonts',
          label: row.label,
          isDisabled: !isAsk,
          onSelect: isAsk ? request : undefined,
        },
      ],
    };
  }
  const options = local.families
    .filter((family) => !library.includes(family))
    .map((family, index) => ({
      value: family,
      label: family,
      meta: failed.has(family) ? 'Unavailable' : undefined,
      isDisabled: failed.has(family),
      isGroupStart: index === 0,
      labelStyle: localStyle(family),
    }));
  return { options, extra: [] };
}

/** Props of {@link FontFamilyDropdown}. */
export interface FontFamilyDropdownProps {
  /** The family the selection shares, or mixed. */
  readonly value: Mixable<string>;
  /** The families to offer, in order. */
  readonly families: readonly string[];
  /** Receives a family chosen, only when it differs. */
  readonly onChange: (family: string) => void;
  /** Whether it is disabled. */
  readonly isDisabled?: boolean | undefined;
}

/**
 * The font family dropdown (frame A): the family, or "Mixed", on a trigger as wide as
 * the name between 80 and 160 px; its menu lists the families, each written in its own
 * face (loaded as its row scrolls into view, the UI face until then), with a check by the
 * current one, then the fonts on this computer (`useLocalFontFamilies`): their families
 * once the browser lets the page read them, else the row that asks or says why not. A local
 * family is loaded before it is chosen; its file stays on this computer.
 *
 * @param props - The family, the families and the handler.
 * @returns The dropdown.
 */
export function FontFamilyDropdown(props: FontFamilyDropdownProps): ReactElement {
  const { value, families, onChange } = props;
  const isMixed = value === MIXED;
  const shown = isMixed ? '' : value;
  const { local, request } = useLocalFontFamilies();
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const markFailed = useCallback((family: string): void => {
    setFailed((was) => (was.has(family) ? was : new Set([...was, family])));
  }, []);
  // Built once per list, so each row's observer is not torn down on every render.
  const options = useMemo(
    (): CompactDropdownOption<string>[] =>
      families.map((family) => ({
        value: family,
        label: family,
        labelStyle: previewStyle(family),
        onVisible: () => {
          void prepareFontPreview(family);
        },
      })),
    [families],
  );
  // Built once per state, so each row's observer is not torn down on every render.
  const rows = useMemo(
    () => localRows(local, families, failed, request),
    [local, families, failed, request],
  );
  const offered = [...options, ...rows.options];
  // A family not offered (a local font not listed here) still shows on the trigger, unchecked.
  const withCurrent =
    isMixed || offered.some((option) => option.value === shown)
      ? offered
      : [...offered, { value: shown, label: shown, isHidden: true }];
  const choose = (family: string): void => {
    if (families.includes(family)) {
      onChange(family);
      return;
    }
    // A local family draws once its faces are installed; one that will not load is not chosen.
    void loadLocalFont(family).then(
      () => {
        onChange(family);
      },
      () => {
        markFailed(family);
      },
    );
  };
  return (
    <CompactDropdown
      label="Font"
      value={shown}
      options={withCurrent}
      isMixed={isMixed}
      width={TRIGGER_WIDTH_PX}
      maxWidth={TRIGGER_MAX_WIDTH_PX}
      maxListHeight={LIST_MAX_HEIGHT_PX}
      extraEntries={rows.extra}
      isDisabled={props.isDisabled}
      onChange={choose}
    />
  );
}
