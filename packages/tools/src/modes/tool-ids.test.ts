import { describe, expect, it } from 'vitest';

import { isToolId, TOOL_IDS } from './tool-ids.js';

describe('isToolId', () => {
  it('recognises every interaction mode of the toolbar', () => {
    expect(TOOL_IDS.every((toolId) => isToolId(toolId))).toBe(true);
  });

  it('rejects a string that names no interaction mode', () => {
    expect(isToolId('eraser')).toBe(false);
    expect(isToolId('Select')).toBe(false);
  });
});
