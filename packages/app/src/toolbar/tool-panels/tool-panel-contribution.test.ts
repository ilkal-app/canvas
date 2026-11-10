// Which exports the tool panel registry takes: a component for the
// contents, a function or a `memo`, never a plain object.
import { memo } from 'react';
import { describe, expect, it } from 'vitest';

import type { ToolPanelChoiceCodec } from '../../state/tool-panel-choices.js';

import { isToolPanelContribution } from './tool-panel-contribution.js';

const CODEC: ToolPanelChoiceCodec<null> = { id: 'sticky', defaults: null, parse: () => null };

/**
 * The panel's contents.
 *
 * @returns Nothing.
 */
function contents(): null {
  return null;
}

describe('isToolPanelContribution', () => {
  it('takes a function or memo component as the contents', () => {
    expect(isToolPanelContribution({ id: 'sticky', label: 'Sticky', codec: CODEC, contents })).toBe(
      true,
    );
    expect(
      isToolPanelContribution({
        id: 'sticky',
        label: 'Sticky',
        codec: CODEC,
        contents: memo(contents),
      }),
    ).toBe(true);
  });

  it('refuses a plain object as the contents', () => {
    expect(
      isToolPanelContribution({ id: 'sticky', label: 'Sticky', codec: CODEC, contents: {} }),
    ).toBe(false);
  });
});
