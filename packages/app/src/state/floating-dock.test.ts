// The floating whiteboard dock's model: three sections, each role's tools, the keys,
// availability, and the tool shown pressed for a mode.
import { describe, expect, it } from 'vitest';

import { TOOL_IDS } from '@canvas/tools';

import {
  FLOATING_DOCK_SECTIONS,
  FLOATING_DOCK_TOOL_IDS,
  FLOATING_DOCK_TOOLS,
  floatingDockSectionsFor,
  floatingDockToolOfMode,
  floatingDockToolsFor,
  floatingMobileBarSectionsFor,
  floatingToolAvailability,
} from './floating-dock.js';

describe('the floating dock for an editor', () => {
  it('holds the design’s three sections in order', () => {
    expect(FLOATING_DOCK_SECTIONS.map(({ id, tools }) => [id, tools])).toEqual([
      ['navigate', ['select', 'pan', 'section']],
      ['stage', ['shapes', 'image', 'text', 'connector', 'draw']],
      ['collaborate', ['sticky', 'comment', 'reactions']],
    ]);
    expect(floatingDockSectionsFor('editor')).toBe(FLOATING_DOCK_SECTIONS);
  });

  it('lists every tool once, in the order of FLOATING_DOCK_TOOL_IDS', () => {
    expect(floatingDockToolsFor('editor')).toEqual(FLOATING_DOCK_TOOL_IDS);
  });

  it('gives each tool its own single key', () => {
    const chords = FLOATING_DOCK_TOOL_IDS.map((id) => FLOATING_DOCK_TOOLS[id].chord);
    expect(chords).toEqual(['v', 'h', 'f', 's', 'i', 't', 'c', 'p', 'n', 'm', 'e']);
    expect(new Set(chords).size).toBe(chords.length);
  });

  it('opens a panel for exactly shapes, image, connector, draw, sticky and reactions', () => {
    expect(FLOATING_DOCK_TOOL_IDS.filter((id) => FLOATING_DOCK_TOOLS[id].hasPanel)).toEqual([
      'shapes',
      'image',
      'connector',
      'draw',
      'sticky',
      'reactions',
    ]);
  });

  it('makes only existing interaction modes active', () => {
    for (const id of FLOATING_DOCK_TOOL_IDS) {
      const { mode } = FLOATING_DOCK_TOOLS[id];
      if (mode !== undefined) expect(TOOL_IDS).toContain(mode);
    }
  });
});

describe('the floating dock for a role that cannot edit', () => {
  it('gives a commenter select, pan, comment and reactions in two sections', () => {
    expect(floatingDockSectionsFor('commenter').map(({ id, tools }) => [id, tools])).toEqual([
      ['navigate', ['select', 'pan']],
      ['collaborate', ['comment', 'reactions']],
    ]);
  });

  it('gives a viewer select and pan in one section', () => {
    expect(floatingDockSectionsFor('viewer').map(({ id, tools }) => [id, tools])).toEqual([
      ['navigate', ['select', 'pan']],
    ]);
  });
});

describe('the compact bar', () => {
  it('keeps the three groups without pan', () => {
    expect(floatingMobileBarSectionsFor('editor').map(({ tools }) => tools)).toEqual([
      ['select', 'section'],
      ['shapes', 'image', 'text', 'connector', 'draw'],
      ['sticky', 'comment', 'reactions'],
    ]);
    expect(floatingMobileBarSectionsFor('viewer').map(({ tools }) => tools)).toEqual([['select']]);
  });
});

describe('availability', () => {
  it('enables draw and reactions for an editor and a commenter, never a viewer', () => {
    expect(floatingToolAvailability('draw', 'editor')).toEqual({ isAvailable: true });
    expect(floatingToolAvailability('reactions', 'editor')).toEqual({ isAvailable: true });
    expect(floatingToolAvailability('reactions', 'commenter')).toEqual({ isAvailable: true });
    expect(floatingToolAvailability('reactions', 'viewer').isAvailable).toBe(false);
    expect(floatingToolAvailability('sticky', 'editor')).toEqual({ isAvailable: true });
  });

  it('gives a commenter Comment and refuses tools outside a role’s dock', () => {
    expect(floatingToolAvailability('comment', 'commenter')).toEqual({ isAvailable: true });
    expect(floatingToolAvailability('pan', 'commenter')).toEqual({ isAvailable: true });
    expect(floatingToolAvailability('sticky', 'viewer').isAvailable).toBe(false);
    expect(floatingToolAvailability('comment', 'viewer').isAvailable).toBe(false);
  });
});

describe('the tool shown pressed', () => {
  it('maps each mode to its dock tool, and the line and pen to none', () => {
    expect(floatingDockToolOfMode('hand')).toBe('pan');
    expect(floatingDockToolOfMode('frame')).toBe('section');
    expect(floatingDockToolOfMode('sticky')).toBe('sticky');
    expect(floatingDockToolOfMode('line')).toBeUndefined();
    expect(floatingDockToolOfMode('pen')).toBeUndefined();
  });
});
