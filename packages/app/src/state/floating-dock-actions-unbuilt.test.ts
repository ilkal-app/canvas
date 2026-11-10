// A floating dock tool not built yet, or one without an interaction mode, dispatches nothing:
// every tool is built since Reactions landed, so the dock's table is mocked.
import { describe, expect, it, vi } from 'vitest';

import { floatingDockToolAction } from './floating-dock-actions.js';
import type * as FloatingDock from './floating-dock.js';

vi.mock('./floating-dock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof FloatingDock>();
  return {
    ...actual,
    FLOATING_TOOL_AVAILABILITY: {
      ...actual.FLOATING_TOOL_AVAILABILITY,
      text: { isAvailable: false, ticket: '' },
    },
    FLOATING_DOCK_TOOLS: {
      ...actual.FLOATING_DOCK_TOOLS,
      pan: { ...actual.FLOATING_DOCK_TOOLS.pan, mode: undefined },
    },
  };
});

describe('floatingDockToolAction for a tool not built', () => {
  it('dispatches nothing for an unavailable tool or one without a mode', () => {
    expect(floatingDockToolAction('text')).toBeUndefined();
    expect(floatingDockToolAction('pan')).toBeUndefined();
    expect(floatingDockToolAction('select')).toEqual({ type: 'selectTool', tool: 'select' });
  });
});
