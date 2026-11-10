import { useEffect, useRef } from 'react';

import type { ToolId } from '@canvas/tools';

import type { MountedEngine } from '../engine/mounted-engine.js';

import type { WhiteboardChrome } from './whiteboard-chrome.js';

/** The tools that make objects: choosing one of them starts afresh (item 3). */
const CREATION_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>([
  'sticky',
  'shape',
  'text',
  'connector',
  'draw',
  'pen',
  'line',
  'frame',
]);

/** What {@link useCreationToolClearsSelection} returns. */
export interface CreationToolSelection {
  /**
   * Notes a tool the engine switched to itself (placing a shape returns to Select, editing a text
   * enters Text): such a switch keeps the selection. Call it before dispatching the switch.
   */
  readonly noteEngineTool: (tool: ToolId) => void;
}

/**
 * Under the floating chrome, the person choosing a creation tool (Sticky note, Shapes, Text,
 * Connector, Draw, Section) by its dock button or key clears the selection, so what they make
 * next is not drawn beside an old selection (item 3: a stroke stayed selected while the
 * next was drawn). Select, Pan, Comment and Image keep it, as do the tool switches the engine
 * makes itself (`noteEngineTool`) and the classic chrome.
 *
 * @param engine - The running engine, once it runs.
 * @param activeTool - The shell's active tool.
 * @param chrome - The shell's chrome.
 * @returns How the engine's own switches are told apart.
 */
export function useCreationToolClearsSelection(
  engine: MountedEngine | undefined,
  activeTool: ToolId,
  chrome: WhiteboardChrome,
): CreationToolSelection {
  const engineToolRef = useRef<ToolId | undefined>(undefined);
  const previousRef = useRef(activeTool);
  useEffect(() => {
    const isChange = previousRef.current !== activeTool;
    previousRef.current = activeTool;
    const isEngines = engineToolRef.current === activeTool;
    engineToolRef.current = undefined;
    if (!isChange || isEngines || chrome !== 'floating' || engine === undefined) return;
    if (!CREATION_TOOLS.has(activeTool)) return;
    if (engine.board.state().selectedIds.length > 0) engine.board.select([]);
  }, [engine, activeTool, chrome]);
  return {
    noteEngineTool: (tool) => {
      engineToolRef.current = tool;
    },
  };
}
