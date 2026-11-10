// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setUpTextDocument, TEXT_CAMERA } from './__fixtures__/text-document.js';
import { MountText } from './mount-text.js';

function setUp() {
  const fixture = setUpTextDocument();
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  document.body.append(canvas);
  canvas.focus();
  const mount = new MountText();
  mount.follow(fixture.document);
  return { ...fixture, canvas, mount };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('MountText initial input synchronization', () => {
  it('focuses and mirrors a session that began before the host attached, without an edit', () => {
    const fixture = setUp();
    fixture.document.setActiveTool('text');
    fixture.press('pointerDown', 40, 60);
    fixture.press('pointerUp', 40, 60);
    fixture.document.tools.text.session()?.type('Hi');
    const before = fixture.document.inspect();

    fixture.mount.attach(fixture.canvas, () => TEXT_CAMERA);

    const input = document.querySelector('textarea');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(input?.value).toBe('Hi');
    expect(input?.selectionStart).toBe(2);
    expect(input?.selectionEnd).toBe(2);
    expect(Number.parseFloat(input?.style.left ?? '')).toBeCloseTo(68.8);
    expect(Number.parseFloat(input?.style.height ?? '')).toBeGreaterThan(0);
    expect(fixture.document.inspect()).toEqual(before);
    fixture.mount.destroy();
    fixture.document.destroy();
  });

  it('leaves focus alone when no text session is active', () => {
    const fixture = setUp();
    const before = fixture.document.inspect();

    fixture.mount.attach(fixture.canvas, () => TEXT_CAMERA);

    expect(document.activeElement).toBe(fixture.canvas);
    expect(document.querySelector('textarea')?.value).toBe('');
    expect(fixture.document.inspect()).toEqual(before);
    fixture.mount.destroy();
    fixture.document.destroy();
  });
});

describe('MountText.apply', () => {
  it('applies the text section’s change to the text being edited and hands the editor the keyboard back', () => {
    const fixture = setUp();
    fixture.document.setActiveTool('text');
    fixture.press('pointerDown', 40, 60);
    fixture.press('pointerUp', 40, 60);
    fixture.document.tools.text.session()?.type('Hi');
    fixture.mount.attach(fixture.canvas, () => TEXT_CAMERA);
    const input = document.querySelector('textarea');
    // A control in the text section that is not a text field (an alignment button) takes the
    // keyboard.
    const control = document.createElement('button');
    document.body.append(control);
    control.focus();
    expect(document.activeElement).toBe(control);

    fixture.mount.apply({ kind: 'align', align: 'center' });

    expect(fixture.document.tools.text.session()?.object()).toMatchObject({ align: 'center' });
    expect(document.activeElement).toBe(input);
    fixture.mount.destroy();
    fixture.document.destroy();
  });
});

describe('MountText while a stepped run holds the board', () => {
  it('tells the shell the text style once, when the run ends', async () => {
    const fixture = setUpTextDocument();
    const seen = vi.fn();
    const mount = new MountText(seen);
    mount.follow(fixture.document);
    fixture.document.setActiveTool('text');
    fixture.press('pointerDown', 40, 60);
    fixture.press('pointerUp', 40, 60);
    fixture.document.tools.text.session()?.type('Hi');
    const id = fixture.document.tools.text.session()?.id;
    fixture.document.setActiveTool('select');
    if (id === undefined) throw new Error('no text was made');
    mount.changed();
    seen.mockClear();
    const run = fixture.store.beginRun();
    fixture.document.selectTool.select([id]);
    mount.changed();
    mount.changed();
    expect(seen).not.toHaveBeenCalled();
    run.close();
    await vi.waitFor(() => {
      expect(seen).toHaveBeenCalledOnce();
    });
    expect(seen.mock.calls[0]?.[0]).toBeDefined();
    mount.destroy();
    fixture.document.destroy();
  });
});
