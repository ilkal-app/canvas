// Slice C1 (layer opacity): glyph records carry the ancestor multiplier.
import { describe, expect, it } from 'vitest';

import { groupObject } from '../../scene/__fixtures__/scene-objects.js';

import { createTextSetUp, textObject } from './__fixtures__/text-objects.js';

describe('text record layer opacity', () => {
  it('fades a glyph under a group and its own opacity', async () => {
    const { renderer, document, settle, records } = createTextSetUp();
    document.create(
      groupObject('group', { opacity: 0.5 }),
      textObject('text', 'A', { parentId: 'group', opacity: 0.5 }),
    );
    renderer.enqueue(document.takeChanges());
    await settle();
    const painted = records().find((record) => (record[6] ?? 0) > 0);
    expect(painted).toBeDefined();
    expect(painted?.at(-1)).toBeCloseTo(0.75);
    renderer.destroy();
  });
});
