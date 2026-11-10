import { useEffect, useRef } from 'react';

import { TOOL_IDS, type ToolId } from '@canvas/tools';

import type { MountedEngine } from '../engine/mounted-engine.js';
import type { ToolStyle, ToolStyles } from '../state/tool-style.js';

const NO_STYLE: ToolStyle = {};
const NO_PICKS: Readonly<Partial<Record<ToolId, true>>> = {};

/** What was last sent to one engine. */
interface Sent {
  readonly engine: MountedEngine;
  readonly styles: Map<ToolId, ToolStyle>;
  readonly picks: Map<ToolId, boolean>;
}

/**
 * Hands the engine each creation tool's style (`MountedEngine.setToolStyle`) and whether its
 * `ink` is the person's pick (`MountedEngine.setInkPicked`), as the shell hands it the active
 * tool: every tool's when an engine mounts, then each tool whose style or pick changed. The
 * tool's mode reads them from the document side when it creates an object.
 *
 * @param engine - The mounted engine, if any.
 * @param styles - Each tool's resolved style (`resolveToolStyles`).
 * @param pickedInk - The tools whose `ink` the person picked (`ShellState.pickedInk`); none if
 *   absent.
 */
export function useEngineToolStyles(
  engine: MountedEngine | undefined,
  styles: ToolStyles,
  pickedInk: Readonly<Partial<Record<ToolId, true>>> = NO_PICKS,
): void {
  const sentRef = useRef<Sent | undefined>(undefined);
  useEffect(() => {
    if (engine === undefined) return;
    if (sentRef.current?.engine !== engine) {
      sentRef.current = { engine, styles: new Map(), picks: new Map() };
    }
    const sent = sentRef.current;
    for (const tool of TOOL_IDS) {
      const style = styles[tool] ?? NO_STYLE;
      if (sent.styles.get(tool) !== style) {
        sent.styles.set(tool, style);
        engine.setToolStyle(tool, style);
      }
      const isPicked = pickedInk[tool] === true;
      if (sent.picks.get(tool) !== isPicked) {
        sent.picks.set(tool, isPicked);
        engine.setInkPicked(tool, isPicked);
      }
    }
  }, [engine, styles, pickedInk]);
}
