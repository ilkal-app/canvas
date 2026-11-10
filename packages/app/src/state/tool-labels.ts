import type { ToolId } from '@canvas/tools';

/** The name each tool goes by in the dock, its tooltip and the cheat sheet. */
export const TOOL_LABELS: Readonly<Record<ToolId, string>> = {
  select: 'Select',
  hand: 'Hand',
  text: 'Text',
  sticky: 'Sticky note',
  pen: 'Pen',
  draw: 'Draw',
  shape: 'Shape',
  line: 'Line',
  connector: 'Connector',
  image: 'Image',
  frame: 'Frame',
};
