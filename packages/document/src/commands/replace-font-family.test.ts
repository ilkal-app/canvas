// `replaceFontFamily` replaces a board's family everywhere it is named, in one undo
// step, keeping every other field and a run's text style; locked objects and an agent's
// not-own text styles are left and reported.
import { describe, expect, it } from 'vitest';

import {
  boardFontFamilies,
  importBoard,
  type BoardObject,
  type PrincipalId,
  type TextStyleValue,
} from '@canvas/schema';

import { createFixtureBoardJson } from '../codec/__fixtures__/fixture-board-json.js';
import { createHistory } from '../history/undo-manager.js';
import { storeWith } from '../layout/__fixtures__/auto-layout-fixtures.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';
import type { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected, mustGet } from './__fixtures__/command-fixtures.js';
import { replaceFontFamilyCommand } from './replace-font-family.js';
import { setStyleCommand } from './set-style.js';
import { setTextStyleCommand } from './styles/set-named-style.js';

const AGENT = {
  kind: 'agent',
  principalId: 'agent:helper' as PrincipalId,
  operatorId: ADA.principalId,
} as const;

const BODY_STYLE: TextStyleValue = {
  fontFamily: 'Inter',
  fontSize: 24,
  weight: 400,
  italic: false,
};

/** A run's colour. */
const BLACK: [number, number, number, number] = [0, 0, 0, 1];

/** Override runs in two families, the first to replace. */
const MIXED_RUNS = [
  { length: 1, style: { ...BODY_STYLE, color: BLACK } },
  { length: 1, style: { ...BODY_STYLE, fontFamily: 'Lora', color: BLACK } },
];

/**
 * The fixture board with its main and instance, the instance overriding the title's family and
 * the main's `state=hover` preset naming it too.
 *
 * @param edit - Changes to objects by id before writing.
 * @returns The store.
 */
function boardNamingInter(edit: Readonly<Record<string, object>> = {}): YjsDocumentStore {
  const objects = [...importBoard(createFixtureBoardJson(true)).objects.values()].map(
    (object): BoardObject => {
      if (object.id === 'instance-card') {
        return {
          ...object,
          overrides: {
            'text-title': { textStyle: { fontFamily: 'Inter', fontSize: 30 } },
            'sticky-idea': { text: 'ab', runs: MIXED_RUNS },
            'shape-box': { fill: [0, 1, 0, 1] },
          },
        } as BoardObject;
      }
      if (object.id === 'component-card') {
        return {
          ...object,
          variantAxes: [{ name: 'state', values: ['rest', 'hover'] }],
          variantPresets: {
            'state=hover': { 'text-title': { textStyle: { fontFamily: 'Inter' } } },
            'state=rest': { 'text-title': { isHidden: true } },
          },
        } as BoardObject;
      }
      return { ...object, ...edit[object.id] };
    },
  );
  return storeWith(...objects);
}

/**
 * The families the store's board names.
 *
 * @param store - The store.
 * @returns The family names.
 */
function familiesOf(store: YjsDocumentStore): string[] {
  return boardFontFamilies(store.read()).map(({ family }) => family);
}

describe('replaceFontFamily', () => {
  it('replaces the family everywhere, keeping every other field, in one undo step', () => {
    const store = boardNamingInter();
    const history = createHistory(store, ADA.principalId);
    const before = store.read();
    const { result } = applyCommand(store, replaceFontFamilyCommand, { from: 'Inter', to: 'Lora' });
    expect(result).toEqual({
      objectIds: [
        'component-card',
        'connector-flow',
        'instance-card',
        'shape-box',
        'sticky-idea',
        'text-title',
      ],
      textStyleIds: [],
      skipped: [],
    });
    expect(familiesOf(store)).toEqual(['Lora']);
    const title = mustGet(store, 'text-title');
    const original = before.objects.get(title.id);
    if (title.type !== 'text' || original?.type !== 'text') throw new Error('text-title is a text');
    expect(title.runs).toEqual(
      original.runs.map((run) => ({ ...run, style: { ...run.style, fontFamily: 'Lora' } })),
    );
    expect(mustGet(store, 'instance-card')).toMatchObject({
      overrides: {
        'text-title': { textStyle: { fontFamily: 'Lora', fontSize: 30 } },
        // Both runs are Lora now, so they merge into one.
        'sticky-idea': { runs: [{ length: 2, style: { ...MIXED_RUNS[1]?.style } }] },
        'shape-box': { fill: [0, 1, 0, 1] },
      },
    });
    expect(mustGet(store, 'component-card')).toMatchObject({
      variantPresets: { 'state=hover': { 'text-title': { textStyle: { fontFamily: 'Lora' } } } },
    });
    expect(history.undo()).toBe(true);
    expect(familiesOf(store)).toEqual(['Inter', 'Lora']);
    expect(store.read().objects).toEqual(before.objects);
    store.destroy();
  });

  it('rewrites a text style naming the family and keeps its runs bound to it', () => {
    const store = boardNamingInter();
    const style = applyCommand(store, setTextStyleCommand, { name: 'Body', value: BODY_STYLE })
      .result.id;
    const caption = applyCommand(store, setTextStyleCommand, {
      name: 'Caption',
      value: { ...BODY_STYLE, fontSize: 12 },
    }).result.id;
    // A style in another family is left as it is.
    const code = applyCommand(store, setTextStyleCommand, {
      name: 'Code',
      value: { ...BODY_STYLE, fontFamily: 'JetBrains Mono' },
    }).result.id;
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'sticky-idea', style: { textStyle: { textStyleId: style } } }],
    });
    const { result } = applyCommand(store, replaceFontFamilyCommand, { from: 'Inter', to: 'Lora' });
    expect(result.textStyleIds).toEqual([style, caption].sort());
    expect(store.readTextStyles().get(style)?.value).toEqual({ ...BODY_STYLE, fontFamily: 'Lora' });
    expect(store.readTextStyles().get(code)?.value.fontFamily).toBe('JetBrains Mono');
    const sticky = mustGet(store, 'sticky-idea');
    if (sticky.type !== 'sticky') throw new Error('sticky-idea is a sticky');
    expect(sticky.runs.every((run) => run.style.textStyleId === style)).toBe(true);
    expect(sticky.runs.every((run) => run.style.fontFamily === 'Lora')).toBe(true);
    store.destroy();
  });

  it('leaves a locked object and reports it', () => {
    const store = boardNamingInter({ 'sticky-idea': { locked: true } });
    const size = mustGet(store, 'sticky-idea');
    if (size.type !== 'sticky') throw new Error('sticky-idea is a sticky');
    const { result } = applyCommand(store, replaceFontFamilyCommand, {
      from: 'Inter',
      to: 'Lora',
      measured: [{ id: 'sticky-idea', width: 999, height: 999 }],
    });
    expect(result.skipped).toEqual([{ id: 'sticky-idea', reason: 'locked' }]);
    // A box measured for a locked object is not written: it keeps its family and size.
    expect(mustGet(store, 'sticky-idea')).toMatchObject({ width: size.width, height: size.height });
    expect(result.objectIds).not.toContain('sticky-idea');
    expect(familiesOf(store)).toEqual(['Inter', 'Lora']);
    store.destroy();
  });

  it('leaves an agent a text style it did not create, detaching the runs it rewrites', () => {
    const store = boardNamingInter();
    const style = applyCommand(store, setTextStyleCommand, { name: 'Body', value: BODY_STYLE })
      .result.id;
    applyCommand(store, setStyleCommand, {
      changes: [{ id: 'sticky-idea', style: { textStyle: { textStyleId: style } } }],
    });
    const { result } = applyCommand(
      store,
      replaceFontFamilyCommand,
      { from: 'Inter', to: 'Lora' },
      AGENT,
    );
    // Ada's main is the agent's to leave too, as the command layer would refuse writing it.
    expect(result.skipped).toEqual([
      { id: 'component-card', reason: 'not-own-main' },
      { id: style, reason: 'not-own-style' },
    ]);
    expect(store.readTextStyles().get(style)?.value.fontFamily).toBe('Inter');
    const sticky = mustGet(store, 'sticky-idea');
    if (sticky.type !== 'sticky') throw new Error('sticky-idea is a sticky');
    // Its runs no longer match the style, so they no longer name it.
    expect(sticky.runs.every((run) => run.style.textStyleId === undefined)).toBe(true);
    expect(sticky.runs.every((run) => run.style.fontFamily === 'Lora')).toBe(true);
    store.destroy();
  });

  it('writes measured boxes in the same step', () => {
    const store = boardNamingInter();
    applyCommand(store, replaceFontFamilyCommand, {
      from: 'Inter',
      to: 'Lora',
      measured: [{ id: 'text-title', width: 321, height: 45 }],
    });
    expect(mustGet(store, 'text-title')).toMatchObject({ width: 321, height: 45 });
    store.destroy();
  });

  it('changes nothing for a family the board does not name', () => {
    const store = boardNamingInter();
    const { result } = applyCommand(store, replaceFontFamilyCommand, { from: 'Nope', to: 'Lora' });
    expect(result).toEqual({ objectIds: [], textStyleIds: [], skipped: [] });
    expect(familiesOf(store)).toEqual(['Inter', 'Lora']);
    store.destroy();
  });

  it('plans nothing on a reader that cannot list the board', () => {
    const validation = replaceFontFamilyCommand.validate(
      {
        board: { get: () => undefined, references: () => [] } as never,
        origin: ADA,
        now: 0,
        createId: () => {
          throw new Error('no ids');
        },
      },
      { from: 'Inter', to: 'Lora' },
    );
    expect(validation).toMatchObject({
      isValid: true,
      plan: { ranges: [], records: [], styles: [], skipped: [], objectIds: [] },
    });
  });

  it('refuses the same family as both, and a measured id that is missing or has no box', () => {
    const store = boardNamingInter();
    const codes = (input: object) =>
      expectRejected(store, replaceFontFamilyCommand, input).map(({ code }) => code);
    expect(codes({ from: 'Inter', to: 'Inter' })).toEqual(['invalid-input']);
    expect(
      codes({ from: 'Inter', to: 'Lora', measured: [{ id: 'gone', width: 1, height: 1 }] }),
    ).toEqual(['missing-object']);
    expect(
      codes({ from: 'Inter', to: 'Lora', measured: [{ id: 'line-divider', width: 1, height: 1 }] }),
    ).toEqual(['unsupported-type']);
    store.destroy();
  });
});
