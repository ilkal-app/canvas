// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';

import { copySelection, type NewObject } from '@canvas/document';
import { exportBoard, type ObjectId } from '@canvas/schema';

import { clipboardBoard } from './__fixtures__/clipboard-board.js';
import { CANVAS_OBJECTS_MIME_TYPE, PLAIN_TEXT_MIME_TYPE } from './clipboard-formats.js';
import { bindClipboardRouter } from './clipboard-router.js';
import type { ClipboardSource } from './clipboard-source.js';
import { createDefaultPasteHandlers } from './default-paste-handlers.js';
import type { PasteTarget } from './paste-handlers.js';

function largeCopy(): string {
  const copied = copySelection(clipboardBoard(), ['outside' as ObjectId]);
  if (copied === undefined) throw new Error('fixture copy failed');
  const portable = exportBoard(copied);
  const first = portable.objects[0];
  if (first === undefined) throw new Error('fixture object missing');
  return JSON.stringify({
    ...portable,
    objects: Array.from({ length: 1_001 }, (unused, index) => ({
      ...first,
      id: `older-${String(index)}`,
      x: index * 2,
    })),
  });
}

function fire(root: HTMLElement, offered: Record<string, string>): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  const data = {
    types: Object.keys(offered),
    files: [],
    getData: (type: string) => offered[type] ?? '',
  };
  Object.defineProperty(event, 'clipboardData', { value: data });
  root.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
}

it('a later paste supersedes a staged decode before the older one creates or notifies', async () => {
  const root = document.createElement('div');
  root.append(document.createElement('canvas'));
  document.body.append(root);
  const created = vi.fn((objects: readonly NewObject[]) => {
    expect(objects.length).toBeGreaterThan(0);
    return true;
  });
  const notify = vi.fn();
  const target = {
    viewCentre: { x: 0, y: 0 },
    createObjects: created,
    notify,
  } as unknown as PasteTarget;
  const source = { pasteTarget: () => target } as unknown as ClipboardSource;
  const router = bindClipboardRouter(root, {
    source: () => source,
    isEnabled: () => true,
    handlers: createDefaultPasteHandlers(),
  });
  try {
    fire(root, { [CANVAS_OBJECTS_MIME_TYPE]: largeCopy() });
    fire(root, { [PLAIN_TEXT_MIME_TYPE]: 'second' });
    await vi.waitFor(() => {
      expect(created).toHaveBeenCalledTimes(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(created).toHaveBeenCalledTimes(1);
    expect(created.mock.calls[0]?.[0]).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
  } finally {
    router.destroy();
    root.remove();
  }
});
