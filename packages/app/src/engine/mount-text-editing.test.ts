// Where the person edits text, for presence: the document side's spot, and MountText
// publishing it after each change. In Chrome: tooling/scenario/specs/app/peer-editing*.spec.ts.
import { describe, expect, it, vi } from 'vitest';

import { setUpTextDocument } from './__fixtures__/text-document.js';
import { MountText } from './mount-text.js';

describe('DocumentText.editing', () => {
  it('is the edited object and its caret, once the document holds it, and none after', () => {
    const { document, press } = setUpTextDocument();
    expect(document.tools.text.editing()).toBeUndefined();
    document.setActiveTool('text');
    press('pointerDown', 20, 20);
    press('pointerUp', 20, 20);
    // A draft the document does not hold yet: nobody else could see it.
    expect(document.tools.text.session()).toBeDefined();
    expect(document.tools.text.editing()).toBeUndefined();
    document.tools.text.session()?.type('Hello');
    expect(document.tools.text.editing()).toEqual({ objectId: 'text-1', anchor: 5, focus: 5 });
    document.setActiveTool('select');
    expect(document.tools.text.editing()).toBeUndefined();
    document.destroy();
  });
});

describe('MountText.editing', () => {
  it('publishes the spot after each change, and none once destroyed', () => {
    const { document, press } = setUpTextDocument();
    const mount = new MountText();
    mount.follow(document);
    const heard = vi.fn();
    mount.editing.subscribe(heard);
    mount.changed();
    expect(heard).not.toHaveBeenCalled();
    document.setActiveTool('text');
    press('pointerDown', 20, 20);
    press('pointerUp', 20, 20);
    document.tools.text.session()?.type('Hi');
    mount.changed();
    expect(mount.editing.snapshot()).toEqual({ objectId: 'text-1', anchor: 2, focus: 2 });
    mount.destroy();
    expect(mount.editing.snapshot()).toBeUndefined();
    expect(heard).toHaveBeenCalledTimes(2);
    document.destroy();
  });
});
