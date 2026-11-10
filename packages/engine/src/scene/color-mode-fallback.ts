import {
  frameFillModeOf,
  type ColorMode,
  type ColorModeFallback,
  type Paint,
} from '@canvas/schema';

import type { ColorTokenValues, InkColors } from '../paint/color-palette.js';

// The colour mode fallbacks a scene can be given (where no ancestor sets a mode): a function,
// for a renderer built on its own thread, or a built-in by name, which crosses to the engine
// worker as plain data (`EngineHostOptions.colorModeFallback`). The one built-in is's
// frame-fill rule, `frameFillModeOf` of `@canvas/schema`: the nearest filled frame's luminance.

/** The frame-fill rule's name: ink and tokens follow the nearest filled frame. */
export const FRAME_FILL_LUMINANCE = 'frame-fill-luminance';

/** A built-in fallback, by name: plain data a host can send to its worker. */
export type ColorModeFallbackName = typeof FRAME_FILL_LUMINANCE;

/** A scene's fallback: a hook of its own thread, or a built-in by name. */
export type ColorModeFallbackOption = ColorModeFallback | ColorModeFallbackName;

/**
 * What an object's frame-fill mode depends on beyond its ancestors, kept so a theme switch or a
 * token edit can work it out again without reading the document: the fills behind it, nearest
 * first, when one of them is a token.
 */
export interface FrameFillBackdrop {
  /** The ancestors' fills, nearest first (null for none). */
  readonly fills: readonly (Paint | null)[];
  /** Whether a token fill was resolved in the viewer's theme. */
  readonly didReadViewerTheme: boolean;
  /** The tokens the fills name. */
  readonly tokens: ReadonlySet<string>;
}

/** An object's fallback mode, and what it depends on when that is more than its ancestors. */
export interface FallbackMode {
  /** The mode; undefined for the viewer's theme. */
  readonly mode: ColorMode | undefined;
  /** Present when the mode read a token: the theme or a token edit may change it. */
  readonly backdrop?: FrameFillBackdrop;
}

/**
 * Tells whether a scene's fallback option names the frame-fill rule. Anything else that is not a
 * function (a host's unknown name) is no fallback.
 *
 * @param option - The option.
 * @returns True for {@link FRAME_FILL_LUMINANCE}.
 */
export function isFrameFillFallback(option: unknown): option is ColorModeFallbackName {
  return option === FRAME_FILL_LUMINANCE;
}

/**
 * The frame-fill rule over the fills behind an object (`frameFillModeOf`), with the backdrop kept
 * when the mode read a token.
 *
 * @param fills - The ancestors' fills, nearest first.
 * @param viewerTheme - The viewer's theme.
 * @param tokens - The board's token values.
 * @param inkColors - What ink draws as per mode where the board has not edited it: the scene's,
 *   so a fill naming the ink token is judged in the colour it is drawn in.
 * @returns The mode and its backdrop.
 */
export function frameFillFallbackMode(
  fills: readonly (Paint | null)[],
  viewerTheme: ColorMode,
  tokens: ColorTokenValues,
  inkColors: InkColors,
): FallbackMode {
  const found = frameFillModeOf(fills, { viewerTheme, tokens, inkColors });
  if (found.tokens.length === 0) return { mode: found.mode };
  return {
    mode: found.mode,
    backdrop: {
      fills,
      didReadViewerTheme: found.didReadViewerTheme,
      tokens: new Set(found.tokens),
    },
  };
}
