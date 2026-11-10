import { describe, expect, it } from 'vitest';

import {
  CONNECTOR_LABEL_WRAP_WIDTH,
  NOTE_PADDING,
  noteHeightFor,
  noteWrapWidth,
} from './text-boxes.js';

describe('text box rules', () => {
  it('wraps a note inside its padding, never below one unit', () => {
    expect(NOTE_PADDING).toBe(16);
    expect(noteWrapWidth(200)).toBe(168);
    expect(noteWrapWidth(20)).toBe(1);
  });

  it('keeps a note at least square and grows it with its text', () => {
    expect(noteHeightFor(200, 50)).toBe(200);
    expect(noteHeightFor(200, 190)).toBe(222);
  });

  it('wraps a connector label at 200 units', () => {
    expect(CONNECTOR_LABEL_WRAP_WIDTH).toBe(200);
  });
});
