// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { isEditableTarget } from './editable-target.js';

function element(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  const child = host.firstElementChild;
  if (child === null) throw new Error(`No element in ${html}`);
  return child;
}

describe('isEditableTarget', () => {
  it('treats text fields, text areas and selects as editable, as the prototype did', () => {
    expect(isEditableTarget(element('<input type="text">'))).toBe(true);
    expect(isEditableTarget(element('<input type="number">'))).toBe(true);
    expect(isEditableTarget(element('<textarea></textarea>'))).toBe(true);
    expect(isEditableTarget(element('<select></select>'))).toBe(true);
  });

  it('treats contenteditable elements and their descendants as editable', () => {
    const host = element('<div contenteditable="true"><span>run</span></div>');
    expect(isEditableTarget(host)).toBe(true);
    expect(isEditableTarget(host.querySelector('span'))).toBe(true);
    expect(isEditableTarget(element('<div contenteditable=""></div>'))).toBe(true);
  });

  it('does not treat contenteditable="false" as editable', () => {
    expect(isEditableTarget(element('<div contenteditable="false"></div>'))).toBe(false);
  });

  it('does not treat buttons, the canvas or the body as editable', () => {
    expect(isEditableTarget(element('<button>Pen</button>'))).toBe(false);
    expect(isEditableTarget(element('<canvas></canvas>'))).toBe(false);
    expect(isEditableTarget(document.body)).toBe(false);
  });

  it('does not treat a missing target or a non-element as editable', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
  });
});
