// The board modes: which kind of work a board is for. They stay in the schema, which
// the SDK ships, while the flags that gate them live with the private plans.

/**
 * The six board modes: which kind of work a board is for. The boards service's
 * `boards_mode` check holds the same list; the MCP server's `create_board` offers those a set has
 * on (`enabledModes`, `@canvas/plans`).
 */
export const BOARD_MODES = [
  'whiteboard',
  'uiux',
  'diagram',
  'illustration',
  'motion',
  'slides',
] as const;

/** One of {@link BOARD_MODES}. */
export type BoardMode = (typeof BOARD_MODES)[number];
