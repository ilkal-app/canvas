import { describe, expect, it } from 'vitest';

import { importBoard, type BoardObject, type ObjectId, type TextStyle } from '@canvas/schema';

import { applyCommand, mustGet } from '../commands/__fixtures__/command-fixtures.js';
import { replaceFontFamilyCommand } from '../commands/replace-font-family.js';
import { setStyleCommand } from '../commands/set-style.js';
import { setTextStyleCommand } from '../commands/styles/set-named-style.js';
import { storeWith } from '../layout/__fixtures__/auto-layout-fixtures.js';
import * as meta from '../meta/document-meta.js';
import { createFixtureStore, ADA, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { createFixtureBoardJson } from './__fixtures__/fixture-board-json.js';
import {
  ATTRIBUTE_BASE_STYLE,
  isStoredTextStyle,
  styleFromAttributes,
  stylePatchToAttributes,
  styleToAttributes,
} from './style-attributes.js';

const FACE = 'InterDisplay-Regular';
const ID = 'text-title' as ObjectId;

/**
 * The selected face on the first run of the fixture title.
 *
 * @param store - The document to inspect.
 * @returns The selected face, if any.
 */
function firstFace(store: ReturnType<typeof createFixtureStore>): unknown {
  const object = store.get(ID);
  return object?.type === 'text'
    ? (object.runs[0]?.style as unknown as Record<string, unknown>).postScriptName
    : undefined;
}

describe('PostScript name in the document', () => {
  it('writes one Y.Text attribute, omits absent values, and validates reads', () => {
    const style = { ...ATTRIBUTE_BASE_STYLE, postScriptName: FACE } as TextStyle;
    expect(styleToAttributes(ATTRIBUTE_BASE_STYLE)).toEqual({});
    expect(styleToAttributes(style)).toEqual({ postScriptName: FACE });
    expect(stylePatchToAttributes({ postScriptName: FACE })).toEqual({
      postScriptName: FACE,
    });
    expect(styleFromAttributes({ postScriptName: FACE })).toEqual(style);
    expect(isStoredTextStyle(style)).toBe(true);
    expect(styleFromAttributes({ postScriptName: 'Bad/Face' })).toEqual(ATTRIBUTE_BASE_STYLE);
    expect(isStoredTextStyle({ ...ATTRIBUTE_BASE_STYLE, postScriptName: 'Bad/Face' })).toBe(false);
  });

  it('formatText splits a range and carries the face through sync', () => {
    const first = createFixtureStore();
    const second = new YjsDocumentStore();
    try {
      first.transact(ADA, (transaction) => {
        transaction.formatText(ID, 0, 3, { postScriptName: FACE });
      });
      const object = first.get(ID);
      expect(object?.type === 'text' && object.runs[0]?.length).toBe(3);
      expect(firstFace(first)).toBe(FACE);
      second.applyUpdate(first.encodeState(), RELAY);
      const synced = second.get(ID);
      expect(
        synced?.type === 'text' &&
          (synced.runs[0]?.style as unknown as Record<string, unknown>).postScriptName,
      ).toBe(FACE);
    } finally {
      first.destroy();
      second.destroy();
    }
  });

  it('clears an old face when restyling its family unless the patch selects a new face', () => {
    const store = createFixtureStore();
    try {
      applyCommand(store, setStyleCommand, {
        changes: [{ id: ID, style: { textStyle: { postScriptName: FACE } } }],
      });
      expect(firstFace(store)).toBe(FACE);
      applyCommand(store, setStyleCommand, {
        changes: [{ id: ID, style: { textStyle: { fontFamily: 'Lora' } } }],
      });
      expect(firstFace(store)).toBeUndefined();
      applyCommand(store, setStyleCommand, {
        changes: [
          {
            id: ID,
            style: { textStyle: { fontFamily: 'Inter', postScriptName: 'InterNarrow-Regular' } },
          },
        ],
      });
      expect(firstFace(store)).toBe('InterNarrow-Regular');
    } finally {
      store.destroy();
    }
  });

  it('replaceFontFamily clears names from runs and named styles it moves', () => {
    const store = createFixtureStore();
    try {
      const named = applyCommand(store, setTextStyleCommand, {
        name: 'Display',
        value: {
          fontFamily: 'Inter',
          fontSize: 24,
          weight: 400,
          italic: false,
          postScriptName: FACE,
        },
      } as never).result.id;
      applyCommand(store, setStyleCommand, {
        changes: [{ id: ID, style: { textStyle: { postScriptName: FACE } } }],
      });
      applyCommand(store, replaceFontFamilyCommand, { from: 'Inter', to: 'Lora' });
      expect(firstFace(store)).toBeUndefined();
      expect(store.readTextStyles().get(named)?.value).not.toHaveProperty('postScriptName');
      // The fixture title has two runs (fixed after the acceptance commit): every one moves.
      const moved = mustGet(store, ID);
      expect(moved.type === 'text' && moved.runs.map(({ style }) => style.fontFamily)).toEqual([
        'Lora',
        'Lora',
      ]);
    } finally {
      store.destroy();
    }
  });

  it('replaceFontFamily clears names in override runs and variant presets', () => {
    const black: [number, number, number, number] = [0, 0, 0, 1];
    const faceRunStyle = {
      fontFamily: 'Inter',
      fontSize: 16,
      color: black,
      weight: 400 as const,
      italic: false,
      postScriptName: FACE,
    };
    const instanceOverrides = {
      'sticky-idea': { text: 'x', runs: [{ length: 1, style: faceRunStyle }] },
      'text-title': { textStyle: { fontFamily: 'Inter', postScriptName: FACE } },
    };
    const variantPresets = {
      'state=hover': { 'text-title': { textStyle: { fontFamily: 'Inter', postScriptName: FACE } } },
    };
    const objects = [...importBoard(createFixtureBoardJson(true)).objects.values()].map(
      (object): BoardObject => {
        if (object.type === 'instance' && object.id === 'instance-card')
          return {
            ...object,
            overrides: instanceOverrides,
          };
        if (object.type === 'component' && object.id === 'component-card')
          return {
            ...object,
            variantAxes: [{ name: 'state', values: ['rest', 'hover'] }],
            variantPresets,
          };
        return object;
      },
    );
    const store = storeWith(...objects);
    try {
      applyCommand(store, replaceFontFamilyCommand, { from: 'Inter', to: 'Lora' });
      const instance = mustGet(store, 'instance-card');
      const main = mustGet(store, 'component-card');
      expect(instance).toMatchObject({
        overrides: {
          'sticky-idea': { runs: [{ style: { fontFamily: 'Lora' } }] },
          'text-title': { textStyle: { fontFamily: 'Lora' } },
        },
      });
      expect(instance).not.toHaveProperty('overrides.sticky-idea.runs.0.style.postScriptName');
      expect(instance).not.toHaveProperty('overrides.text-title.textStyle.postScriptName');
      expect(main).toMatchObject({
        variantPresets: { 'state=hover': { 'text-title': { textStyle: { fontFamily: 'Lora' } } } },
      });
      expect(main).not.toHaveProperty(
        'variantPresets.state=hover.text-title.textStyle.postScriptName',
      );
    } finally {
      store.destroy();
    }
  });

  it('gates layout 25 and continues reading the preceding layout', () => {
    const version = (meta as unknown as Record<string, number>).POSTSCRIPT_NAME_LAYOUT_VERSION ?? 0;
    expect(version).toBe(25);
    expect(meta.DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(version);
    expect(meta.READABLE_LAYOUT_VERSIONS).toContain(24);
  });
});
