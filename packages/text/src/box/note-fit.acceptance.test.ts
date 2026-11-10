import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { fitNoteText, layoutText, NOTE_FIT_FLOOR_PX, type TextLayout } from '../index.js';
import { FakeGlyphMeasurer } from '../layout/__fixtures__/fake-glyph-measurer.js';

const STYLE: TextStyle = {
  fontFamily: 'Fake',
  fontSize: 24,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

function runs(text: string, size = 24): StyleRun[] {
  return [{ length: text.length, style: { ...STYLE, fontSize: size } }];
}

function fakeLayout(text: string, measured: readonly StyleRun[]): TextLayout {
  return {
    height: text.length * Math.max(...measured.map((run) => run.style.fontSize)),
  } as TextLayout;
}

describe('fitNoteText', () => {
  it('keeps a fitting maximum and the original runs array', () => {
    const text = 'abc';
    const stored = runs(text);
    const result = fitNoteText({ text, runs: stored, boxHeight: 100 }, (at) =>
      fakeLayout(text, at),
    );
    expect(result).toMatchObject({ fittedFontSize: 24, scale: 1, isOverflowing: false });
    expect(result.runs).toBe(stored);
    expect(result.layout.height).toBe(72);
  });

  it('chooses the largest fitting integer size', () => {
    const text = 'abcde';
    const result = fitNoteText({ text, runs: runs(text), boxHeight: 83 }, (at) =>
      fakeLayout(text, at),
    );
    expect(result.fittedFontSize).toBe(16);
    expect(result.scale).toBe(16 / 24);
    expect(result.layout.height).toBeLessThanOrEqual(83);
    expect(fakeLayout(text, runs(text, result.fittedFontSize + 1)).height).toBeGreaterThan(83);
    expect(result.isOverflowing).toBe(false);
  });

  it('stops at eight and reports overflow only when eight is too tall', () => {
    const text = 'a'.repeat(20);
    const result = fitNoteText({ text, runs: runs(text), boxHeight: 100 }, (at) =>
      fakeLayout(text, at),
    );
    expect(NOTE_FIT_FLOOR_PX).toBe(8);
    expect(result.fittedFontSize).toBe(8);
    expect(result.layout.height).toBe(160);
    expect(result.isOverflowing).toBe(true);
  });

  it('never enlarges a stored maximum below the floor', () => {
    const text = 'abc';
    const stored = runs(text, 6);
    const result = fitNoteText({ text, runs: stored, boxHeight: 1 }, (at) => fakeLayout(text, at));
    expect(result.fittedFontSize).toBe(6);
    expect(result.scale).toBe(1);
    expect(result.runs).toBe(stored);
  });

  it('scales mixed runs by one factor', () => {
    const text = 'abcdefghij';
    const stored: StyleRun[] = [
      { length: 5, style: STYLE },
      { length: 5, style: { ...STYLE, fontSize: 12 } },
    ];
    const result = fitNoteText({ text, runs: stored, boxHeight: 120 }, (at) =>
      fakeLayout(text, at),
    );
    expect(result.fittedFontSize).toBe(12);
    expect(result.scale).toBe(0.5);
    expect(result.runs.map((run) => run.style.fontSize)).toEqual([12, 6]);
    expect(stored.map((run) => run.style.fontSize)).toEqual([24, 12]);
  });

  it('leaves empty text at its stored maximum', () => {
    const text = '';
    const stored = runs(text);
    const result = fitNoteText({ text, runs: stored, boxHeight: 0 }, (at) => fakeLayout(text, at));
    expect(result).toMatchObject({ fittedFontSize: 24, scale: 1, isOverflowing: false });
    expect(result.runs).toBe(stored);
  });

  it('is deterministic and uses logarithmically many layouts', () => {
    const text = 'a';
    const stored = runs(text, 400);
    let calls = 0;
    const layoutAt = (at: readonly StyleRun[]): TextLayout => {
      calls += 1;
      return fakeLayout(text, at);
    };
    const input = { text, runs: stored, boxHeight: 123 };
    const first = fitNoteText(input, layoutAt);
    expect(first.fittedFontSize).toBe(123);
    expect(calls).toBeLessThanOrEqual(12);
    expect(fitNoteText(input, layoutAt)).toEqual(first);
  });

  it('fits actual wrapped text using the layout measurer', () => {
    const text = 'word '.repeat(50);
    const stored = runs(text);
    const measurer = new FakeGlyphMeasurer();
    const layoutAt = (at: readonly StyleRun[]) => layoutText(text, at, 168, measurer, 'center');
    const result = fitNoteText({ text, runs: stored, boxHeight: 168 }, layoutAt);
    expect(result.fittedFontSize).toBeLessThan(24);
    expect(result.layout.height).toBeLessThanOrEqual(168);
    expect(layoutAt(runs(text, result.fittedFontSize + 1)).height).toBeGreaterThan(168);
  });
});
