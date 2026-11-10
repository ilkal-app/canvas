import { describe, expect, it } from 'vitest';

import type { NewObject } from '@canvas/document';
import type { ObjectId, TextStyle } from '@canvas/schema';
import { RUNS_MIME_TYPE, serializeRunsPayload } from '@canvas/tools';

import { createDefaultPasteHandlers } from '../clipboard/default-paste-handlers.js';
import type { PasteItem, PasteTarget } from '../clipboard/paste-handlers.js';

import { pasteRunsFlavour } from './runs-paste-handler.js';

const BOLD: TextStyle = {
  fontFamily: 'Lora',
  fontSize: 32,
  color: [1, 0, 0, 1],
  weight: 700,
  italic: false,
};
const PLAIN: TextStyle = { ...BOLD, weight: 400, fontSize: 16 };

/**
 * A paste target that records what it is asked to create.
 *
 * @param isRefusing - Whether the board refuses every paste.
 * @returns The target, the lists it created and the notices it was given.
 */
function recordingTarget(isRefusing = false) {
  const created: (readonly NewObject[])[] = [];
  const notices: string[] = [];
  const target: PasteTarget = {
    pointer: { x: 100, y: 50 },
    viewCentre: { x: 0, y: 0 },
    createObjects: (objects, onCreated) => {
      if (isRefusing) return false;
      created.push(objects);
      onCreated?.(
        objects.map((object, index) => (object.id ?? `new-${String(index)}`) as ObjectId),
      );
      return true;
    },
    notify: (notice) => {
      notices.push(notice);
    },
  };
  return { target, created, notices };
}

const STYLED = serializeRunsPayload({
  text: 'Hi there',
  runs: [
    { length: 2, style: BOLD },
    { length: 6, style: PLAIN },
  ],
});

describe('pasteRunsFlavour', () => {
  it('pastes the styled runs as a text object at the pointer', () => {
    const { target, created } = recordingTarget();
    const item: PasteItem = { kind: 'string', type: RUNS_MIME_TYPE, data: STYLED };
    expect(pasteRunsFlavour(item, target)).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]?.[0]).toMatchObject({
      type: 'text',
      text: 'Hi there',
      runs: [
        { length: 2, style: BOLD },
        { length: 6, style: PLAIN },
      ],
      autoWidth: true,
    });
  });

  it('leaves a malformed payload to the next flavour, and the telling of a refusal to the board', () => {
    const malformed = recordingTarget();
    const bad: PasteItem = { kind: 'string', type: RUNS_MIME_TYPE, data: '{"text":"a"}' };
    expect(pasteRunsFlavour(bad, malformed.target)).toBe(false);
    expect(malformed.created).toEqual([]);
    const refusing = recordingTarget(true);
    const good: PasteItem = { kind: 'string', type: RUNS_MIME_TYPE, data: STYLED };
    expect(pasteRunsFlavour(good, refusing.target)).toBe(true);
    // The paste location tells the person why, with its counts.
    expect(refusing.notices).toEqual([]);
  });

  it('is preferred over plain text among the default paste handlers', () => {
    const { target, created } = recordingTarget();
    const items: PasteItem[] = [
      { kind: 'string', type: 'text/plain', data: 'Hi there' },
      { kind: 'string', type: RUNS_MIME_TYPE, data: STYLED },
    ];
    expect(createDefaultPasteHandlers().dispatch(items, target)).toBe(true);
    expect(created[0]?.[0]).toMatchObject({ runs: [{ style: BOLD }, { style: PLAIN }] });
  });

  it('pastes a copied list as a list', () => {
    const { target, created } = recordingTarget();
    const data = serializeRunsPayload({
      text: 'a\nb',
      runs: [{ length: 3, style: { ...PLAIN, underline: true } }],
      paragraphs: [{ list: 'bullet' }, { list: 'numbered', level: 1 }],
    });
    expect(pasteRunsFlavour({ kind: 'string', type: RUNS_MIME_TYPE, data }, target)).toBe(true);
    expect(created[0]?.[0]).toMatchObject({
      text: 'a\nb',
      runs: [{ length: 3, style: { ...PLAIN, underline: true } }],
      paragraphs: [{ list: 'bullet' }, { list: 'numbered', level: 1 }],
    });
  });
});
