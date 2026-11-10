import type { DocumentStore } from '@canvas/document';
import {
  INK,
  isTokenRef,
  type InkableColor,
  type InkTheme,
  type Point,
  type Rgba,
} from '@canvas/schema';

import type { ToolId } from '../modes/tool-ids.js';
import type { OverlayPalette } from '../select/overlay-palette.js';

import { chooseDefaultInk } from './default-ink.js';
import type { AverageColorOf } from './under-point.js';

// The creation tools' side of the default-colour rule. A tool's
// style holds `ink` until the person picks a colour for it (the tools' and the shell's defaults
// are `ink`), so a colour tuple in the style is the person's choice and is used as is, and `ink`
// in the style asks the rule: `ink` on an empty canvas, a fixed contrasting colour over an
// object, decided once, where the creation starts. `ink` the person picked themselves (the Ink
// swatch, `CreationInkSource.isInkPicked`) is their choice too, and is stored as is.

/** What the shell tells the creation tools about the creator, for the default colour. */
export interface CreationInkSource {
  /** The creator's theme now. */
  readonly theme: () => InkTheme;
  /** An image asset's average colour, or null while it is pending. */
  readonly averageColorOf?: AverageColorOf;
  /** The theme's canvas colour; the tools' defaults when absent. */
  readonly canvasColor?: (theme: InkTheme) => Rgba;
  /**
   * Whether the `ink` in a tool's style is the person's own pick (the Ink swatch of its stroke,
   * or of the text tool's colour) rather than the tool's default; never when absent.
   */
  readonly isInkPicked?: (tool: ToolId) => boolean;
  /**
   * The editing states' colours for the viewer's theme now: the text being edited is
   * outlined and highlighted in its `you`; the classic selection blue when absent.
   */
  readonly overlayPalette?: () => OverlayPalette;
}

/**
 * The stroke or text colour a new object takes: the style's colour when the person picked one (a
 * tuple, or `ink` they picked for the tool, `isInkPicked`), else the default-colour rule at the
 * point where the creation starts.
 *
 * @param store - The document: its objects are what lies under the point.
 * @param point - Where the creation starts, world units.
 * @param styleColor - The tool's style colour.
 * @param source - The creator's theme and image colours; the light theme when absent.
 * @param tool - The creating tool, whose picked `ink` is kept; `ink` is the default when absent.
 * @returns The colour to store.
 */
export function creationColor(
  store: DocumentStore,
  point: Point,
  styleColor: InkableColor,
  source?: CreationInkSource,
  tool?: ToolId,
): InkableColor {
  if (styleColor !== INK) return styleColor;
  const isPicked = tool !== undefined && source?.isInkPicked?.(tool) === true;
  const theme = source?.theme() ?? 'light';
  const canvasColor = source?.canvasColor?.(theme);
  return chooseDefaultInk({
    point,
    objects: [...store.read().objects.values()],
    theme,
    tokens: store.readTokens(),
    ...(isPicked ? { explicitColor: INK } : {}),
    ...(source?.averageColorOf === undefined ? {} : { averageColorOf: source.averageColorOf }),
    ...(canvasColor === undefined ? {} : { canvasColor }),
  });
}

/**
 * Copies a colour that may be `ink`, so a stored value shares nothing with a style.
 *
 * @param color - The colour.
 * @returns The copy.
 */
export function copyInkableColor(color: InkableColor): InkableColor {
  if (color === INK) return INK;
  return isTokenRef(color) ? { token: color.token } : [...color];
}
