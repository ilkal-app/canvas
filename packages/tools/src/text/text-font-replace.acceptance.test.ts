import { expect, it, vi } from 'vitest';

import type { ObjectId, TextObject } from '@canvas/schema';

import { createTextModeContext, TEN, tenPointText } from './__fixtures__/text-mode-context.js';
import { replaceFontFamilyOnBoard } from './text-font-replace.js';

it('waits to replace the local font and measured size as one write', async () => {
  const source = 'Brand Grotesk';
  const replacement = 'Lora';
  const { store, context } = createTextModeContext([
    tenPointText('a', 'abcd', {
      runs: [{ length: 4, style: { ...TEN, fontFamily: source } }],
      width: 1,
      height: 1,
    }),
    tenPointText('b', 'xy', { runs: [{ length: 2, style: { ...TEN, fontFamily: source } }] }),
  ]);
  const writes = vi.fn();
  const refused = vi.fn();
  store.subscribe((change) => {
    if (change.isLocal) writes();
  });
  const run = store.beginRun();
  try {
    expect(() => {
      replaceFontFamilyOnBoard({ ...context, onCommandRefused: refused }, source, replacement);
    }).not.toThrow();
    expect((store.get('a' as ObjectId) as TextObject).runs[0]?.style.fontFamily).toBe(source);
    expect(writes).not.toHaveBeenCalled();
    expect(refused).not.toHaveBeenCalled();
  } finally {
    run.close();
  }
  await vi.waitFor(() => {
    expect((store.get('a' as ObjectId) as TextObject).runs[0]?.style.fontFamily).toBe(replacement);
  });
  expect((store.get('b' as ObjectId) as TextObject).runs[0]?.style.fontFamily).toBe(replacement);
  expect((store.get('a' as ObjectId) as TextObject).width).toBe(24);
  expect(writes).toHaveBeenCalledOnce();
  expect(refused).not.toHaveBeenCalled();
  store.destroy();
});
