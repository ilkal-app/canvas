import { afterEach, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';
import type { TextLayoutInput } from '@canvas/tools';

import { readFontReplacement, setFontReplacement } from '../text-input/font-replacement.js';
import { PAGE_TEXT_LAYOUT } from '../text-input/page-fonts.js';

import { setUpTextDocument } from './__fixtures__/text-document.js';

vi.mock('../text-input/page-fonts.js', async () => {
  const { layoutText } = await import('@canvas/engine');
  const monoLayout = {
    layout: (input: TextLayoutInput) =>
      layoutText(
        input.text,
        input.runs,
        input.wrapWidth,
        {
          faceIdOf: () => 'test',
          advance: () => 0.6,
          kerning: () => 0,
          lineMetrics: () => ({ ascent: 0.8, descent: 0.2 }),
        },
        input.align,
      ),
  };
  return {
    // Page override sizes measure unshaped here: no page shaper in tests.
    PAGE_OVERRIDE_SHAPING: {},
    PAGE_TEXT_LAYOUT: monoLayout,
    pageFontRevision: () => 0,
    subscribePageFonts: () => () => undefined,
    ensurePageFont: (family: string) => Promise.resolve(family === 'Lora'),
    pageFontStatus: (family: string) => (family === 'Private Serif' ? 'missing' : 'ready'),
  };
});
afterEach(() => {
  setFontReplacement(undefined);
});
it('keeps words untouched until an explicit whole-text replacement, undone once', async () => {
  const { document, press, text, history, store } = setUpTextDocument(PAGE_TEXT_LAYOUT);
  document.setActiveTool('text');
  press('pointerDown', 20, 20);
  press('pointerUp', 20, 20);
  document.tools.text.session()?.type('original words');
  document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
  document.tools.text.apply({ kind: 'style', patch: { fontFamily: 'Private Serif' } });
  const before = text('text-1');
  document.setActiveTool('text');
  press('pointerDown', 22, 22);
  press('pointerUp', 22, 22);
  expect(document.tools.text.session()).toBeUndefined();
  expect(readFontReplacement()?.families).toEqual(['Private Serif']);
  setFontReplacement(undefined);
  expect(text('text-1')).toEqual(before);
  press('pointerDown', 22, 22);
  press('pointerUp', 22, 22);
  expect(await readFontReplacement()?.replace('Lora')).toBe(true);
  expect(text('text-1').runs.every(({ style }) => style.fontFamily === 'Lora')).toBe(true);
  expect(text('text-1').text).toBe('original words');
  history.undo();
  expect(text('text-1').runs).toEqual(before.runs);
  expect(store.get('text-1' as ObjectId)).toBeDefined();
  document.destroy();
  history.destroy();
  store.destroy();
});
