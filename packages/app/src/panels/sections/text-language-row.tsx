// The text section's Language select: the run's BCP 47 tag, which picks the face for
// Han characters (Japanese, Chinese or Korean forms) and tells the shaper the language.
import type { ReactElement } from 'react';

import type { TextStyleChange, TextStyleContext } from '../../engine/document-text.js';
import { MIXED, type Mixable } from '../controls/mixed-value.js';
import { SelectControl, type SelectOption } from '../controls/select-control.js';

/** The value of the choice that removes the tag. */
const AUTO = 'auto';

/** The choices: no tag, then languages by their own names. */
const LANGUAGES: readonly SelectOption[] = [
  { value: AUTO, label: 'Auto' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'zh-Hans', label: '简体中文' },
  { value: 'zh-Hant', label: '繁體中文' },
  { value: 'ko', label: '한국어' },
];

/** Props of {@link LanguageRow}. */
export interface LanguageRowProps {
  /** What the section shows. */
  readonly context: TextStyleContext;
  /** Applies a change to the targeted text. */
  readonly onChange: (change: TextStyleChange) => void;
}

/**
 * The language the targeted text shares: its tag, Auto for none, or mixed when the runs differ
 * (the shared style leaves `lang` out).
 *
 * @param context - The section's context.
 * @returns The select's value.
 */
function shownLanguage(context: TextStyleContext): Mixable<string> {
  const { style } = context;
  if (!('lang' in style)) return MIXED;
  const lang = style.lang as Mixable<string> | null | undefined;
  if (lang === MIXED) return MIXED;
  return lang ?? AUTO;
}

/**
 * The Language select: Auto, which removes the tag, or a language; a tag the list
 * lacks is shown as itself.
 *
 * @param props - The context and the change callback.
 * @returns The select.
 */
export function LanguageRow(props: LanguageRowProps): ReactElement {
  const { context, onChange } = props;
  const value = shownLanguage(context);
  const isListed = value === MIXED || LANGUAGES.some((option) => option.value === value);
  const options = isListed ? LANGUAGES : [...LANGUAGES, { value, label: value }];
  return (
    <SelectControl
      label="Language"
      value={value}
      options={options}
      onChange={(choice) => {
        onChange({ kind: 'style', patch: { lang: choice === AUTO ? null : choice } });
      }}
    />
  );
}
