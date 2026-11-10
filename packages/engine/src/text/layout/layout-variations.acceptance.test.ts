/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';
import { loadShaper } from '@canvas/text';

import { FontLibrary } from '../font/font-library.js';
import { textObject } from '../scene/__fixtures__/text-objects.js';
import { TextLayoutKey } from '../scene/text-layout-key.js';
import { textPlacementOf } from '../scene/text-placement.js';

import { layoutTextNow } from './layout-job.js';
import { createLayoutJobRequest } from './layout-request.js';
import { libraryShaping } from './layout-shaping.js';

const family = 'Corpus Sans Variable';
const style: TextStyle = {
  fontFamily: family,
  fontSize: 20,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};
const runs = (weight: number): StyleRun[] => [
  { length: 2, style: { ...style, fontVariations: { wght: weight } } },
];

describe('variable coordinates in engine layout', () => {
  it('carries run coordinates through a layout request into shaped layout', async () => {
    const library = new FontLibrary();
    const bytes = readFileSync(
      new URL(
        '../../../../text/src/__fixtures__/format-corpus/corpus-sans-variable.ttf',
        import.meta.url,
      ),
    );
    library.addFace({ family, weight: 400, isItalic: false }, Uint8Array.from(bytes).buffer);
    const request = (weight: number) =>
      createLayoutJobRequest(
        { objectId: 'variable', text: 'Aa', runs: runs(weight), maxWidth: null, align: 'left' },
        library,
      );
    const shaping = libraryShaping(library, await loadShaper());
    const regular = layoutTextNow(request(400), shaping);
    const bold = layoutTextNow(request(700), shaping);
    expect(bold.runs[0]?.variations).toEqual({ wght: 700 });
    expect(bold.lines[0]?.width).toBeGreaterThan(regular.lines[0]?.width ?? 0);
  });

  it('changes the layout key when only a run coordinate changes', () => {
    const object = textObject('variable', 'Aa');
    const regular = textPlacementOf({ ...object, runs: runs(400) });
    const bold = textPlacementOf({ ...object, runs: runs(700) });
    const key = new TextLayoutKey();
    expect(key.of(regular, 'fonts')).not.toBe(key.of(bold, 'fonts'));
  });
});
