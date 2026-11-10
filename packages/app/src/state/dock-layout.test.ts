// The dock per board mode and the one availability registry, against the ticket's
// tables (Figma "Dock · modes & flyouts", node 18:2413).
import { describe, expect, it } from 'vitest';

import { BOARD_MODES, type BoardMode } from '@canvas/schema';

import {
  dockButtonAction,
  DOCK_BUTTON_IDS,
  DOCK_BUTTONS,
  type DockButtonId,
} from './dock-buttons.js';
import { DOCK_GROUPS } from './dock-groups.js';
import * as dockLayout from './dock-layout.js';
import { DOCK_LAYOUTS, dockEntriesFor, isDockGroup, type DockEntry } from './dock-layout.js';
import { TOOL_AVAILABILITY } from './tool-availability.js';

/** The agreed exports, absent until the implementation lands. */
const futureLayout = dockLayout as unknown as Record<string, unknown>;
const panelLayouts = Reflect.get(futureLayout, 'PANEL_LAYOUTS') as Readonly<
  Record<BoardMode, { readonly hasLayersDrawer: boolean; readonly hasInspector: boolean }>
>;
const panelLayoutFor = Reflect.get(futureLayout, 'panelLayoutFor') as (
  mode: BoardMode,
  chrome: 'classic' | 'floating',
) => { readonly hasLayersDrawer: boolean; readonly hasInspector: boolean };

/** The ticket's "Dock per mode" table, each row after the switcher. */
const TABLE: Readonly<Record<BoardMode, readonly string[]>> = {
  whiteboard: ['select', 'hand', 'note', 'text', 'shapes', 'lines', 'image', 'pen', 'comment'],
  uiux: [
    'select',
    'hand',
    'frame',
    'shapes',
    'text',
    'image',
    'component',
    'pen',
    'prototype',
    'comment',
  ],
  diagram: ['select', 'hand', 'shapes', 'lines', 'text', 'note', 'diagram', 'comment'],
  slides: ['select', 'hand', 'slide', 'text', 'shapes', 'lines', 'image', 'present', 'comment'],
  illustration: [
    'select',
    'hand',
    'pen',
    'pencil',
    'brush',
    'shapes',
    'shape-builder',
    'eraser',
    'comment',
  ],
  motion: ['select', 'hand', 'keyframe', 'motion-path', 'easing', 'timeline', 'comment'],
};

/** The ticket's availability table: every button that starts disabled, with what enables it. */
const DISABLED: Readonly<Partial<Record<DockButtonId, string>>> = {
  prototype: 'no ticket yet',
  diagram: '',
  slide: 'no ticket yet',
  present: 'no ticket yet',
  pencil: 'no ticket yet',
  brush: 'no ticket yet',
  'shape-builder': 'no ticket yet',
  eraser: 'no ticket yet',
  keyframe: 'no ticket yet',
  'motion-path': 'no ticket yet',
  easing: 'no ticket yet',
  timeline: 'no ticket yet',
};

/**
 * Every button a mode's dock shows, flyout items included.
 *
 * @param entries - The dock's entries.
 * @returns The buttons.
 */
function buttonsOf(entries: readonly DockEntry[]): DockButtonId[] {
  return entries.flatMap((entry) => (isDockGroup(entry) ? DOCK_GROUPS[entry].items : [entry]));
}

describe('the dock per board mode', () => {
  it.each(BOARD_MODES)('lists the %s mode’s tools in the table’s order', (mode) => {
    expect(DOCK_LAYOUTS[mode]).toEqual(TABLE[mode]);
  });

  it('offers all six modes', () => {
    expect(BOARD_MODES).toEqual([
      'whiteboard',
      'uiux',
      'diagram',
      'illustration',
      'motion',
      'slides',
    ]);
  });

  it('holds the flyouts’ items in the table’s order', () => {
    expect(DOCK_GROUPS.shapes.items).toEqual([
      'rectangle',
      'ellipse',
      'triangle',
      'polygon',
      'star',
    ]);
    expect(DOCK_GROUPS.lines.items).toEqual(['line', 'arrow', 'elbow-connector', 'connector']);
  });

  it('gives an editor the whole set, a viewer only the select tool and the hand', () => {
    for (const mode of BOARD_MODES) {
      expect(dockEntriesFor(mode, 'editor')).toBe(DOCK_LAYOUTS[mode]);
      expect(dockEntriesFor(mode, 'viewer')).toEqual(['select', 'hand']);
      // A commenter's pin would not sync (the relay refuses it), so no comment button yet.
      expect(dockEntriesFor(mode, 'commenter')).toEqual(['select', 'hand']);
    }
  });
});

describe('the panel layout for whiteboard chrome', () => {
  it('keeps both drawers in every mode under classic, including the default', () => {
    for (const mode of BOARD_MODES) {
      expect(panelLayoutFor(mode, 'classic')).toEqual({
        hasLayersDrawer: true,
        hasInspector: true,
      });
    }
  });

  it('omits both drawers only on floating whiteboards', () => {
    expect(panelLayouts.whiteboard).toEqual({ hasLayersDrawer: false, hasInspector: false });
    for (const mode of BOARD_MODES.filter((each) => each !== 'whiteboard')) {
      expect(panelLayouts[mode]).toEqual({ hasLayersDrawer: true, hasInspector: true });
    }
    for (const mode of BOARD_MODES)
      expect(panelLayoutFor(mode, 'floating')).toBe(panelLayouts[mode]);
  });
});

describe('the availability registry', () => {
  it('has one entry for every button of every mode, flyout items included', () => {
    for (const mode of BOARD_MODES) {
      for (const button of buttonsOf(DOCK_LAYOUTS[mode])) {
        expect(TOOL_AVAILABILITY[button], `${mode} ${button}`).toBeDefined();
        expect(DOCK_BUTTONS[button].label.length, button).toBeGreaterThan(0);
      }
    }
    const shown = new Set(BOARD_MODES.flatMap((mode) => buttonsOf(DOCK_LAYOUTS[mode])));
    expect([...DOCK_BUTTON_IDS].sort()).toEqual([...shown].sort());
  });

  it('matches the ticket’s table: what starts disabled, and which issue brings it', () => {
    for (const id of DOCK_BUTTON_IDS) {
      const availability = TOOL_AVAILABILITY[id];
      const ticket = DISABLED[id];
      if (ticket === undefined) {
        expect(availability, id).toEqual({ isAvailable: true });
      } else {
        expect(availability, id).toEqual({ isAvailable: false, ticket });
      }
    }
  });

  it('gives every available button but the comment and component buttons a tool, and no other', () => {
    for (const id of DOCK_BUTTON_IDS) {
      const hasTool = DOCK_BUTTONS[id].tool !== undefined;
      const isAction = id === 'comment' || id === 'component';
      expect(hasTool, id).toBe(TOOL_AVAILABILITY[id].isAvailable && !isAction);
    }
  });

  it('makes the component button create a component of the selection', () => {
    expect(TOOL_AVAILABILITY.component).toEqual({ isAvailable: true });
    expect(dockButtonAction('component')).toEqual({ type: 'arrange', command: 'createComponent' });
    expect(DOCK_BUTTONS.component.label).toBe('Create component');
  });

  it('keeps the frame tool, enabled with, in the UI / UX dock only', () => {
    expect(TOOL_AVAILABILITY.frame).toEqual({ isAvailable: true });
    const withFrame = BOARD_MODES.filter((mode) => DOCK_LAYOUTS[mode].includes('frame'));
    expect(withFrame).toEqual(['uiux']);
  });
});
