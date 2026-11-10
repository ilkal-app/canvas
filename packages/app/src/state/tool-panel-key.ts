import type { ToolPanelId } from './tool-panel-state.js';

/**
 * A key a tool panel takes while its tool is active: the Draw panel's `cycle` (P, the
 * next drawing sub-tool) and `eraser` (E and Shift+E). The panel says what each does to its
 * choices (`ToolPanelContribution.onKey`).
 */
export type ToolPanelKey = 'cycle' | 'eraser';

/**
 * A tool panel's key pressed under the floating chrome. While the panel's tool is
 * active the reducer records it (`ShellState.lastToolPanelKey`) and the floating dock changes
 * the panel's choices with it, as the panel's buttons do; otherwise a key that chooses the tool
 * makes it active and any other does nothing.
 */
export interface ToolPanelKeyAction {
  /** Always `toolPanelKey`. */
  readonly type: 'toolPanelKey';
  /** The panel's tool. */
  readonly tool: ToolPanelId;
  /** The key. */
  readonly key: ToolPanelKey;
  /** Whether the key makes the tool active while another is (P chooses Draw; E does not). */
  readonly shouldChooseTool: boolean;
}

/** A tool panel key the shell received, numbered so that a repeat of the same key is new. */
export interface RecordedToolPanelKey {
  /** The panel's tool. */
  readonly tool: ToolPanelId;
  /** The key. */
  readonly key: ToolPanelKey;
  /** Increases by one with every recorded key, starting at 1. */
  readonly sequence: number;
}
