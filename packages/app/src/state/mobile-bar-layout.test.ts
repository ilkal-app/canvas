import { describe, expect, it } from 'vitest';

import { BOARD_MODES } from '@canvas/schema';

import { DOCK_LAYOUTS, READ_ONLY_DOCKS } from './dock-layout.js';
import { MOBILE_BAR_LAYOUTS, mobileBarEntriesFor } from './mobile-bar-layout.js';

describe('the compact bottom bar’s entries', () => {
  it('are the mobile design’s for a whiteboard editor, less the mode button (D2): select to comment', () => {
    expect(mobileBarEntriesFor('whiteboard', 'editor')).toEqual([
      'select',
      'note',
      'shapes',
      'lines',
      'pen',
      'comment',
    ]);
  });

  it('hold at most seven targets in every mode, each from that mode’s dock, ending with comment', () => {
    for (const mode of BOARD_MODES) {
      const entries = mobileBarEntriesFor(mode, 'editor');
      expect(entries.length, mode).toBeLessThanOrEqual(7);
      expect(entries).not.toContain('mode');
      expect(entries.at(-1)).toBe('comment');
      for (const entry of MOBILE_BAR_LAYOUTS[mode]) expect(DOCK_LAYOUTS[mode]).toContain(entry);
      expect(new Set(entries).size).toBe(entries.length);
    }
  });

  it('leave out the hand for an editor: two fingers pan on a touch screen', () => {
    for (const mode of BOARD_MODES) {
      expect(mobileBarEntriesFor(mode, 'editor')).not.toContain('hand');
    }
  });

  it('give a viewer and a commenter the dock’s read-only set and no mode button', () => {
    for (const mode of BOARD_MODES) {
      expect(mobileBarEntriesFor(mode, 'viewer')).toEqual(READ_ONLY_DOCKS.viewer);
      expect(mobileBarEntriesFor(mode, 'commenter')).toEqual(READ_ONLY_DOCKS.commenter);
    }
  });

  it('never mutate the layouts they read', () => {
    const before = JSON.stringify(MOBILE_BAR_LAYOUTS);
    mobileBarEntriesFor('whiteboard', 'editor');
    expect(JSON.stringify(MOBILE_BAR_LAYOUTS)).toBe(before);
  });

  it('give every editor the mode’s layout, with no mode button (D2)', () => {
    for (const mode of BOARD_MODES) {
      expect(mobileBarEntriesFor(mode, 'editor')).toEqual(MOBILE_BAR_LAYOUTS[mode]);
    }
  });
});
