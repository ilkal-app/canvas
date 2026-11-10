import { expect, it } from 'vitest';

import { toolPatchOf } from './text-tool-patch.js';

it('keeps a whole coordinate record when a tool-defaults patch also names axes', () => {
  expect(
    toolPatchOf(
      {
        kind: 'style',
        patch: {
          fontVariations: { wght: 700 },
          fontVariationsAxes: { opsz: 24 },
        },
      },
      { fontVariations: { opsz: 18 } },
    ),
  ).toEqual({ textStyle: { fontVariations: { wght: 700 } } });
});
