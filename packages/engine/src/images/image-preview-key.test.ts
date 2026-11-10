import { expect, it } from 'vitest';

import { imageObject } from './__fixtures__/image-objects.js';
import { WHOLE_IMAGE } from './image-binding.js';
import type { ImageObjectEvidence } from './image-preview-evidence.js';
import { imagePreviewKey } from './image-preview-key.js';

function evidence(): ImageObjectEvidence {
  return {
    object: imageObject(),
    transform: { x: 0, y: 0, cos: 1, sin: 0 },
    contentIdentity: 'verified',
    plan: {
      smallestKey: 'photo|L128',
      pickedLevel: 512,
      level: 512,
      levelKey: 'photo|L512',
      tiles: undefined,
    },
    binding: {
      color: [0, 0, 0, 1],
      parts: [
        {
          rect: WHOLE_IMAGE,
          source: { covers: WHOLE_IMAGE, region: { page: 1, u0: 0, v0: 0, u1: 1, v1: 1 } },
        },
      ],
    },
    residents: [{ key: 'photo|L512', identity: 1, widthPx: 512, heightPx: 512 }],
  };
}

it('ignores renderer allocation identities but binds actual plans, dimensions and coverage', () => {
  const first = evidence();
  const relocated: ImageObjectEvidence = {
    ...first,
    residents: [{ key: 'photo|L512', identity: 99, widthPx: 512, heightPx: 512 }],
    binding: {
      ...first.binding,
      parts: [
        {
          rect: WHOLE_IMAGE,
          source: { covers: WHOLE_IMAGE, region: { page: 17, u0: 0.2, v0: 0.2, u1: 0.4, v1: 0.4 } },
        },
      ],
    },
  };
  const key = imagePreviewKey([first]);
  expect(key).toBeDefined();
  expect(imagePreviewKey([relocated])).toBe(key);
  expect(imagePreviewKey([{ ...first, plan: { ...first.plan, level: 128 } }])).not.toBe(key);
  expect(imagePreviewKey([{ ...first, contentIdentity: 'replacement' }])).not.toBe(key);
  expect(
    imagePreviewKey([
      { ...first, residents: [{ key: 'photo|L512', identity: 1, widthPx: 128, heightPx: 512 }] },
    ]),
  ).not.toBe(key);
  expect(
    imagePreviewKey([
      {
        ...first,
        binding: {
          ...first.binding,
          parts: [{ rect: { ...WHOLE_IMAGE, maxU: 0.5 }, source: first.binding.parts[0]?.source }],
        },
      },
    ]),
  ).not.toBe(key);
});

it('refuses duplicate object identities and bounded output overflow', () => {
  const first = evidence();
  expect(imagePreviewKey([first, first])).toBeUndefined();
  expect(
    imagePreviewKey([{ ...first, contentIdentity: 'a'.repeat(4 * 1024 * 1024) }]),
  ).toBeUndefined();
});
