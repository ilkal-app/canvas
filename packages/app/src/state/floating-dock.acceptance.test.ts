// CONTRACT/: the floating dock exposes built Reactions to writers while preserving role-specific tools.
import { describe, expect, it } from 'vitest';

import {
  FLOATING_DOCK_SECTIONS,
  FLOATING_DOCK_TOOL_IDS,
  FLOATING_DOCK_TOOLS,
  FLOATING_READ_ONLY_TOOLS,
  FLOATING_TOOL_AVAILABILITY,
  floatingDockSectionsFor,
  floatingDockToolOfMode,
  floatingDockToolsFor,
  floatingMobileBarSectionsFor,
  floatingToolAvailability,
} from './floating-dock.js';

describe('floating dock', () => {
  it('presents the eleven tools in three named sections and dock order', () => {
    expect(FLOATING_DOCK_SECTIONS).toEqual([
      { id: 'navigate', label: 'Navigate', tools: ['select', 'pan', 'section'] },
      {
        id: 'stage',
        label: 'Set the stage',
        tools: ['shapes', 'image', 'text', 'connector', 'draw'],
      },
      { id: 'collaborate', label: 'Collaborate', tools: ['sticky', 'comment', 'reactions'] },
    ]);
    expect(FLOATING_DOCK_TOOL_IDS).toEqual(FLOATING_DOCK_SECTIONS.flatMap(({ tools }) => tools));
    expect(floatingDockToolsFor('editor')).toEqual(FLOATING_DOCK_TOOL_IDS);
    expect(floatingDockSectionsFor('editor')).toEqual(FLOATING_DOCK_SECTIONS);
  });

  it('uses the approved names, keys and interaction modes without line or vector pen', () => {
    expect(FLOATING_DOCK_TOOL_IDS.map((id) => [id, FLOATING_DOCK_TOOLS[id].chord])).toEqual([
      ['select', 'v'],
      ['pan', 'h'],
      ['section', 'f'],
      ['shapes', 's'],
      ['image', 'i'],
      ['text', 't'],
      ['connector', 'c'],
      ['draw', 'p'],
      ['sticky', 'n'],
      ['comment', 'm'],
      ['reactions', 'e'],
    ]);
    expect(FLOATING_DOCK_TOOLS.section.label).toBe('Section');
    expect(FLOATING_DOCK_TOOLS.comment.label).toBe('Comment');
    expect(FLOATING_DOCK_TOOL_IDS).not.toContain('line');
    expect(FLOATING_DOCK_TOOL_IDS).not.toContain('pen');
    expect(floatingDockToolOfMode('hand')).toBe('pan');
    expect(floatingDockToolOfMode('frame')).toBe('section');
    expect(floatingDockToolOfMode('line')).toBeUndefined();
    expect(floatingDockToolOfMode('pen')).toBeUndefined();
  });

  it('keeps a reduced dock for commenters and viewers and drops empty groups', () => {
    expect(FLOATING_READ_ONLY_TOOLS).toEqual({
      commenter: ['select', 'pan', 'comment', 'reactions'],
      viewer: ['select', 'pan'],
    });
    expect(floatingDockSectionsFor('commenter')).toEqual([
      { id: 'navigate', label: 'Navigate', tools: ['select', 'pan'] },
      { id: 'collaborate', label: 'Collaborate', tools: ['comment', 'reactions'] },
    ]);
    expect(floatingDockSectionsFor('viewer')).toEqual([
      { id: 'navigate', label: 'Navigate', tools: ['select', 'pan'] },
    ]);
    expect(floatingDockToolsFor('commenter')).toEqual(FLOATING_READ_ONLY_TOOLS.commenter);
    expect(floatingDockToolsFor('viewer')).toEqual(FLOATING_READ_ONLY_TOOLS.viewer);
  });

  it('uses the same groups on mobile without Pan and drops empty groups', () => {
    expect(floatingMobileBarSectionsFor('editor')).toEqual([
      { id: 'navigate', label: 'Navigate', tools: ['select', 'section'] },
      {
        id: 'stage',
        label: 'Set the stage',
        tools: ['shapes', 'image', 'text', 'connector', 'draw'],
      },
      { id: 'collaborate', label: 'Collaborate', tools: ['sticky', 'comment', 'reactions'] },
    ]);
    expect(floatingMobileBarSectionsFor('commenter')).toEqual([
      { id: 'navigate', label: 'Navigate', tools: ['select'] },
      { id: 'collaborate', label: 'Collaborate', tools: ['comment', 'reactions'] },
    ]);
    expect(floatingMobileBarSectionsFor('viewer')).toEqual([
      { id: 'navigate', label: 'Navigate', tools: ['select'] },
    ]);
  });

  it('makes Reactions and Comment available to commenters', () => {
    // Draw's ticket landed (the draw tool, its strokes): it is built.
    expect(FLOATING_TOOL_AVAILABILITY.draw).toEqual({ isAvailable: true });
    expect(FLOATING_TOOL_AVAILABILITY.reactions).toEqual({ isAvailable: true });
    expect(floatingToolAvailability('draw', 'editor')).toEqual({ isAvailable: true });
    expect(floatingToolAvailability('reactions', 'commenter')).toEqual({ isAvailable: true });
    expect(floatingToolAvailability('comment', 'commenter')).toEqual({ isAvailable: true });
    expect(floatingToolAvailability('comment', 'editor')).toEqual({ isAvailable: true });
    expect(floatingToolAvailability('select', 'viewer')).toEqual({ isAvailable: true });
    expect(floatingToolAvailability('pan', 'viewer')).toEqual({ isAvailable: true });
    expect(floatingToolAvailability('shapes', 'viewer').isAvailable).toBe(false);
    expect(floatingToolAvailability('sticky', 'commenter').isAvailable).toBe(false);
  });
});
