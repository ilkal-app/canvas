import type { ColorTokenAction } from './color-token-action.js';
import type { ReplaceMissingFontAction } from './font-actions.js';

/**
 * The canvas actions that change the board's styles as a whole: its colour tokens and
 * the board-wide replacement of a missing font.
 */
export type BoardStyleAction = ColorTokenAction | ReplaceMissingFontAction;
