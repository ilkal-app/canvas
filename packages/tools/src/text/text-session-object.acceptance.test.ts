import { expect, it, vi } from 'vitest';

import { createHistory, StoreBusyError } from '@canvas/document';

import { createTextModeContext, TEN, tenPointText } from './__fixtures__/text-mode-context.js';
import { draftTextObject, TextSessionObject } from './text-session-object.js';
import { TextEditingSession } from './text-session.js';

it('refuses a direct draft creation call outside a held run', () => {
  const { store, context } = createTextModeContext();
  const draft = draftTextObject(context, tenPointText('unused', ''));
  const object = new TextSessionObject(context, draft, true);
  const run = store.beginRun();
  expect(() => {
    object.write({ text: 'word', runs: [{ length: 4, style: TEN }] });
  }).toThrow(StoreBusyError);
  run.close();
  store.destroy();
});

it('creates a new box and its first word in one captured typing step', async () => {
  const { store, context, record } = createTextModeContext();
  const history = createHistory(store, context.origin.principalId);
  const draft = draftTextObject(context, tenPointText('unused', ''));
  const session = new TextEditingSession(context, draft, 0, true);
  const writes = vi.fn();
  store.subscribe((change) => {
    if (change.isLocal) writes();
  });
  const run = store.beginRun();
  try {
    session.type('first');
    session.type(' word');
    expect(session.editor.text).toBe('first word');
    expect(store.get(draft.id)).toBeUndefined();
    expect(record.capture).toEqual([]);
  } finally {
    run.close();
  }
  await vi.waitFor(() => {
    expect(store.get(draft.id)).toMatchObject({ text: 'first word' });
  });
  expect(store.get(draft.id)).toMatchObject({ width: 60 });
  expect(writes).toHaveBeenCalledOnce();
  expect(record.capture).toEqual([`typing:${String(session.sessionId)}:true`]);
  expect(history.undo()).toBe(true);
  expect(store.get(draft.id)).toBeUndefined();
  store.destroy();
});

it('creates a held draft ended during a run after the store becomes idle', async () => {
  const { store, context, record } = createTextModeContext();
  const fontless = { ...context, layout: { layout: () => undefined } };
  const draft = draftTextObject(fontless, tenPointText('unused', ''));
  const session = new TextEditingSession(fontless, draft, 0, true);
  const writes = vi.fn();
  store.subscribe((change) => {
    if (change.isLocal) writes();
  });
  const run = store.beginRun();
  session.type('a');
  session.end();
  expect(store.get(draft.id)).toBeUndefined();
  expect(record.capture).toEqual([]);
  run.close();
  await vi.waitFor(() => {
    expect(store.get(draft.id)).toMatchObject({ text: 'a' });
  });
  expect(writes).toHaveBeenCalledOnce();
  expect(record.capture.at(-1)).toBe('endStep');
  store.destroy();
});
