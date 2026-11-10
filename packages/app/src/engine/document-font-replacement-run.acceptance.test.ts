import { afterEach, expect, it, vi } from 'vitest';

import type { TextLayoutInput } from '@canvas/tools';

import { readFontReplacement, setFontReplacement } from '../text-input/font-replacement.js';
import { PAGE_TEXT_LAYOUT } from '../text-input/page-fonts.js';

import { setUpTextDocument } from './__fixtures__/text-document.js';

vi.mock('../text-input/page-fonts.js', async () => {
  const { layoutText } = await import('@canvas/engine');
  const layout = {
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
    PAGE_OVERRIDE_SHAPING: {},
    PAGE_TEXT_LAYOUT: layout,
    pageFontRevision: () => 0,
    subscribePageFonts: () => () => undefined,
    ensurePageFont: () => Promise.resolve(true),
    pageFontStatus: (family: string) => (family === 'Private Serif' ? 'missing' : 'ready'),
  };
});

afterEach(() => {
  setFontReplacement(undefined);
});

it('loads the chosen local font during a run and commits the replacement only after idle', async () => {
  const { document, press, text, history, store } = setUpTextDocument(PAGE_TEXT_LAYOUT);
  document.setActiveTool('text');
  press('pointerDown', 20, 20);
  press('pointerUp', 20, 20);
  document.tools.text.session()?.type('original words');
  document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
  document.tools.text.apply({ kind: 'style', patch: { fontFamily: 'Private Serif' } });
  document.setActiveTool('text');
  press('pointerDown', 22, 22);
  press('pointerUp', 22, 22);
  const request = readFontReplacement();
  expect(request?.families).toEqual(['Private Serif']);
  const run = store.beginRun();
  const replacing = request?.replace('Lora');
  const result = replacing?.then(
    (didReplace) => didReplace,
    (error: unknown) => error,
  );
  try {
    await Promise.resolve();
    expect(text('text-1').runs[0]?.style.fontFamily).toBe('Private Serif');
  } finally {
    run.close();
  }
  expect(await result).toBe(true);
  expect(text('text-1').runs[0]?.style.fontFamily).toBe('Lora');
  document.destroy();
  history.destroy();
  store.destroy();
});
