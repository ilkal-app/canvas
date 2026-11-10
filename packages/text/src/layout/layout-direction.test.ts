// Start and end on the metrics path, which orders nothing, follow each paragraph's
// direction too.
/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import { createFontMetrics, parseFont } from '../index.js';

import { createMetricsMeasurer } from './glyph-measurer.js';
import { layoutText } from './layout-text.js';

const HEBREW = '../../../app/assets/fonts/script-coverage/notosanshebrew/400.ttf';

/**
 * The per-codepoint measurer of Noto Sans Hebrew.
 *
 * @returns The measurer.
 */
function measurer() {
  const bytes = readFileSync(new URL(HEBREW, import.meta.url));
  const face = { family: 'Noto Sans Hebrew', weight: 400, isItalic: false } as const;
  return createMetricsMeasurer([createFontMetrics(face, parseFont(bytes))]);
}

/**
 * One run over a text.
 *
 * @param text - The text.
 * @returns The runs.
 */
function runs(text: string): StyleRun[] {
  const style: TextStyle = {
    fontFamily: 'Noto Sans Hebrew',
    fontSize: 20,
    weight: 400,
    italic: false,
    color: [0, 0, 0, 1],
  };
  return [{ length: text.length, style }];
}

describe('start and end on the metrics path', () => {
  it('align each auto paragraph by its first strong character', () => {
    const text = 'שלום\nab';
    const layout = layoutText(text, runs(text), 200, measurer(), 'start', 'auto');
    expect(layout.lines[0]?.x).toBeGreaterThan(0);
    expect(layout.lines[1]?.x).toBe(0);
    const ended = layoutText(text, runs(text), 200, measurer(), 'end', 'auto');
    expect(ended.lines[0]?.x).toBe(0);
    expect(ended.lines[1]?.x).toBeGreaterThan(0);
  });

  it('align the empty line after a final newline left to right', () => {
    const text = 'שלום\n';
    const layout = layoutText(text, runs(text), 200, measurer(), 'start', 'auto');
    expect(layout.lines).toHaveLength(2);
    expect(layout.lines[0]?.x).toBeGreaterThan(0);
    expect(layout.lines[1]?.x).toBe(0);
  });

  it('take an explicit direction over the text', () => {
    const text = 'שלום';
    expect(layoutText(text, runs(text), 200, measurer(), 'start', 'ltr').lines[0]?.x).toBe(0);
    expect(layoutText(text, runs(text), 200, measurer(), 'left', 'auto').lines[0]?.x).toBe(0);
  });
});
