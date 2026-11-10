import { describe, expect, it } from 'vitest';

import type { BoardObject, PrincipalId, StickyObject } from '@canvas/schema';
import { LINE_HEIGHT_EM, NOTE_PADDING } from '@canvas/text';

import {
  NO_STICKY_AUTHORS,
  STICKY_AUTHOR_MAX_CHARS,
  STICKY_AUTHOR_STYLE,
  stickyAuthorPlacement,
  stickyAuthorTextOf,
  type StickyAuthors,
} from '../../index.js';
import { shapeObject } from '../../scene/__fixtures__/scene-objects.js';

import { textObject } from './__fixtures__/text-objects.js';

function sticky(createdBy = 'user:ada', height = 200): StickyObject {
  return {
    ...textObject('note', 'Own note text', { createdBy: createdBy as PrincipalId }),
    type: 'sticky',
    width: 200,
    height,
    autoWidth: false,
    verticalAlign: 'middle',
    color: [1, 0.92, 0.55, 1],
  };
}

const AUTHORS: StickyAuthors = {
  isShown: true,
  names: new Map([['user:ada', '  Ada Lovelace  ']]),
  fallback: 'Former member',
};

describe('sticky author text', () => {
  it('defaults to hidden and never supplies text for other object kinds', () => {
    expect(NO_STICKY_AUTHORS).toEqual({
      isShown: false,
      names: new Map(),
      fallback: 'Former member',
    });
    expect(stickyAuthorTextOf(sticky(), NO_STICKY_AUTHORS)).toBeUndefined();
    for (const object of [shapeObject('shape'), textObject('text', 'hello')] as BoardObject[]) {
      expect(stickyAuthorTextOf(object, AUTHORS)).toBeUndefined();
    }
  });

  it('uses a trimmed display name and the fallback for an unknown principal', () => {
    expect(stickyAuthorTextOf(sticky(), AUTHORS)).toBe('Ada Lovelace');
    expect(stickyAuthorTextOf(sticky('user:gone'), AUTHORS)).toBe('Former member');
    expect(stickyAuthorTextOf(sticky('user:gone'), { ...AUTHORS, fallback: '  ' })).toBeUndefined();
    expect(
      stickyAuthorTextOf(sticky(), { ...AUTHORS, names: new Map([['user:ada', '  ']]) }),
    ).toBeUndefined();
  });

  it('cuts at 32 Unicode code points with an ellipsis after 31', () => {
    expect(STICKY_AUTHOR_MAX_CHARS).toBe(32);
    const exact = '😀'.repeat(32);
    expect(
      stickyAuthorTextOf(sticky(), { ...AUTHORS, names: new Map([['user:ada', exact]]) }),
    ).toBe(exact);
    expect(
      stickyAuthorTextOf(sticky(), { ...AUTHORS, names: new Map([['user:ada', `${exact}😀`]]) }),
    ).toBe(`${'😀'.repeat(31)}…`);
  });
});

describe('sticky author placement', () => {
  it('places one unwrapped caption run inside the bottom-left padding in world units', () => {
    const note = sticky('user:ada', 240);
    const text = 'Ada 😀';
    expect(STICKY_AUTHOR_STYLE).toEqual({
      fontFamily: 'Liberation Sans',
      fontSize: 11,
      color: [0.38, 0.39, 0.42, 1],
      weight: 400,
      italic: false,
    });
    expect(stickyAuthorPlacement(note, text)).toEqual({
      text,
      runs: [{ length: text.length, style: STICKY_AUTHOR_STYLE }],
      wrapWidth: null,
      align: 'left',
      direction: 'auto',
      verticalAlign: 'top',
      boxHeight: 11 * LINE_HEIGHT_EM,
      origin: { x: NOTE_PADDING, y: note.height - NOTE_PADDING - 11 * LINE_HEIGHT_EM },
    });
    expect(stickyAuthorPlacement(shapeObject('shape'), text)).toBeUndefined();
  });
});
