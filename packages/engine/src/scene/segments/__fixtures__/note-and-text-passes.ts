// Two stand-in passes with the prototype's z-order problem: an opaque
// note pass registered before a text pass, so without segments all text draws over all notes.
// Both reuse the solid-rect pipeline; only their names, record counts and occluder flags matter
// to the fake backend. Plus builders for the sticky and text objects they draw.
import type { BoardObject, ObjectId, PrincipalId, StickyObject, TextObject } from '@canvas/schema';

import type { ScenePass } from '../../scene-pass.js';
import { SOLID_RECT_PASS } from '../../solid-rect-pass.js';

/** Draws each sticky's background as one record; a sticky is an opaque occluder. */
export const NOTE_PASS: ScenePass = {
  ...SOLID_RECT_PASS,
  name: 'note',
  recordCount: (object: BoardObject) => (object.type === 'sticky' ? 1 : 0),
  isOccluder: (object: BoardObject) => object.type === 'sticky',
};

/** Draws one record per character of a text box or a sticky's text; text occludes nothing. */
export const TEXT_PASS: ScenePass = {
  ...SOLID_RECT_PASS,
  name: 'text',
  recordCount: (object: BoardObject) =>
    object.type === 'text' || object.type === 'sticky' ? object.text.length : 0,
  isOccluder: () => false,
};

/** Overrides for a fixture object. */
type Overrides<T extends BoardObject> = Partial<Omit<T, 'id' | 'type'>>;

const STYLE = {
  fontFamily: 'Inter',
  fontSize: 16,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

function textFields(text: string) {
  return {
    parentId: null,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:fixture' as PrincipalId,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    width: 100,
    height: 100,
    text,
    runs: [{ length: text.length, style: STYLE }],
    align: 'left',
    autoWidth: false,
    verticalAlign: 'top',
  } as const;
}

/**
 * A text box whose text is `text`, one record per character in {@link TEXT_PASS}.
 *
 * @param id - The object id.
 * @param overrides - Fields to change; a new `text` gets one run covering it.
 * @returns The text object.
 */
export function textObject(id: string, overrides: Overrides<TextObject> = {}): TextObject {
  return {
    ...textFields(overrides.text ?? 'ab'),
    id: id as ObjectId,
    type: 'text',
    ...overrides,
  } as TextObject;
}

/**
 * A yellow sticky note, with no text unless given: one record in {@link NOTE_PASS}, one per
 * character in {@link TEXT_PASS}.
 *
 * @param id - The object id.
 * @param overrides - Fields to change; a new `text` gets one run covering it.
 * @returns The sticky.
 */
export function stickyObject(id: string, overrides: Overrides<StickyObject> = {}): StickyObject {
  return {
    ...textFields(overrides.text ?? ''),
    id: id as ObjectId,
    type: 'sticky',
    color: [1, 0.92, 0.55, 1],
    ...overrides,
  } as StickyObject;
}
