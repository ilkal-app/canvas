// @vitest-environment jsdom
// A design board, whose chrome is classic (D1).
// The inspector drawer: it opens on a selection and closes without one, its toggle
// opens or closes it, alt+8 opens it and moves focus into it, Escape in it gives the keyboard
// back to the canvas, and it shares its slot with the comments and history panels, one at a
// time. In Chrome: tooling/scenario/specs/app/inspector-drawer.spec.ts.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';
import { createDemoDocument } from '../engine/demo-document.js';

import { AppShell } from './app-shell.js';
import { DrawerSlotProvider, useDrawerSlot, type DrawerSlot } from './drawer-slot.js';
import { preloadWorkspaceParts } from './lazy-workspace-parts.js';

const MARKER = 'section-0-rect-0-0' as ObjectId;

afterEach(cleanup);

let slot: DrawerSlot | undefined;

/**
 * Reads the page's drawer slot, as the comments and history panels do.
 *
 * @returns Nothing.
 */
function SlotProbe(): null {
  slot = useDrawerSlot();
  return null;
}

function renderShell(hasSharedSlot = false, platform: 'mac' | 'other' = 'other') {
  const store = createDemoDocument();
  const { mount, engines } = createFakeMount(undefined, store);
  const shell = <AppShell mode="diagram" platform={platform} mountEngine={mount} />;
  render(
    hasSharedSlot ? (
      <DrawerSlotProvider>
        <SlotProbe />
        {shell}
      </DrawerSlotProvider>
    ) : (
      shell
    ),
  );
  const engine = engines[0];
  if (engine === undefined) throw new Error('the shell mounted no engine');
  return { engine };
}

const toggle = () => screen.getByRole('button', { name: 'Inspector' });
// The toggle shows only while the drawer is open (item 11).
const shownToggle = () => screen.queryByRole('button', { name: 'Inspector' });
const drawer = () => screen.queryByRole('region', { name: 'Inspector' });
const pressAlt8 = () => {
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: '8',
    code: 'Digit8',
    altKey: true,
  });
};

// The style panel and the selection popover load apart from the first script.
beforeAll(preloadWorkspaceParts);

describe('the inspector drawer', () => {
  it('opens on a selection and closes without one', () => {
    const { engine } = renderShell();
    expect(drawer()).toBeNull();
    // Closed, no toggle shows (item 11).
    expect(shownToggle()).toBeNull();
    act(() => {
      engine.select([MARKER]);
    });
    expect(drawer()).not.toBeNull();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-controls')).toBe(drawer()?.id);
    expect(screen.getByRole('complementary', { name: 'Style' })).toBeInstanceOf(HTMLElement);
    act(() => {
      engine.select([]);
    });
    expect(drawer()).toBeNull();
  });

  it('closes by its toggle for this selection, and opens again for the next', () => {
    const { engine } = renderShell();
    act(() => {
      engine.select([MARKER]);
    });
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle());
    expect(drawer()).toBeNull();
    // Closed, the toggle goes with the drawer (item 11); alt+8 opens it again.
    expect(shownToggle()).toBeNull();
    act(() => {
      engine.select(['section-0' as ObjectId]);
    });
    expect(drawer()).not.toBeNull();
  });

  it('opens with nothing selected by its shortcut, and stays open', () => {
    // By alt+8: the toggle no longer shows while the drawer is closed (item 11).
    renderShell();
    pressAlt8();
    expect(drawer()).not.toBeNull();
    expect(document.activeElement).toBe(drawer());
    expect(screen.getByText('Select an object to change its style.')).toBeInstanceOf(HTMLElement);
  });

  it('shows no toggle while closed, its shortcut listed in the shortcut sheet', () => {
    renderShell();
    expect(shownToggle()).toBeNull();
    expect(document.querySelector('[data-inspector] button')).toBeNull();
    fireEvent.keyDown(document.body, { key: '?', shiftKey: true });
    const sheet = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(sheet.textContent).toContain('Show or hide the inspector');
  });

  it('opens on alt+8 with focus in it; alt+8 in it closes it and hands the keyboard back', () => {
    renderShell();
    pressAlt8();
    expect(drawer()).not.toBeNull();
    expect(document.activeElement).toBe(drawer());
    pressAlt8();
    expect(drawer()).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it('moves focus into an open drawer on alt+8 from elsewhere', () => {
    const { engine } = renderShell();
    act(() => {
      engine.select([MARKER]);
    });
    expect(document.activeElement).toBe(document.body);
    pressAlt8();
    expect(drawer()).not.toBeNull();
    expect(document.activeElement).toBe(drawer());
  });

  it('hands the keyboard back on Escape, leaving the selection and the drawer', () => {
    const { engine } = renderShell();
    act(() => {
      engine.select([MARKER]);
    });
    const button = screen.getByRole('button', { name: /^Align left/ });
    button.focus();
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(document.activeElement).toBe(document.body);
    expect(engine.actions).not.toContainEqual({ type: 'selection', command: 'deselect' });
    expect(drawer()).not.toBeNull();
  });

  it('closes on alt+8 from a focused number field, typing nothing into it', () => {
    const { engine } = renderShell();
    act(() => {
      engine.select([MARKER]);
    });
    const field = screen.getByLabelText<HTMLInputElement>('Corner radius');
    field.focus();
    // The window's shortcuts skip a field; the drawer takes its own shortcut first.
    expect(fireEvent.keyDown(field, { key: '8', code: 'Digit8', altKey: true })).toBe(false);
    expect(drawer()).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it('takes alt+8 from a field on a Mac, where Option+8 types "•"', () => {
    const { engine } = renderShell(false, 'mac');
    act(() => {
      engine.select([MARKER]);
    });
    const field = screen.getByLabelText<HTMLInputElement>('Corner radius');
    field.focus();
    expect(fireEvent.keyDown(field, { key: '•', code: 'Digit8', altKey: true })).toBe(false);
    expect(drawer()).toBeNull();
  });

  it('leaves other keys in a field to the field', () => {
    const { engine } = renderShell();
    act(() => {
      engine.select([MARKER]);
    });
    const field = screen.getByLabelText<HTMLInputElement>('Corner radius');
    field.focus();
    expect(fireEvent.keyDown(field, { key: '8', code: 'Digit8' })).toBe(true);
    expect(fireEvent.keyDown(field, { key: 's', code: 'KeyS' })).toBe(true);
    expect(drawer()).not.toBeNull();
    expect(document.activeElement).toBe(field);
  });

  it('says in its header what is selected', () => {
    const { engine } = renderShell();
    act(() => {
      engine.select([MARKER]);
    });
    // The title over its caption, the lock and the menu beside them.
    const header = () =>
      [...(drawer()?.querySelectorAll('header h2, header p') ?? [])].map(
        (part) => part.textContent,
      );
    expect(header()).toEqual(['Rectangle', '1 object']);
    act(() => {
      engine.select([MARKER, 'section-0-rect-1-0' as ObjectId]);
    });
    expect(header()).toEqual(['2 shapes', 'Same kind']);
    act(() => {
      engine.select([MARKER, 'section-0' as ObjectId]);
    });
    expect(header()).toEqual(['2 objects', 'Shape, frame']);
    // The panel keeps its name: the header shows what it styles.
    expect(screen.getByRole('complementary', { name: 'Style' })).toBeInstanceOf(HTMLElement);
  });

  it('gives the slot to the comments or history panel, and takes it back by hand', () => {
    const { engine } = renderShell(true);
    act(() => {
      engine.select([MARKER]);
    });
    expect(slot?.occupant).toBeUndefined();
    act(() => {
      slot?.claim('comments');
    });
    expect(drawer()).toBeNull();
    act(() => {
      slot?.release('comments');
    });
    expect(drawer()).not.toBeNull();
    act(() => {
      slot?.claim('history');
    });
    expect(drawer()).toBeNull();
    // By hand: alt+8, the toggle showing only while the drawer is open (item 11).
    pressAlt8();
    expect(slot?.occupant).toBe('inspector');
    expect(drawer()).not.toBeNull();
  });
});
