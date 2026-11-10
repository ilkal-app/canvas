import { describe, expect, it } from 'vitest';

import { compareSiblings, isValidKey, MAX_KEY_LENGTH, type ObjectId } from '@canvas/schema';

import { createTextModeContext, tenPointText } from './__fixtures__/text-mode-context.js';
import { DRAFT_PREVIEW_Z, draftTextObject } from './text-session-object.js';

const id = (value: string) => value as ObjectId;

describe('DRAFT_PREVIEW_Z', () => {
  it('stacks a draft above every valid key, however long, and is no valid key itself', () => {
    const tops = ['z', 'zzzzzzzz', 'z'.repeat(MAX_KEY_LENGTH), 'Zzzz', 'a0'];
    for (const z of tops) {
      expect(
        compareSiblings({ id: id('draft'), z: DRAFT_PREVIEW_Z }, { id: id('top'), z }),
      ).toBeGreaterThan(0);
    }
    expect(isValidKey(DRAFT_PREVIEW_Z)).toBe(false);
  });

  it('is the key a text tool draft is previewed with', () => {
    const { context } = createTextModeContext();
    const draft = draftTextObject(context, tenPointText('unused', ''));
    expect(draft.z).toBe(DRAFT_PREVIEW_Z);
  });
});
