import { describe, expect, it } from 'vitest';

import {
  CANVAS_OBJECTS_MIME_TYPE,
  HTML_MIME_TYPE,
  PLAIN_TEXT_MIME_TYPE,
} from './clipboard-formats.js';
import {
  isOverPasteLimit,
  MAX_PASTE_MARKUP_LENGTH,
  MAX_PASTE_TEXT_LENGTH,
} from './clipboard-notice.js';

describe('isOverPasteLimit', () => {
  it('holds HTML and the objects JSON to 4 MiB, and plain text to 2 MiB', () => {
    expect([MAX_PASTE_MARKUP_LENGTH, MAX_PASTE_TEXT_LENGTH]).toEqual([
      4 * 1024 * 1024,
      2 * 1024 * 1024,
    ]);
    const atText = 'x'.repeat(MAX_PASTE_TEXT_LENGTH);
    const overText = `${atText}x`;
    for (const type of [PLAIN_TEXT_MIME_TYPE, 'text/other']) {
      expect([isOverPasteLimit(type, atText), isOverPasteLimit(type, overText)]).toEqual([
        false,
        true,
      ]);
    }
    const atMarkup = 'x'.repeat(MAX_PASTE_MARKUP_LENGTH);
    for (const type of [HTML_MIME_TYPE, CANVAS_OBJECTS_MIME_TYPE]) {
      expect(isOverPasteLimit(type, overText)).toBe(false);
      expect([isOverPasteLimit(type, atMarkup), isOverPasteLimit(type, `${atMarkup}x`)]).toEqual([
        false,
        true,
      ]);
    }
  });
});
