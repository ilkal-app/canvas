// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import type { NewObject } from '@canvas/document';
import { copySelection } from '@canvas/document';
import type { AssetId, ObjectId, Point } from '@canvas/schema';

import { PAGE_COPIED_ASSETS } from '../assets/copied-assets.js';
import { CROSS_BOARD_NOT_COPIED_MESSAGE, NO_IMAGES_MESSAGE } from '../assets/page-images.js';

import { clipboardBoard } from './__fixtures__/clipboard-board.js';
import { encodeClipboardFlavours } from './clipboard-flavours.js';
import {
  CANVAS_OBJECTS_MIME_TYPE,
  HTML_MIME_TYPE,
  PLAIN_TEXT_MIME_TYPE,
  type ClipboardFlavours,
} from './clipboard-formats.js';
import {
  MAX_PASTE_MARKUP_LENGTH,
  MAX_PASTE_OBJECTS,
  MAX_PASTE_TEXT_LENGTH,
} from './clipboard-notice.js';
import { createDefaultPasteHandlers, registerPasteHandler } from './default-paste-handlers.js';
import { DEFAULT_PASTE_HANDLERS } from './default-paste-handlers.js';
import type { PasteItem, PasteTarget } from './paste-handlers.js';
import { PASTED_TEXT_STYLE } from './pasted-text.js';

/**
 * A paste target that records what it is asked to create.
 *
 * @param pointer - The pointer on the board, if on the canvas.
 * @param isRefusing - Whether the board refuses every paste at once (as mid-drag or busy).
 * @returns The target, the lists it created and the notices it was given.
 */
function recordingTarget(pointer?: Point, isRefusing = false) {
  const created: (readonly NewObject[])[] = [];
  const notices: string[] = [];
  const target: PasteTarget = {
    pointer,
    viewCentre: { x: -100, y: -100 },
    createObjects: (objects, onCreated) => {
      if (isRefusing) return false;
      created.push(objects);
      onCreated?.(objects.map((object, index) => `new-${String(index)}` as ObjectId));
      return true;
    },
    notify: (notice) => {
      notices.push(notice);
    },
  };
  return { target, created, notices };
}

/**
 * Clipboard flavours as paste items.
 *
 * @param flavours - The flavours.
 * @returns The items.
 */
function itemsOf(flavours: ClipboardFlavours): PasteItem[] {
  return [...flavours].map(([type, data]) => ({ kind: 'string', type, data }));
}

/**
 * The flavours of a copy of the fixture's group and title.
 *
 * @returns The flavours.
 */
function copiedFlavours(): ClipboardFlavours {
  const copied = copySelection(clipboardBoard(), ['group', 'title'] as ObjectId[]);
  return encodeClipboardFlavours(copied ?? clipboardBoard());
}

describe('the default paste handlers', () => {
  it('paste the objects flavour centred at the pointer, parents first', () => {
    const { target, created } = recordingTarget({ x: 0, y: 0 });
    expect(createDefaultPasteHandlers().dispatch(itemsOf(copiedFlavours()), target)).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]?.map(({ id }) => id)).toEqual(['group', 'left', 'right', 'title']);
  });

  it('paste 16 world units from the originals while the pointer is off the canvas', () => {
    const { target, created } = recordingTarget();
    createDefaultPasteHandlers().dispatch(itemsOf(copiedFlavours()), target);
    expect(created[0]?.find(({ id }) => id === 'title')).toMatchObject({ x: 16, y: 216 });
  });

  it('fall back to the objects embedded in the HTML when the objects flavour is missing', () => {
    const flavours = copiedFlavours();
    const { target, created } = recordingTarget({ x: 0, y: 0 });
    const html = flavours.get(HTML_MIME_TYPE) ?? '';
    createDefaultPasteHandlers().dispatch(
      [{ kind: 'string', type: HTML_MIME_TYPE, data: html }],
      target,
    );
    expect(created[0]).toHaveLength(4);
  });

  it('refuse a malformed objects flavour and paste the plain text instead', () => {
    const { target, created } = recordingTarget({ x: 50, y: 60 });
    const items: PasteItem[] = [
      { kind: 'string', type: CANVAS_OBJECTS_MIME_TYPE, data: '{"format":"canvas.board"}' },
      { kind: 'string', type: PLAIN_TEXT_MIME_TYPE, data: 'Hello\r\nworld' },
    ];
    expect(createDefaultPasteHandlers().dispatch(items, target)).toBe(true);
    expect(created).toEqual([
      [
        expect.objectContaining({
          type: 'text',
          text: 'Hello\nworld',
          runs: [{ length: 11, style: PASTED_TEXT_STYLE }],
        }),
      ],
    ]);
  });

  it('paste outside HTML as a text with its basic styles, at the view centre off the canvas', () => {
    const { target, created } = recordingTarget();
    const items: PasteItem[] = [
      { kind: 'string', type: PLAIN_TEXT_MIME_TYPE, data: 'Hi there' },
      { kind: 'string', type: HTML_MIME_TYPE, data: '<p><strong>Hi</strong> there</p>' },
    ];
    createDefaultPasteHandlers().dispatch(items, target);
    const [text] = created[0] ?? [];
    expect(text).toMatchObject({
      text: 'Hi there',
      runs: [
        { length: 2, style: { ...PASTED_TEXT_STYLE, weight: 700 } },
        { length: 6, style: PASTED_TEXT_STYLE },
      ],
    });
    // Centred on the view's centre (−100, −100).
    expect((text?.x ?? 0) + (text?.type === 'text' ? text.width / 2 : 0)).toBeCloseTo(-100);
  });

  it('take nothing from files, or HTML without text, in the text and objects handlers', () => {
    const { target, created } = recordingTarget();
    const file = new File(['x'], 'a.txt', { type: PLAIN_TEXT_MIME_TYPE });
    const items: PasteItem[] = [
      { kind: 'file', type: CANVAS_OBJECTS_MIME_TYPE, file },
      { kind: 'file', type: HTML_MIME_TYPE, file },
      { kind: 'file', type: PLAIN_TEXT_MIME_TYPE, file },
      { kind: 'string', type: HTML_MIME_TYPE, data: '<img src="a.png">' },
    ];
    expect(createDefaultPasteHandlers().dispatch(items, target)).toBe(false);
    expect(created).toEqual([]);
  });

  it('stop at a valid payload the board refuses, leaving the telling to it, and paste no text', () => {
    // The paste location tells the person why, with its counts: a second notice here
    // would repeat it.
    const { target, created, notices } = recordingTarget({ x: 0, y: 0 }, true);
    expect(createDefaultPasteHandlers().dispatch(itemsOf(copiedFlavours()), target)).toBe(true);
    expect(created).toEqual([]);
    expect(notices).toEqual([]);
  });

  it('skip a flavour over its limit so a smaller one is pasted, whatever the flavour', () => {
    const huge = 'x'.repeat(MAX_PASTE_MARKUP_LENGTH + 1);
    // The objects JSON and HTML over 4 MiB, each above plain text under 2 MiB.
    const overLimit = [
      [CANVAS_OBJECTS_MIME_TYPE, huge],
      [HTML_MIME_TYPE, huge],
    ] as const;
    for (const [type, data] of overLimit) {
      const { target, created, notices } = recordingTarget();
      const items: PasteItem[] = [
        { kind: 'string', type, data },
        { kind: 'string', type: PLAIN_TEXT_MIME_TYPE, data: 'fallback' },
      ];
      expect(createDefaultPasteHandlers().dispatch(items, target)).toBe(true);
      expect(created).toEqual([[expect.objectContaining({ type: 'text', text: 'fallback' })]]);
      expect(notices).toEqual([]);
    }
    // Every flavour over its limit: nothing takes the paste (the router then tells the person).
    const { target, created } = recordingTarget();
    const tooLong: PasteItem[] = [
      { kind: 'string', type: HTML_MIME_TYPE, data: huge },
      { kind: 'string', type: PLAIN_TEXT_MIME_TYPE, data: 'x'.repeat(MAX_PASTE_TEXT_LENGTH + 1) },
    ];
    expect(createDefaultPasteHandlers().dispatch(tooLong, target)).toBe(false);
    expect(created).toEqual([]);
  });

  // jsdom parses and lays out 2 MiB of HTML here: about 3 s alone, over 7 s in the full run
  // under load, so this test gets more than the default 5 s.
  it('take HTML up to the markup limit, twice the text limit', { timeout: 30_000 }, () => {
    const { target, created } = recordingTarget();
    const html = `<p>${'x'.repeat(MAX_PASTE_TEXT_LENGTH + 1)}</p>`;
    createDefaultPasteHandlers().dispatch(
      [{ kind: 'string', type: HTML_MIME_TYPE, data: html }],
      target,
    );
    expect(created).toHaveLength(1);
  });

  it('refuse an objects payload of more objects than a paste creates, with a notice', () => {
    const document = JSON.parse(copiedFlavours().get(CANVAS_OBJECTS_MIME_TYPE) ?? '{}') as {
      objects: unknown[];
    };
    const many = {
      ...document,
      objects: Array.from({ length: MAX_PASTE_OBJECTS + 1 }, () => document.objects[0]),
    };
    const { target, created, notices } = recordingTarget();
    const items: PasteItem[] = [
      { kind: 'string', type: CANVAS_OBJECTS_MIME_TYPE, data: JSON.stringify(many) },
      { kind: 'string', type: PLAIN_TEXT_MIME_TYPE, data: 'fallback' },
    ];
    expect(createDefaultPasteHandlers().dispatch(items, target)).toBe(true);
    expect([created, notices]).toEqual([
      [],
      ['This paste holds 5001 objects; a paste creates at most 5,000.'],
    ]);
  });

  it('take nothing from blank text', () => {
    const { target, created } = recordingTarget();
    const blank: PasteItem[] = [{ kind: 'string', type: PLAIN_TEXT_MIME_TYPE, data: '  \n ' }];
    expect(createDefaultPasteHandlers().dispatch(blank, target)).toBe(false);
    expect(created).toEqual([]);
  });

  it('take handlers registered for other types, such as images', () => {
    const file = new File(['png'], 'a.png', { type: 'image/png' });
    const seen: string[] = [];
    // Above the built-in image handler (200), which takes image files otherwise.
    const remove = registerPasteHandler('image/*', (item) => (seen.push(item.type), true), {
      priority: 250,
    });
    const items: PasteItem[] = [
      { kind: 'string', type: HTML_MIME_TYPE, data: '<img src="a.png">' },
      { kind: 'file', type: 'image/png', file },
    ];
    expect(DEFAULT_PASTE_HANDLERS.dispatch(items, recordingTarget().target)).toBe(true);
    remove();
    expect(seen).toEqual(['image/png']);
  });

  it('take an image file over the HTML a copied image comes with', () => {
    const file = new File(['png'], 'a.png', { type: 'image/png' });
    const items: PasteItem[] = [
      { kind: 'string', type: HTML_MIME_TYPE, data: '<img src="a.png">' },
      { kind: 'file', type: 'image/png', file },
    ];
    const { target, notices } = recordingTarget();
    expect(DEFAULT_PASTE_HANDLERS.dispatch(items, target)).toBe(true);
    // The recording target has no page images: the paste is taken, and the person told why.
    expect(notices).toEqual([NO_IMAGES_MESSAGE]);
  });

  it('link images across boards only for what the page copied, not on the clipboard’s claim', async () => {
    localStorage.clear();
    const photo = 'asset-photo' as AssetId;
    const items = itemsOf(
      encodeClipboardFlavours(
        copySelection(clipboardBoard(), ['photo'] as ObjectId[]) ?? clipboardBoard(),
        'victim-board',
      ),
    );
    const links: [readonly AssetId[], string][] = [];
    const paste = () => {
      const { target, created, notices } = recordingTarget();
      const claimed: PasteTarget = {
        ...target,
        boardId: 'board-a',
        sourceBoard: 'victim-board',
        images: {
          insert: () => undefined,
          wasCopiedFrom: (assets, board) => PAGE_COPIED_ASSETS.wasCopiedFrom(assets, board),
          linkFrom: (assets, source) => {
            links.push([assets, source]);
            return Promise.resolve();
          },
        },
      };
      createDefaultPasteHandlers().dispatch(items, claimed);
      return { created, notices };
    };
    const hostile = paste();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect([links, hostile.created, hostile.notices]).toEqual([
      [],
      [],
      [CROSS_BOARD_NOT_COPIED_MESSAGE],
    ]);
    PAGE_COPIED_ASSETS.record([photo], 'victim-board');
    const honest = paste();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(links).toEqual([[[photo], 'victim-board']]);
    expect(honest.created).toHaveLength(1);
    localStorage.clear();
  });
});
