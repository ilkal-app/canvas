// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { copySelection } from '@canvas/document';
import { type AssetId, type ObjectId } from '@canvas/schema';

import { clipboardBoard } from './__fixtures__/clipboard-board.js';
import { encodeClipboardFlavours } from './clipboard-flavours.js';
import {
  CANVAS_BOARD_MIME_TYPE,
  CANVAS_OBJECTS_MIME_TYPE,
  EMBEDDED_BOARD_ATTRIBUTE,
  HTML_MIME_TYPE,
  type ClipboardFlavours,
} from './clipboard-formats.js';
import { bindClipboardRouter, type ClipboardRouter } from './clipboard-router.js';
import type { ClipboardSource } from './clipboard-source.js';
import { createDefaultPasteHandlers } from './default-paste-handlers.js';
import { PasteHandlerRegistry, type PasteTarget } from './paste-handlers.js';

const routers: ClipboardRouter[] = [];

afterEach(() => {
  for (const router of routers.splice(0)) router.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/**
 * Sends a real router paste event with the supplied string flavours.
 *
 * @param flavours - The clipboard's strings.
 * @param target - The engine's paste target.
 * @param handlers - The registry to receive the paste.
 * @returns The dispatched event.
 */
function paste(
  flavours: ClipboardFlavours,
  target: PasteTarget,
  handlers = createDefaultPasteHandlers(),
) {
  const root = document.createElement('div');
  document.body.append(root);
  const source = {
    copy: () => undefined,
    prepareCut: () => ({ kind: 'empty' as const }),
    pasteTarget: () => target,
  } satisfies ClipboardSource;
  routers.push(
    bindClipboardRouter(root, { source: () => source, isEnabled: () => true, handlers }),
  );
  const data = {
    types: [...flavours.keys()],
    files: [],
    getData: (type: string) => flavours.get(type) ?? '',
  };
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: data });
  root.dispatchEvent(event);
  return event;
}

/**
 * The objects and HTML of a canvas copy, without the board flavour.
 *
 * @param objectId - The fixture object to copy.
 * @param sourceBoard - The source board written into HTML.
 * @returns The clipboard flavours.
 * @throws {Error} When the fixture object is missing.
 */
function htmlBoardCopy(objectId: string, sourceBoard = 'board-b'): Map<string, string> {
  const board = clipboardBoard();
  const selected = copySelection(board, [objectId as ObjectId]);
  if (selected === undefined) throw new Error('fixture selection is missing');
  const flavours = new Map(encodeClipboardFlavours(selected, sourceBoard));
  flavours.delete(CANVAS_BOARD_MIME_TYPE);
  return flavours;
}

function target(fields: Partial<PasteTarget> = {}): PasteTarget {
  return {
    pointer: undefined,
    viewCentre: { x: 0, y: 0 },
    createObjects: () => true,
    notify: vi.fn(),
    ...fields,
  };
}

describe('source board through the clipboard router', () => {
  it('does not parse HTML for an objects paste without images onto a target without a board id', () => {
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');
    const event = paste(htmlBoardCopy('outside'), target());

    expect(event.defaultPrevented).toBe(true);
    expect(parse).not.toHaveBeenCalled();
  });

  it('reads the HTML board attribute once when a handler reads sourceBoard twice', () => {
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');
    const reads: (string | undefined)[] = [];
    const handlers = new PasteHandlerRegistry();
    handlers.register(CANVAS_OBJECTS_MIME_TYPE, (item, received) => {
      expect(item.type).toBe(CANVAS_OBJECTS_MIME_TYPE);
      reads.push(received.sourceBoard, received.sourceBoard);
      return true;
    });

    expect(paste(htmlBoardCopy('outside'), target(), handlers).defaultPrevented).toBe(true);
    expect(reads).toEqual(['board-b', 'board-b']);
    expect(parse).toHaveBeenCalledOnce();
  });

  it('caches an absent HTML board attribute when a handler reads sourceBoard twice', () => {
    const board = clipboardBoard();
    const selected = copySelection(board, ['outside' as ObjectId]);
    if (selected === undefined) throw new Error('fixture selection is missing');
    const flavours = encodeClipboardFlavours(selected);
    expect(flavours.has(CANVAS_BOARD_MIME_TYPE)).toBe(false);
    expect(flavours.get(HTML_MIME_TYPE)).not.toContain(EMBEDDED_BOARD_ATTRIBUTE);
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');
    const reads: (string | undefined)[] = [];
    const handlers = new PasteHandlerRegistry();
    handlers.register(CANVAS_OBJECTS_MIME_TYPE, (item, received) => {
      expect(item.type).toBe(CANVAS_OBJECTS_MIME_TYPE);
      reads.push(received.sourceBoard, received.sourceBoard);
      return true;
    });

    expect(paste(flavours, target(), handlers).defaultPrevented).toBe(true);
    expect(reads).toEqual([undefined, undefined]);
    expect(parse).toHaveBeenCalledOnce();
  });

  it('uses the trimmed board flavour without parsing the HTML attribute', () => {
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');
    const reads: (string | undefined)[] = [];
    const descriptors: PropertyDescriptor[] = [];
    const handlers = new PasteHandlerRegistry();
    handlers.register(CANVAS_OBJECTS_MIME_TYPE, (item, received) => {
      expect(item.type).toBe(CANVAS_OBJECTS_MIME_TYPE);
      const descriptor = Object.getOwnPropertyDescriptor(received, 'sourceBoard');
      if (descriptor !== undefined) descriptors.push(descriptor);
      reads.push(received.sourceBoard);
      return true;
    });
    const flavours = htmlBoardCopy('outside');
    flavours.set(CANVAS_BOARD_MIME_TYPE, '  board-from-flavour  ');

    expect(paste(flavours, target(), handlers).defaultPrevented).toBe(true);
    expect(descriptors[0]).toHaveProperty('get', expect.any(Function));
    expect(reads).toEqual(['board-from-flavour']);
    expect(parse).not.toHaveBeenCalled();
  });

  it('links images from the HTML source board before creating them on another board', async () => {
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');
    const calls: string[] = [];
    const imageTarget = target({
      boardId: 'board-a',
      createObjects: () => {
        calls.push('create');
        return true;
      },
      images: {
        insert: () => undefined,
        wasCopiedFrom: (assets, board) => {
          expect(assets).toEqual(['asset-photo' as AssetId]);
          expect(board).toBe('board-b');
          return true;
        },
        linkFrom: (assets, board) => {
          expect(assets).toEqual(['asset-photo' as AssetId]);
          calls.push(`link:${board}`);
          return Promise.resolve();
        },
      },
    });

    expect(paste(htmlBoardCopy('photo'), imageTarget).defaultPrevented).toBe(true);
    expect(calls).toEqual(['link:board-b']);
    await Promise.resolve();
    expect(calls).toEqual(['link:board-b', 'create']);
    expect(parse).toHaveBeenCalledOnce();
  });
});
