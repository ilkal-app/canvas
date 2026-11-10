// SetStyle's named style branches and the set commands' measured boxes, beside the
// acceptance tests (`named-style-commands.acceptance.test.ts`).
import { describe, expect, it } from 'vitest';

import type { Shadow, TextStyleValue } from '@canvas/schema';

import { createFixtureStore } from '../../store/__fixtures__/store-fixtures.js';
import { applyCommand, expectRejected, mustGet } from '../__fixtures__/command-fixtures.js';
import { setStyleCommand } from '../set-style.js';

import { setEffectStyleCommand, setTextStyleCommand } from './set-named-style.js';

const BODY: TextStyleValue = {
  fontFamily: 'Inter',
  fontSize: 20,
  weight: 500,
  italic: false,
  letterSpacing: { unit: 'px', value: 1 },
};
const LOW: Shadow = { x: 0, y: 8, blur: 24, spread: 0, color: [0, 0, 0, 0.34] };
const HIGH: Shadow = { x: 0, y: 1, blur: 2, spread: 0, color: [0, 0, 0, 0.2] };

const codes = (errors: readonly { code: string }[]): string[] => errors.map(({ code }) => code);

/**
 * The fixture board with a text style and a two-layer effect style.
 *
 * @returns The store and the styles' ids.
 */
function styledBoard() {
  const store = createFixtureStore();
  const text = applyCommand(store, setTextStyleCommand, { name: 'Body', value: BODY }).result.id;
  const effect = applyCommand(store, setEffectStyleCommand, {
    name: 'Float',
    value: { shadows: [LOW, HIGH] },
  }).result.id;
  return { store, text, effect };
}

describe('setStyle with named styles', () => {
  it('applies a text style with a field given beside it, leaving the runs unbound when it differs', () => {
    const { store, text } = styledBoard();
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'text-title', style: { textStyle: { textStyleId: text, fontSize: 30 } } }],
    });
    const title = mustGet(store, 'text-title');
    if (title.type !== 'text') throw new Error('text-title is a text');
    for (const run of title.runs) {
      expect(run.style).toMatchObject({
        fontSize: 30,
        weight: 500,
        letterSpacing: BODY.letterSpacing,
      });
      expect(run.style.textStyleId).toBeUndefined();
    }
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'text-title', style: { textStyle: { textStyleId: text, fontSize: 20 } } }],
    });
    const bound = mustGet(store, 'text-title');
    if (bound.type !== 'text') throw new Error('text-title is a text');
    expect(bound.runs.every((run) => run.style.textStyleId === text)).toBe(true);
    store.destroy();
  });

  it('keeps a style with no face bound when its own values are given beside it', () => {
    // The MCP inlines a style's values beside its id; a family given without a face clears the
    // run's face, which for a style with none is no change.
    const { store, text } = styledBoard();
    applyCommand(store, setStyleCommand, {
      changes: [
        {
          id: 'text-title',
          style: {
            textStyle: {
              ...BODY,
              lineHeight: 'auto',
              textStyleId: text,
            },
          },
        },
      ],
    });
    const title = mustGet(store, 'text-title');
    if (title.type !== 'text') throw new Error('text-title is a text');
    for (const run of title.runs) expect(run.style.textStyleId).toBe(text);
  });

  it('keeps an effect style for its own layers, detaches for others, and for null with a shadow', () => {
    const { store, effect } = styledBoard();
    const restyle = (style: Record<string, unknown>) =>
      applyCommand(store, setStyleCommand, { changes: [{ id: 'shape-box', style }] });
    restyle({ effectStyleId: effect, shadow: [LOW, HIGH] });
    expect(mustGet(store, 'shape-box')).toMatchObject({
      effectStyleId: effect,
      shadow: [LOW, HIGH],
    });
    restyle({ effectStyleId: effect, shadow: HIGH });
    expect(mustGet(store, 'shape-box')).toMatchObject({ effectStyleId: undefined, shadow: HIGH });
    restyle({ effectStyleId: effect });
    restyle({ effectStyleId: null, shadow: LOW });
    expect(mustGet(store, 'shape-box')).toMatchObject({ effectStyleId: undefined, shadow: LOW });
    store.destroy();
  });

  it('refuses measured boxes naming no object or one without a box of its own', () => {
    const { store, text } = styledBoard();
    const refused = (id: string) =>
      codes(
        expectRejected(store, setTextStyleCommand, {
          id: text,
          name: 'Body',
          value: BODY,
          measured: [{ id, width: 10, height: 10 }],
        }),
      );
    expect(refused('nowhere')).toEqual(['missing-object']);
    expect(refused('shape-box')).toEqual(['unsupported-type']);
    store.destroy();
  });
});
