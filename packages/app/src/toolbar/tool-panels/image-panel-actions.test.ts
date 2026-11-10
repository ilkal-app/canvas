import { describe, expect, it, vi } from 'vitest';

import { AssetsHttpError } from '../../assets/assets-responses.js';
import { NO_IMAGES_MESSAGE } from '../../assets/page-images.js';
import type { PasteTarget } from '../../clipboard/paste-handlers.js';

import { imagePanelActionsOf } from './image-panel-actions.js';
import { TOOL_PANELS } from './tool-panel-contribution.js';

/**
 * A paste location that takes whatever it is given, centred at (10, 20).
 *
 * @returns The location.
 */
function pasteTarget(): PasteTarget {
  return {
    pointer: undefined,
    viewCentre: { x: 10, y: 20 },
    createObjects: vi.fn(() => true),
    notify: vi.fn(),
  };
}

/**
 * Page images whose requests fail with the error given, and whose inserts are recorded.
 *
 * @param error - What every request rejects with.
 * @returns The images.
 */
function images(error: Error = new Error('offline')) {
  return {
    insert: vi.fn(() => Promise.resolve()),
    request: vi.fn(() => Promise.reject(error instanceof Error ? error : new Error(String(error)))),
  };
}

describe('imagePanelActionsOf', () => {
  it('gives no actions without the page’s images', () => {
    expect(imagePanelActionsOf(undefined, pasteTarget, vi.fn())).toBeUndefined();
  });

  it('says images cannot be added while there is no canvas yet', async () => {
    const notify = vi.fn();
    const page = images();
    const actions = imagePanelActionsOf(page, () => undefined, notify);
    actions?.upload([new File(['x'], 'a.png')]);
    expect(await actions?.fromLink('https://example.com/a.png')).toBe(false);
    expect(notify.mock.calls).toEqual([[NO_IMAGES_MESSAGE], [NO_IMAGES_MESSAGE]]);
    expect(page.insert).not.toHaveBeenCalled();
    expect(page.request).not.toHaveBeenCalled();
  });

  it('uploads at the view’s centre through the page’s images', () => {
    const page = images();
    const target = pasteTarget();
    const files = [new File(['x'], 'a.png')];
    imagePanelActionsOf(page, () => target, vi.fn())?.upload(files);
    expect(page.insert).toHaveBeenCalledWith(files, { x: 10, y: 20 }, target);
  });

  it('shows why a link was refused, whatever was thrown', async () => {
    const notify = vi.fn();
    const refused = imagePanelActionsOf(
      images(new AssetsHttpError(400, 'not-an-image', '')),
      pasteTarget,
      notify,
    );
    expect(await refused?.fromLink('https://example.com/a.txt')).toBe(false);
    expect(notify).toHaveBeenLastCalledWith(
      'That link isn’t a PNG, JPEG, GIF, WebP or AVIF image.',
    );
  });
});

describe('the Image panel’s codec', () => {
  it('keeps nothing, whatever was stored', () => {
    const codec = TOOL_PANELS.get('image')?.codec;
    expect(codec?.parse({ anything: 1 })).toEqual({});
    expect(codec?.defaults).toEqual({});
  });
});
