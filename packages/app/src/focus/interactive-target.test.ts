// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { isControlActivationKey, isInteractiveTarget } from './interactive-target.js';

function element(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  const child = host.firstElementChild;
  if (child === null) throw new Error(`No element in ${html}`);
  return child;
}

describe('isInteractiveTarget', () => {
  it('treats native controls and editable regions as interactive', () => {
    for (const html of [
      '<button>Pen</button>',
      '<a href="#x">Help</a>',
      '<summary>More</summary>',
      '<input type="checkbox">',
      '<select></select>',
      '<textarea></textarea>',
      '<div contenteditable="true"></div>',
    ]) {
      expect(isInteractiveTarget(element(html)), html).toBe(true);
    }
  });

  it('treats the roles Enter and Space act on as interactive, descendants included', () => {
    for (const role of [
      'button',
      'menuitem',
      'option',
      'tab',
      'checkbox',
      'switch',
      'treeitem',
      'radio',
      'link',
      'combobox',
    ]) {
      const control = element(`<div role="${role}"><span>label</span></div>`);
      expect(isInteractiveTarget(control), role).toBe(true);
      expect(isInteractiveTarget(control.querySelector('span')), role).toBe(true);
    }
  });

  it('does not treat the canvas, the body, a link without href or plain text as interactive', () => {
    expect(isInteractiveTarget(element('<canvas></canvas>'))).toBe(false);
    expect(isInteractiveTarget(document.body)).toBe(false);
    expect(isInteractiveTarget(element('<a name="top">Top</a>'))).toBe(false);
    expect(isInteractiveTarget(element('<div role="toolbar"></div>'))).toBe(false);
    expect(isInteractiveTarget(element('<div contenteditable="false"></div>'))).toBe(false);
    expect(isInteractiveTarget(null)).toBe(false);
    expect(isInteractiveTarget(window)).toBe(false);
  });
});

describe('isControlActivationKey', () => {
  it('names Enter and Space, and nothing else', () => {
    expect(isControlActivationKey('Enter')).toBe(true);
    expect(isControlActivationKey(' ')).toBe(true);
    expect(isControlActivationKey('Spacebar')).toBe(true);
    expect(isControlActivationKey('Escape')).toBe(false);
    expect(isControlActivationKey('p')).toBe(false);
  });
});
