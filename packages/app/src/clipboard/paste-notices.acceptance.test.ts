// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';

import type { NewObject } from '@canvas/document';
import { SCHEMA_VERSION, type ObjectId } from '@canvas/schema';

import {
  CANVAS_OBJECTS_MIME_TYPE,
  EMBEDDED_OBJECTS_ATTRIBUTE,
  HTML_MIME_TYPE,
  PLAIN_TEXT_MIME_TYPE,
} from './clipboard-formats.js';
import { createDefaultPasteHandlers } from './default-paste-handlers.js';
import type { PasteTarget } from './paste-handlers.js';

function targetOf() {
  const created = vi.fn();
  const notify = vi.fn();
  const target = {
    viewCentre: { x: 0, y: 0 },
    createObjects: (
      objects: readonly NewObject[],
      onCreated?: (ids: readonly ObjectId[]) => void,
    ) => {
      created(objects);
      onCreated?.([]);
      return true;
    },
    notify,
  } as unknown as PasteTarget;
  return { target, created, notify };
}

it('shows the newer-version notice and does not paste the plain-text fallback', async () => {
  const { target, created, notify } = targetOf();
  const newer = JSON.stringify({
    format: 'canvas.board',
    schemaVersion: SCHEMA_VERSION + 1,
    objects: [],
  });
  expect(
    createDefaultPasteHandlers().dispatch(
      [
        { kind: 'string', type: CANVAS_OBJECTS_MIME_TYPE, data: newer },
        { kind: 'string', type: PLAIN_TEXT_MIME_TYPE, data: 'fallback' },
      ],
      target,
    ),
  ).toBe(true);
  await vi.waitFor(() => {
    expect(notify).toHaveBeenCalledWith(
      'This was copied from a newer version of Ilkal. Reload to paste it.',
    );
  });
  expect(created).not.toHaveBeenCalled();
});

it('names the attempted object count in the too-many refusal', async () => {
  const { target, created, notify } = targetOf();
  const json = JSON.stringify({
    format: 'canvas.board',
    schemaVersion: SCHEMA_VERSION,
    objects: Array.from({ length: 5_001 }, (unused, index) => ({ id: String(index) })),
  });
  createDefaultPasteHandlers().dispatch(
    [{ kind: 'string', type: CANVAS_OBJECTS_MIME_TYPE, data: json }],
    target,
  );
  await vi.waitFor(() => {
    expect(notify).toHaveBeenCalledWith(
      'This paste holds 5001 objects; a paste creates at most 5,000.',
    );
  });
  expect(created).not.toHaveBeenCalled();
});

it('also stops at newer objects embedded in HTML instead of pasting its text', async () => {
  const { target, created, notify } = targetOf();
  const newer = JSON.stringify({
    format: 'canvas.board',
    schemaVersion: SCHEMA_VERSION + 1,
    objects: [],
  }).replaceAll('"', '&quot;');
  const html = `<div ${EMBEDDED_OBJECTS_ATTRIBUTE}="${newer}"><p>fallback</p></div>`;
  createDefaultPasteHandlers().dispatch(
    [
      { kind: 'string', type: HTML_MIME_TYPE, data: html },
      { kind: 'string', type: PLAIN_TEXT_MIME_TYPE, data: 'fallback' },
    ],
    target,
  );
  await vi.waitFor(() => {
    expect(notify).toHaveBeenCalledWith(
      'This was copied from a newer version of Ilkal. Reload to paste it.',
    );
  });
  expect(created).not.toHaveBeenCalled();
});
