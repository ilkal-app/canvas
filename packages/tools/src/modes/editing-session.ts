import { ConnectorLabelMode } from '../connector/connector-label-mode.js';
import { ShapeMode } from '../shape/shape-mode.js';
import { StickyMode } from '../sticky/sticky-mode.js';
import { TextMode } from '../text/text-mode.js';
import type { TextEditingSession } from '../text/text-session.js';

import type { ToolMode } from './tool-mode.js';

/**
 * The text a tool mode is editing, if any: the session of the text tool's mode, of the sticky
 * tool's, of the shape tool's editing a label or of a connector's label
 * editing, which the app's hidden text
 * input, the style panel and the typing undo policy drive. Main thread.
 *
 * @param mode - The active mode, if any.
 * @returns Its editing session, or `undefined` when it edits no text now.
 */
export function editingSessionOf(mode: ToolMode | undefined): TextEditingSession | undefined {
  const isEditor =
    mode instanceof TextMode ||
    mode instanceof StickyMode ||
    mode instanceof ShapeMode ||
    mode instanceof ConnectorLabelMode;
  return isEditor ? mode.session : undefined;
}
