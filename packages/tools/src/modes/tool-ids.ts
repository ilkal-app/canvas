/**
 * The interaction modes of the dock, in the order the shell lists them:
 * the select tool, the hand (which pans on the primary button), then the creation tools.
 */
export const TOOL_IDS = [
  'select',
  'hand',
  'text',
  'sticky',
  'pen',
  'draw',
  'shape',
  'line',
  'connector',
  'image',
  'frame',
] as const;

/** The id of one interaction mode: one of {@link TOOL_IDS}. */
export type ToolId = (typeof TOOL_IDS)[number];

/**
 * Tells whether a string names an interaction mode, for example a tool id restored from saved
 * preferences.
 *
 * @param value - The string to check.
 * @returns `true` when `value` is one of {@link TOOL_IDS}.
 */
export function isToolId(value: string): value is ToolId {
  return (TOOL_IDS as readonly string[]).includes(value);
}
