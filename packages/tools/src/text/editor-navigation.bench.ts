import { bench, describe } from 'vitest';

import { setCaret } from './editor-navigation.js';
import { createEditorState } from './editor-state.js';
import { BASE, runsOf } from './runs/__fixtures__/text-styles.js';

// Full-text segmentation is needed to place carets in arbitrary-length grapheme clusters.
// Measure the actual editor placement path, including its new state allocation, at two text
// sizes. Standard micro-benchmark discovery includes this file; no special timing threshold.
describe('grapheme caret placement', () => {
  for (const length of [1_000, 10_000]) {
    const text = 'Ae\u0301 '.repeat(length / 4);
    const initial = createEditorState(text, runsOf([text.length, BASE]));
    bench(`100 placements in ${String(length)} UTF-16 units`, () => {
      let state = initial;
      for (let index = 0; index < 100; index += 1) {
        // Every probe is inside a base-plus-mark cluster, distributed through the text.
        const position = ((index * 97) % (length / 4)) * 4 + 2;
        state = setCaret(state, position, false);
      }
      if (state.caret % 4 !== 1) throw new Error('A caret split a grapheme cluster.');
    });
  }
});
