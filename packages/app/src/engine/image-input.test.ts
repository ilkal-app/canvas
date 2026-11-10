// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { bindImageDrop, ImagePicker } from './image-input.js';

const PNG = new File(['png'], 'a.png', { type: 'image/png' });

/**
 * The picker's input on the page.
 *
 * @returns It, or null.
 */
function pickerInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('input[data-image-picker]');
}

/**
 * Sends a drag event with a data transfer holding the given types and files.
 *
 * @param target - Where it goes.
 * @param type - `dragover` or `drop`.
 * @param types - The transfer's types.
 * @param files - Its files.
 * @returns The event, after dispatch.
 */
function drag(target: EventTarget, type: string, types: string[], files: File[] = []): Event {
  const event = new Event(type, { cancelable: true });
  const dataTransfer = { types, files, dropEffect: 'none' };
  Object.defineProperties(event, {
    dataTransfer: { value: dataTransfer },
    clientX: { value: 30 },
    clientY: { value: 40 },
  });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('ImagePicker', () => {
  it('opens a hidden input taking several accepted images, settling with the files chosen', async () => {
    const picker = new ImagePicker(document);
    let clicks = 0;
    const picking = picker.pick();
    const input = pickerInput();
    if (input === null) throw new Error('No picker input.');
    input.click = () => (clicks += 1);
    expect(input).toMatchObject({ type: 'file', multiple: true, hidden: true });
    expect(input.accept).toBe('image/jpeg,image/png,image/webp,image/avif,image/gif');
    Object.defineProperty(input, 'files', { value: [PNG], configurable: true });
    input.dispatchEvent(new Event('change'));
    expect(await picking).toEqual([PNG]);
    const again = picker.pick();
    expect(clicks).toBe(1);
    input.dispatchEvent(new Event('cancel'));
    expect(await again).toEqual([]);
    picker.destroy();
    expect(pickerInput()).toBeNull();
  });

  it('settles a pick with nothing when a newer one replaces it or the picker goes', async () => {
    const picker = new ImagePicker(document);
    const first = picker.pick();
    const second = picker.pick();
    expect(await first).toEqual([]);
    picker.destroy();
    expect(await second).toEqual([]);
    picker.destroy();
  });
});

describe('bindImageDrop', () => {
  it('takes dropped files at the drop’s point on the canvas, and leaves other drags alone', () => {
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ left: 10, top: 20 }) as DOMRect;
    const drops: [File[], { x: number; y: number }][] = [];
    const unbind = bindImageDrop(canvas, (files, at) => drops.push([files, at]));
    expect(drag(canvas, 'dragover', ['Files']).defaultPrevented).toBe(true);
    expect(drag(canvas, 'dragover', ['text/plain']).defaultPrevented).toBe(false);
    expect(drag(canvas, 'drop', ['text/plain']).defaultPrevented).toBe(false);
    drag(canvas, 'drop', ['Files'], []);
    drag(canvas, 'drop', ['Files'], [PNG]);
    expect(drops).toEqual([[[PNG], { x: 20, y: 20 }]]);
    unbind();
    drag(canvas, 'drop', ['Files'], [PNG]);
    expect(drops).toHaveLength(1);
  });

  it('refuses files while they may not be dropped (a viewer), and never lets the page open them', () => {
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ left: 10, top: 20 }) as DOMRect;
    const drops: File[][] = [];
    let canDrop = false;
    bindImageDrop(
      canvas,
      (files) => drops.push(files),
      () => canDrop,
    );
    const over = drag(canvas, 'dragover', ['Files']) as DragEvent;
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer?.dropEffect).toBe('none');
    expect(drag(canvas, 'drop', ['Files'], [PNG]).defaultPrevented).toBe(true);
    expect(drops).toEqual([]);
    canDrop = true;
    expect((drag(canvas, 'dragover', ['Files']) as DragEvent).dataTransfer?.dropEffect).toBe(
      'copy',
    );
    drag(canvas, 'drop', ['Files'], [PNG]);
    expect(drops).toEqual([[PNG]]);
  });
});
