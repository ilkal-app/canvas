import type { FontVariationAxes, TextStyle } from '@canvas/schema';

/**
 * Some fields of a text style: what a style control sets (a family, a size, bold) and what a
 * range has in common (`commonStyle`: a missing field is mixed). A language set to `null`
 * removes the run's tag; one shared as `undefined` is no tag. A face name set to `null`
 * removes it, and a new family without one drops the old family's face. Feature settings
 * set to `null` remove the run's, and a link set to `null` removes it.
 */
export type TextStylePatch = Partial<
  Omit<TextStyle, 'lang' | 'postScriptName' | 'fontFeatures' | 'link'>
> & {
  /**
   * Some axes of each run's variable-font coordinates to change: a value sets the tag,
   * `null` removes it, and each run keeps its other axes. `fontVariations`, the whole record,
   * wins when both are given.
   */
  readonly fontVariationsAxes?: FontVariationAxes | undefined;
  /** The language, a BCP 47 tag; `null` removes it. */
  readonly lang?: string | null | undefined;
  /** The face's PostScript name; `null` removes it. */
  readonly postScriptName?: string | null | undefined;
  /** The OpenType feature settings, the whole record; `null` removes them. */
  readonly fontFeatures?: TextStyle['fontFeatures'] | null | undefined;
  /** The run's link; `null` removes it. */
  readonly link?: string | null | undefined;
};
