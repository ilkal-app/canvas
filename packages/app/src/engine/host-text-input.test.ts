// @vitest-environment jsdom
// The text editor's hidden input attached to a mount's canvas, over the document side with the
// monospaced fake layout. In Chrome: tooling/scenario/specs/tools/text-*.spec.ts.
import { afterEach, describe, expect, it } from 'vitest';

import type { Camera } from '@canvas/engine';

import { setUpTextDocument, TEXT_CAMERA } from './__fixtures__/text-document.js';
import { attachTextInput } from './host-text-input.js';

function setUp(camera: Camera = TEXT_CAMERA) {
  const fixture = setUpTextDocument();
  const container = document.createElement('div');
  const canvas = document.createElement('canvas');
  container.append(canvas);
  document.body.append(container);
  const bridge = attachTextInput(canvas, fixture.document, () => camera);
  const textarea = container.querySelector('textarea');
  if (textarea === null) throw new Error('No text input.');
  const key = (init: KeyboardEventInit) => {
    textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  };
  const type = (data: string) => {
    const init = { inputType: 'insertText', data, bubbles: true, cancelable: true };
    textarea.dispatchEvent(new InputEvent('beforeinput', init));
  };
  const startText = (x: number, y: number) => {
    fixture.document.setActiveTool('text');
    fixture.press('pointerDown', x, y);
    fixture.press('pointerUp', x, y);
    bridge.sync();
  };
  return { ...fixture, container, canvas, bridge, textarea, key, type, startText };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('attachTextInput', () => {
  it('puts the input beside the canvas and follows the caret on screen', () => {
    const { container, textarea, startText, type, bridge } = setUp({ ...TEXT_CAMERA, zoom: 2 });
    expect(textarea.parentElement).toBe(container);
    startText(40, 60);
    const left = Number.parseFloat(textarea.style.left);
    type('Hi');
    bridge.sync();
    expect(Number.parseFloat(textarea.style.left)).toBeGreaterThan(left);
    expect(Number.parseFloat(textarea.style.height)).toBeGreaterThan(1);
    expect(document.activeElement).toBe(textarea);
  });

  it('undoes and redoes the typing as one step, ending it first', () => {
    const { startText, type, key, text } = setUp();
    startText(40, 60);
    type('a');
    type('b');
    const id = 'text-1';
    expect(text(id).text).toBe('ab');
    type(' ');
    type('c');
    key({ key: 'z', ctrlKey: true, metaKey: true });
    expect(text(id).text).toBe('ab ');
    key({ key: 'z', ctrlKey: true, metaKey: true, shiftKey: true });
    expect(text(id).text).toBe('ab c');
  });

  it('styles with bold and italic, and ends editing with Escape', () => {
    const { document: engineDocument, startText, type, key, text } = setUp();
    startText(40, 60);
    type('x');
    key({ key: 'b', ctrlKey: true, metaKey: true });
    key({ key: 'i', ctrlKey: true, metaKey: true });
    type('y');
    expect(text('text-1').runs.at(-1)?.style).toMatchObject({ weight: 700, italic: true });
    key({ key: 'Escape' });
    expect(engineDocument.tools.text.session()).toBeUndefined();
    expect(engineDocument.inspect().selectedIds).toEqual(['text-1']);
  });

  it("keeps the editor's focus through a finger's tap, not a mouse's press", () => {
    const { canvas, startText, bridge } = setUp();
    const press = (pointerType: string) => {
      canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerType }));
      const mouseDown = new MouseEvent('mousedown', { cancelable: true });
      canvas.dispatchEvent(mouseDown);
      return mouseDown.defaultPrevented;
    };
    expect(press('touch')).toBe(false);
    startText(40, 60);
    expect(press('touch')).toBe(true);
    expect(press('pen')).toBe(true);
    expect(press('mouse')).toBe(false);
    bridge.destroy();
    expect(press('touch')).toBe(false);
  });

  it('puts the input in the page when the canvas has no container', () => {
    const fixture = setUpTextDocument();
    const canvas = document.createElement('canvas');
    const bridge = attachTextInput(canvas, fixture.document, () => TEXT_CAMERA);
    expect(document.body.querySelector('textarea[data-text-input]')).not.toBeNull();
    bridge.sync();
    bridge.destroy();
    expect(document.body.querySelector('textarea[data-text-input]')).toBeNull();
  });
});
