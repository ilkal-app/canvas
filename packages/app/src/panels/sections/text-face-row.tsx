// The text section's Face select: a named face of the shared family, as local fonts
// install them (a condensed or display face), or Regular for the family's plain faces.
import { useSyncExternalStore, type ReactElement } from 'react';

import type { TextStyleChange, TextStyleContext } from '../../engine/document-text.js';
import { faceLabel } from '../../text-input/face-label.js';
import { pageNamedFaces, subscribePageFonts } from '../../text-input/page-fonts.js';
import { MIXED, type Mixable } from '../controls/mixed-value.js';
import { SelectControl, type SelectOption } from '../controls/select-control.js';

/** The value of the choice that removes the face name: the family's plain faces. */
const REGULAR = 'regular';

/** Props of {@link FaceRow}. */
export interface FaceRowProps {
  /** What the section shows. */
  readonly context: TextStyleContext;
  /** Applies a change to the targeted text. */
  readonly onChange: (change: TextStyleChange) => void;
}

/**
 * The face the targeted text shares: its name, Regular for none, or mixed when the runs differ
 * (the shared style leaves `postScriptName` out).
 *
 * @param context - The section's context.
 * @returns The select's value.
 */
function shownFace(context: TextStyleContext): Mixable<string> {
  const { style } = context;
  if (!('postScriptName' in style)) return MIXED;
  return style.postScriptName ?? REGULAR;
}

/**
 * The Face select: Regular, which removes the face name, or one of the shared family's
 * installed named faces; a shared face the page has not installed is shown as itself. Nothing
 * for a mixed family, or for a family with no named face when the text names none. It follows
 * the page's fonts, so a family whose faces install later gains the row.
 *
 * @param props - The context and the change callback.
 * @returns The select, or nothing.
 */
export function FaceRow(props: FaceRowProps): ReactElement | null {
  const { context, onChange } = props;
  const family = context.style.fontFamily;
  const names = useSyncExternalStore(subscribePageFonts, () =>
    family === undefined ? '' : pageNamedFaces(family).join('\n'),
  );
  if (family === undefined) return null;
  const value = shownFace(context);
  const installed = names === '' ? [] : names.split('\n');
  if (installed.length === 0 && value === REGULAR) return null;
  const faces =
    value === MIXED || value === REGULAR || installed.includes(value)
      ? installed
      : [...installed, value];
  const options: readonly SelectOption[] = [
    { value: REGULAR, label: 'Regular' },
    ...faces.map((name) => ({ value: name, label: faceLabel(name) })),
  ];
  return (
    <SelectControl
      label="Face"
      value={value}
      options={options}
      // While editing, a pointer choice returns the keyboard to the editor, as the font field does.
      shouldReleaseFocus={context.isEditing}
      onChange={(choice) => {
        onChange({ kind: 'style', patch: { postScriptName: choice === REGULAR ? null : choice } });
      }}
    />
  );
}
