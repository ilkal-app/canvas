import { describe, expect, it, vi } from 'vitest';

import { monoLayout } from './__fixtures__/mono-layout.js';
import { tenPointText } from './__fixtures__/text-mode-context.js';
import { SessionLayoutCache } from './session-layout-cache.js';

function countingContext() {
  const layout = vi.fn(
    (input: { text: string; runs: Parameters<typeof monoLayout>[1]; wrapWidth: number | null }) =>
      monoLayout(input.text, input.runs, input.wrapWidth),
  );
  return { context: { layout: { layout } }, layout };
}

describe('SessionLayoutCache', () => {
  it('lays the shown text out once while the content and the box stay the same', () => {
    const { context, layout } = countingContext();
    const cache = new SessionLayoutCache();
    const object = tenPointText('t', 'ab');
    const shown = { text: 'ab', runs: object.runs };
    const first = cache.layoutOf(context, object, shown);
    expect(cache.layoutOf(context, object, { ...shown })).toBe(first);
    expect(layout).toHaveBeenCalledOnce();
  });

  it('lays out again when the text, the width or the alignment changes', () => {
    const { context, layout } = countingContext();
    const cache = new SessionLayoutCache();
    const object = tenPointText('t', 'ab');
    const shown = { text: 'ab', runs: object.runs };
    cache.layoutOf(context, object, shown);
    const longer = { text: 'abc', runs: [{ ...object.runs[0], length: 3 }] } as typeof shown;
    expect(cache.layoutOf(context, object, longer)?.width).toBeCloseTo(18, 6);
    cache.layoutOf(context, { ...object, autoWidth: false, width: 10 }, longer);
    cache.layoutOf(context, { ...object, autoWidth: false, width: 10, align: 'center' }, longer);
    expect(layout).toHaveBeenCalledTimes(4);
  });

  it('lays out again after no font answered, so the caret shows once the fonts land', () => {
    let hasFonts = false;
    const context = {
      layout: {
        layout: (input: { text: string; runs: Parameters<typeof monoLayout>[1] }) =>
          hasFonts ? monoLayout(input.text, input.runs) : undefined,
      },
    };
    const cache = new SessionLayoutCache();
    const object = tenPointText('t', 'ab');
    const shown = { text: 'ab', runs: object.runs };
    expect(cache.layoutOf(context, object, shown)).toBeUndefined();
    hasFonts = true;
    expect(cache.layoutOf(context, object, shown)?.width).toBeCloseTo(12, 6);
  });
});
