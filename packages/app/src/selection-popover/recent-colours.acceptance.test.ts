/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Agreed API modules are intentionally absent until implementation. */
import { describe, expect, it, vi } from 'vitest';

import {
  loadRecentColours,
  RECENT_COLOURS_LIMIT,
  RECENT_COLOURS_STORAGE_KEY,
  saveRecentColours,
  withRecentColour,
} from './recent-colours.js';

describe('recent colours acceptance', () => {
  it('moves a colour to the front without mutating the input and caps the history at eight', () => {
    const before = Object.freeze([
      'ink',
      'token:brand',
      '#000001',
      '#000002',
      '#000003',
      '#000004',
      '#000005',
      '#000006',
    ]);
    expect(RECENT_COLOURS_LIMIT).toBe(8);
    expect(withRecentColour(before, 'token:brand')).toEqual([
      'token:brand',
      'ink',
      '#000001',
      '#000002',
      '#000003',
      '#000004',
      '#000005',
      '#000006',
    ]);
    expect(withRecentColour(before, '#ffffff')).toEqual([
      '#ffffff',
      'ink',
      'token:brand',
      '#000001',
      '#000002',
      '#000003',
      '#000004',
      '#000005',
    ]);
    expect(before[0]).toBe('ink');
  });

  it('loads only strings and tolerates absent, malformed and throwing storage', () => {
    const getItem = vi
      .fn()
      .mockReturnValue(JSON.stringify(['ink', 7, 'token:brand', ...Array(10).fill('#123456')]));
    expect(loadRecentColours({ getItem })).toEqual([
      'ink',
      'token:brand',
      ...Array(6).fill('#123456'),
    ]);
    expect(getItem).toHaveBeenCalledWith(RECENT_COLOURS_STORAGE_KEY);
    expect(loadRecentColours({ getItem: () => null })).toEqual([]);
    expect(loadRecentColours({ getItem: () => '{broken' })).toEqual([]);
    expect(
      loadRecentColours({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toEqual([]);
  });

  it('stores the list under the public key and swallows storage failures', () => {
    const setItem = vi.fn();
    saveRecentColours(['ink', '#abcdef'], { setItem });
    expect(setItem).toHaveBeenCalledExactlyOnceWith(
      RECENT_COLOURS_STORAGE_KEY,
      '["ink","#abcdef"]',
    );
    expect(() => {
      saveRecentColours(['ink'], {
        setItem: () => {
          throw new Error('blocked');
        },
      });
    }).not.toThrow();
  });
});
