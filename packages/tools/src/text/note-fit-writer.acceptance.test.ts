import { describe, expect, it } from 'vitest';

import { fitNoteText, layoutText, noteBoxHeight } from '@canvas/engine';

import { MONO_MEASURER } from './__fixtures__/mono-layout.js';
import { createTextModeContext, TEN, tenPointNote } from './__fixtures__/text-mode-context.js';
import { measuredSize, writeTextContent } from './text-content-writer.js';

function content(lines: number) {
  const text = Array.from({ length: lines }, () => 'word').join('\n');
  return { text, runs: [{ length: text.length, style: { ...TEN, fontSize: 16 } }] };
}

describe('sticky text writer auto-fit', () => {
  it('keeps the width and height when text fits below its maximum', () => {
    const value = content(12);
    const note = tenPointNote('note', value.text, { runs: value.runs });
    const layout = fitNoteText(
      { text: value.text, runs: value.runs, boxHeight: noteBoxHeight(note.height) },
      (runs) => layoutText(value.text, runs, 168, MONO_MEASURER, 'center'),
    ).layout;
    expect(layoutText(value.text, value.runs, 168, MONO_MEASURER, 'center').height).toBeGreaterThan(
      168,
    );
    expect(layout.height).toBeLessThanOrEqual(168);
    expect(measuredSize(note, layout)).toEqual({ width: 200, height: 200 });
    const { store, context } = createTextModeContext([tenPointNote('note', '')]);
    expect(writeTextContent(context, note.id, value)).toBe(true);
    expect(store.get(note.id)).toMatchObject({ height: 200, width: 200, runs: value.runs });
  });

  it('grows when text overflows even at eight pixels', () => {
    const value = content(30);
    const note = tenPointNote('note', value.text, { runs: value.runs });
    const layout = fitNoteText(
      { text: value.text, runs: value.runs, boxHeight: noteBoxHeight(note.height) },
      (runs) => layoutText(value.text, runs, 168, MONO_MEASURER, 'center'),
    ).layout;
    expect(measuredSize(note, layout).height).toBeGreaterThan(200);
    const { store, context } = createTextModeContext([tenPointNote('note', '')]);
    expect(writeTextContent(context, note.id, value)).toBe(true);
    const stored = store.get(note.id);
    if (stored?.type !== 'sticky') throw new Error('Expected a stored sticky note');
    expect(stored.height).toBeGreaterThan(200);
  });

  it('does not shrink a note that was already taller', () => {
    const value = content(12);
    const note = tenPointNote('note', value.text, { height: 400, runs: value.runs });
    const layout = fitNoteText(
      { text: value.text, runs: value.runs, boxHeight: noteBoxHeight(note.height) },
      (runs) => layoutText(value.text, runs, 168, MONO_MEASURER, 'center'),
    ).layout;
    expect(measuredSize(note, layout)).toEqual({ width: 200, height: 400 });
  });
});
