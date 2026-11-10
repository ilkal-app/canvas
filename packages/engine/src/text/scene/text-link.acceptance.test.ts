// Written before the code. CONTRACT: linked text allocates and rewrites records for glyphs and underlines. Deliberately not asserted: headless snapshots or vector export.
import { describe, expect, it } from 'vitest';

import type { ScenePass } from '../../scene/scene-pass.js';

import { CAMERA, createTextSetUp, STYLE, textObject } from './__fixtures__/text-objects.js';
import { TEXT_PASS, textRecordCount } from './text-pass.js';

const LINK = 'https://example.com/guide';
const TEXT = 'Read guide';

function linkedObject(link: string | undefined) {
  return textObject('t', TEXT, {
    runs: [
      { length: 5, style: STYLE },
      { length: 5, style: { ...STYLE, ...(link === undefined ? {} : { link }) } },
    ],
  });
}

function isFlat(record: Float32Array): boolean {
  return record[8] === -1 && record[9] === -1 && record[10] === -1 && record[11] === -1;
}

describe('scene text pass linked records', () => {
  it('budgets an underline from runs before layout exists', () => {
    expect(textRecordCount(linkedObject(LINK))).toBeGreaterThan(
      textRecordCount(linkedObject(undefined)),
    );
  });

  it('draws glyph and flat underline records without dropping any', async () => {
    let pass: ScenePass | undefined;
    const { renderer, document, settle, records } = createTextSetUp(CAMERA, true, false, {
      passes: [{ ...TEXT_PASS, create: (environment) => (pass = TEXT_PASS.create(environment)) }],
    });
    document.create(linkedObject(LINK));
    renderer.enqueue(document.takeChanges());
    await settle();
    const drawn = records().filter((record) => (record[6] ?? 0) > 0 && (record[7] ?? 0) > 0);
    expect(drawn.filter(isFlat)).toHaveLength(1);
    expect(drawn.filter((record) => !isFlat(record))).toHaveLength(9);
    expect((pass as ScenePass & { readonly droppedGlyphs: number }).droppedGlyphs).toBe(0);
  });

  it('rebuilds records when a link is added and removed from unchanged text', async () => {
    const { renderer, document, settle, records } = createTextSetUp();
    document.create(linkedObject(undefined));
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(records().some(isFlat)).toBe(false);
    document.update('t', { runs: linkedObject(LINK).runs });
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(records().filter(isFlat)).toHaveLength(1);
    document.update('t', { runs: linkedObject(undefined).runs });
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(records().some(isFlat)).toBe(false);
  });
});
