// A face belongs to its family: the restyle rule shared by override resolution, preset
// merging, formatText and the editor, and the override paths a review named.
import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId, PrincipalId } from '../index.js';
import { applyInstanceOverride } from '../instances/override-content.js';
import { mergeOverrideRecords } from '../instances/override-merge.js';

import { restyledFace, withPostScriptName } from './postscript-name.js';
import type { TextStyle } from './text-style.js';

const FACE = 'InterDisplay-Regular';
const STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 16,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
  postScriptName: FACE,
};

/**
 * A text in one run of the given style.
 *
 * @param style - The run's style.
 * @returns The text.
 */
function textIn(style: TextStyle): BoardObject {
  return {
    id: 'title' as ObjectId,
    type: 'text',
    parentId: null,
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:ada' as PrincipalId,
    createdAt: 1,
    updatedAt: 1,
    text: 'Hi',
    runs: [{ length: 2, style }],
    align: 'left',
    autoWidth: true,
    verticalAlign: 'top',
  };
}

/**
 * The face of an overridden text's first run.
 *
 * @param object - The overridden object.
 * @returns Its face name, if any.
 */
function faceOf(object: BoardObject): string | undefined {
  return object.type === 'text' ? object.runs[0]?.style.postScriptName : undefined;
}

describe('restyledFace', () => {
  it('keeps the face unless the family moves or the patch names one', () => {
    expect(restyledFace(STYLE, {})).toBe(FACE);
    expect(restyledFace(STYLE, { fontFamily: 'Inter' })).toBe(FACE);
    expect(restyledFace(STYLE, { fontFamily: 'Lora' })).toBeUndefined();
    expect(restyledFace(STYLE, { fontFamily: 'Lora', postScriptName: 'Lora-Bold' })).toBe(
      'Lora-Bold',
    );
    expect(restyledFace(STYLE, { postScriptName: null })).toBeUndefined();
  });

  it('sets or removes a face without changing the style', () => {
    expect(withPostScriptName(STYLE, undefined)).not.toHaveProperty('postScriptName');
    expect(withPostScriptName(STYLE, 'Inter-Bold').postScriptName).toBe('Inter-Bold');
    expect(STYLE.postScriptName).toBe(FACE);
  });
});

describe('a face in instance overrides', () => {
  it('drops the source face when an override moves the text to another family', () => {
    const source = textIn(STYLE);
    expect(faceOf(applyInstanceOverride(source, { textStyle: { fontFamily: 'Lora' } }))).toBe(
      undefined,
    );
    expect(faceOf(applyInstanceOverride(source, { textStyle: { fontSize: 20 } }))).toBe(FACE);
    expect(
      faceOf(
        applyInstanceOverride(source, {
          textStyle: { fontFamily: 'Lora', postScriptName: 'Lora-Bold' },
        }),
      ),
    ).toBe('Lora-Bold');
  });

  it('drops an inner preset face when an outer one moves to another family', () => {
    const inner = { textStyle: { fontFamily: 'Inter', postScriptName: FACE } };
    expect(mergeOverrideRecords(inner, { textStyle: { fontFamily: 'Lora' } }).textStyle).toEqual({
      fontFamily: 'Lora',
    });
    expect(mergeOverrideRecords(inner, { textStyle: { fontFamily: 'Inter' } }).textStyle).toEqual(
      inner.textStyle,
    );
    expect(mergeOverrideRecords(inner, { textStyle: { fontSize: 20 } }).textStyle).toEqual({
      ...inner.textStyle,
      fontSize: 20,
    });
  });
});
