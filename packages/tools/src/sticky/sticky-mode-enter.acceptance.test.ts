// CONTRACT: Enter places one sticky at the view centre with the click defaults and starts editing.
import { expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { createTextModeContext } from '../text/__fixtures__/text-mode-context.js';

import { StickyMode } from './sticky-mode.js';

it('places one styled note at the current view centre as one selected, editable capture', () => {
  const { store, context, record } = createTextModeContext();
  const centre = { x: 340, y: -120 };
  const colour = [1, 0.74, 0.8, 1] as const;
  const mode = new StickyMode(
    {
      ...context,
      viewCentre: () => centre,
      newNoteColor: () => [...colour],
      newNoteAspect: () => 'wide',
      newTextAlign: () => 'left',
    },
    { kind: 'create' },
  );
  expect(mode.onKey({ kind: 'enter' })).toBe(true);
  const note = store.get('new-1' as ObjectId);
  expect(note).toMatchObject({ type: 'sticky', color: colour, align: 'left', text: '' });
  if (note?.type !== 'sticky') throw new Error('Enter did not create a sticky');
  expect(note.x + note.width / 2).toBe(centre.x);
  expect(note.y + note.height / 2).toBe(centre.y);
  expect(note.width).toBeGreaterThan(note.height);
  expect(store.read().objects.size).toBe(1);
  expect(record.capture).toEqual(['command']);
  expect(record.selected).toEqual([['new-1']]);
  expect(mode.session?.id).toBe('new-1');
});

it('does not consume Enter or create anything without a view centre', () => {
  const { store, context, record } = createTextModeContext();
  const mode = new StickyMode(context, { kind: 'create' });
  expect(mode.onKey({ kind: 'enter' })).toBe(false);
  expect(store.read().objects.size).toBe(0);
  expect(record.capture).toEqual([]);
  expect(mode.session).toBeUndefined();
  expect(mode.onKey({ kind: 'escape' })).toBe(true);
  expect(record.exitRequests).toBe(1);
});
