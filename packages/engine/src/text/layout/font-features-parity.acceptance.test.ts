/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';
import { createTextShaping, loadShaper, measureText } from '@canvas/text';

import { FontLibrary } from '../font/font-library.js';
import { textObject } from '../scene/__fixtures__/text-objects.js';
import { TextLayoutKey } from '../scene/text-layout-key.js';
import { textPlacementOf } from '../scene/text-placement.js';

import { layoutTextNow } from './layout-job.js';
import { createLayoutJobRequest } from './layout-request.js';
import { libraryShaping } from './layout-shaping.js';

const cases = [
  {
    text: 'office',
    family: 'EB Garamond',
    path: '../../../../app/assets/fonts/library/ebgaramond/400.ttf',
    features: { liga: 0 },
  },
  {
    text: '1111 0000',
    family: 'Inter',
    path: '../../../../app/assets/fonts/library/inter/400.ttf',
    features: { tnum: 1 },
  },
] as const;

/**
 * A one-run style for the requested OpenType feature.
 *
 * @param text - The text.
 * @param family - Font family.
 * @param fontFeatures - OpenType settings.
 * @returns One run.
 */
function run(
  text: string,
  family: string,
  fontFeatures?: Readonly<Record<string, number>>,
): StyleRun[] {
  const style: TextStyle = {
    fontFamily: family,
    fontSize: 20,
    color: [0, 0, 0, 1],
    weight: 400,
    italic: false,
    ...(fontFeatures === undefined ? {} : { fontFeatures }),
  };
  return [{ length: text.length, style }];
}

describe('engine and MCP font feature parity', () => {
  for (const sample of cases) {
    it(`${sample.family} ${Object.keys(sample.features).at(0) ?? 'feature'} gives identical shaped widths`, async () => {
      const bytes = new Uint8Array(readFileSync(new URL(sample.path, import.meta.url)));
      const library = new FontLibrary();
      const face = { family: sample.family, weight: 400 as const, isItalic: false };
      const loaded = library.addFace(face, Uint8Array.from(bytes).buffer);
      const shaper = await loadShaper();
      const shaping = createTextShaping(shaper, {
        bytesOf: (requested) => (requested.family === sample.family ? bytes : undefined),
      });
      const runs = run(sample.text, sample.family, sample.features);
      const measurement = measureText(
        sample.text,
        runs,
        null,
        [loaded.metrics],
        shaping.measurerFor([loaded.metrics]),
      );
      const request = createLayoutJobRequest(
        {
          objectId: 'font-features',
          text: sample.text,
          runs,
          maxWidth: null,
          align: 'left',
        },
        library,
      );
      const engine = layoutTextNow(request, libraryShaping(library, shaper));
      expect(engine.width).toBe(measurement.width);
      expect(engine.lines.map(({ width }) => width)).toEqual([measurement.width]);
      const defaultRuns = run(sample.text, sample.family);
      const defaultRequest = createLayoutJobRequest(
        {
          objectId: 'font-features',
          text: sample.text,
          runs: defaultRuns,
          maxWidth: null,
          align: 'left',
        },
        library,
      );
      expect(engine.width).not.toBe(
        layoutTextNow(defaultRequest, libraryShaping(library, shaper)).width,
      );
    });
  }

  it('keys layout separately when only fontFeatures change', () => {
    const object = textObject('font-features', 'office');
    const defaultPlacement = textPlacementOf({ ...object, runs: run('office', 'EB Garamond') });
    const featurePlacement = textPlacementOf({
      ...object,
      runs: run('office', 'EB Garamond', { liga: 0 }),
    });
    const key = new TextLayoutKey();
    expect(key.of(defaultPlacement, 'fonts')).not.toBe(key.of(featurePlacement, 'fonts'));
  });
});
