import { expect, it, vi } from 'vitest';

import { createHistory, StoreBusyError } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { createTextModeContext, TEN, tenPointText } from './__fixtures__/text-mode-context.js';
import { writeTextContent } from './text-content-writer.js';
import { TextEditingSession } from './text-session.js';

it('refuses a direct content writer call outside a held run', () => {
  const { store, context } = createTextModeContext([tenPointText('text', 'old')]);
  const run = store.beginRun();
  expect(() => {
    writeTextContent(context, 'text' as ObjectId, {
      text: 'new',
      runs: [{ length: 3, style: TEN }],
    });
  }).toThrow(StoreBusyError);
  run.close();
  store.destroy();
});

it('holds several session edits and commits only their latest content in one typing capture', async () => {
  const { store, context, record } = createTextModeContext([tenPointText('text', 'old')]);
  const session = new TextEditingSession(context, tenPointText('text', 'old'), 3);
  const writes = vi.fn();
  store.subscribe((change) => {
    if (change.isLocal) writes();
  });
  const run = store.beginRun();
  try {
    session.type('a');
    session.type('b');
    session.type(' ');
    expect(session.editor.text).toBe('oldab ');
    expect(store.get('text' as ObjectId)).toMatchObject({ text: 'old' });
    expect(writes).not.toHaveBeenCalled();
    expect(record.capture).toEqual([]);
  } finally {
    run.close();
  }
  await vi.waitFor(() => {
    expect(store.get('text' as ObjectId)).toMatchObject({ text: 'oldab ' });
  });
  expect(writes).toHaveBeenCalledOnce();
  expect(record.capture).toEqual([`typing:${String(session.sessionId)}:true`]);
  store.destroy();
});

it('lets an idle edit carry held content before the waiter can write', async () => {
  const { store, context, record } = createTextModeContext([tenPointText('text', 'old')]);
  const session = new TextEditingSession(context, tenPointText('text', 'old'), 3);
  const writes = vi.fn();
  store.subscribe((change) => {
    if (change.isLocal) writes();
  });
  const run = store.beginRun();
  session.type('a');
  session.type('b');
  run.close();
  session.type('c');
  expect(store.get('text' as ObjectId)).toMatchObject({ text: 'oldabc' });
  await Promise.resolve();
  expect(writes).toHaveBeenCalledOnce();
  expect(record.capture).toEqual([`typing:${String(session.sessionId)}:false`]);
  store.destroy();
});

it('settles an ended session before a new session starts in the idle gap', async () => {
  const object = tenPointText('text', 'old');
  const { store, context, record } = createTextModeContext([object]);
  const writes = vi.fn();
  store.subscribe((change) => {
    if (change.isLocal) writes();
  });
  const run = store.beginRun();
  const sessionA = new TextEditingSession(context, object, 3);
  sessionA.type('a');
  sessionA.end();
  run.close();

  const sessionB = new TextEditingSession(context, object, 4);
  expect(store.get(object.id)).toMatchObject({ text: 'olda' });
  expect(sessionB.editor.text).toBe('olda');
  expect(record.capture).toEqual([`typing:${String(sessionA.sessionId)}:false`, 'endStep']);
  sessionB.type('b');
  expect(sessionB.editor.text).toBe('oldab');

  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(store.get(object.id)).toMatchObject({ text: 'oldab' });
  expect(writes).toHaveBeenCalledTimes(2);
  expect(record.capture).toEqual([
    `typing:${String(sessionA.sessionId)}:false`,
    'endStep',
    `typing:${String(sessionB.sessionId)}:false`,
  ]);
  store.destroy();
});

it('builds a new session on ended held content while the run still holds the store', async () => {
  const object = tenPointText('text', 'old');
  const { store, context, record } = createTextModeContext([object]);
  const run = store.beginRun();
  const sessionA = new TextEditingSession(context, object, 3);
  sessionA.type('a');
  sessionA.end();

  const sessionB = new TextEditingSession(context, object, 4);
  expect(sessionB.editor.text).toBe('olda');
  sessionB.type('b');
  expect(sessionB.editor.text).toBe('oldab');
  expect(store.get(object.id)).toMatchObject({ text: 'old' });
  run.close();

  await vi.waitFor(() => {
    expect(store.get(object.id)).toMatchObject({ text: 'oldab' });
  });
  expect(record.capture).toEqual([
    `typing:${String(sessionA.sessionId)}:false`,
    'endStep',
    `typing:${String(sessionB.sessionId)}:false`,
  ]);
  store.destroy();
});

it('writes each ended session in order when sessions chain during one run', async () => {
  const object = tenPointText('text', 'old');
  const { store, context, record } = createTextModeContext([object]);
  const run = store.beginRun();
  const sessionA = new TextEditingSession(context, object, 3);
  sessionA.type('a');
  sessionA.end();

  const sessionB = new TextEditingSession(context, object, 4);
  expect(sessionB.editor.text).toBe('olda');
  sessionB.type('b');
  sessionB.end();
  expect(store.get(object.id)).toMatchObject({ text: 'old' });
  expect(record.capture).toEqual([]);
  run.close();

  await vi.waitFor(() => {
    expect(store.get(object.id)).toMatchObject({ text: 'oldab' });
    expect(record.capture).toEqual([
      `typing:${String(sessionA.sessionId)}:false`,
      'endStep',
      `typing:${String(sessionB.sessionId)}:false`,
      'endStep',
    ]);
  });
  store.destroy();
});

it('settles an ended hold before the new session edits in the idle gap', async () => {
  const object = tenPointText('text', 'old');
  const { store, context, record } = createTextModeContext([object]);
  const run = store.beginRun();
  const sessionA = new TextEditingSession(context, object, 3);
  sessionA.type('a');
  sessionA.end();

  const sessionB = new TextEditingSession(context, object, 4);
  expect(sessionB.editor.text).toBe('olda');
  run.close();
  sessionB.type('b');
  expect(sessionB.editor.text).toBe('oldab');
  expect(store.get(object.id)).toMatchObject({ text: 'oldab' });

  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(store.get(object.id)).toMatchObject({ text: 'oldab' });
  expect(record.capture).toEqual([
    `typing:${String(sessionA.sessionId)}:false`,
    'endStep',
    `typing:${String(sessionB.sessionId)}:false`,
  ]);
  store.destroy();
});

it('uses command capture when any held edit is a restyle', async () => {
  const { store, context, record } = createTextModeContext([tenPointText('text', 'old')]);
  const session = new TextEditingSession(context, tenPointText('text', 'old'), 3);
  const run = store.beginRun();
  session.type('a');
  session.selectAll();
  session.setStyle({ italic: true });
  expect(session.editor.runs[0]?.style.italic).toBe(true);
  expect(store.get('text' as ObjectId)).toMatchObject({ text: 'old' });
  expect(record.capture).toEqual(['endStep']);
  run.close();
  await vi.waitFor(() => {
    expect(store.get('text' as ObjectId)).toMatchObject({ text: 'olda' });
  });
  expect(record.capture).toEqual(['endStep', 'command']);
  store.destroy();
});

it('undoes one held typing write as one step', async () => {
  const { store, context } = createTextModeContext([tenPointText('text', 'old')]);
  const history = createHistory(store, context.origin.principalId);
  history.stopCapturing();
  const session = new TextEditingSession(context, tenPointText('text', 'old'), 3);
  const run = store.beginRun();
  session.type('a');
  session.type('b');
  run.close();
  await vi.waitFor(() => {
    expect(store.get('text' as ObjectId)).toMatchObject({ text: 'oldab' });
  });
  expect(history.undo()).toBe(true);
  expect(store.get('text' as ObjectId)).toMatchObject({ text: 'old' });
  store.destroy();
});

it('drops a held session edit when its object is deleted during the run', async () => {
  const { store, context, record } = createTextModeContext([tenPointText('text', 'old')]);
  const session = new TextEditingSession(context, tenPointText('text', 'old'), 3);
  const run = store.beginRun();
  session.type('a');
  run.enter(() => store.transact(context.origin, (tx) => tx.deleteObject('text' as ObjectId)));
  run.close();
  await vi.waitFor(() => {
    expect(record.capture).toEqual([`typing:${String(session.sessionId)}:false`]);
  });
  expect(store.get('text' as ObjectId)).toBeUndefined();
  store.destroy();
});

it('keeps held typing when a run moves the edited box', async () => {
  const object = tenPointText('text', 'old');
  const { store, context } = createTextModeContext([object]);
  const session = new TextEditingSession(context, object, 3);
  const run = store.beginRun();
  session.type('a');
  run.enter(() => {
    store.transact(context.origin, (tx) => {
      tx.patchObject(object.id, { x: 40 });
    });
  });
  expect(session.editor.text).toBe('olda');
  expect(store.get(object.id)).toMatchObject({ text: 'old', x: 40 });
  const writes = vi.fn();
  store.subscribe((change) => {
    if (change.isLocal) writes();
  });
  run.close();
  await vi.waitFor(() => {
    expect(store.get(object.id)).toMatchObject({ text: 'olda', x: 40 });
  });
  expect(writes).toHaveBeenCalledOnce();
  store.destroy();
});

it('writes held typing over text changed by a run part', async () => {
  const object = tenPointText('text', 'old');
  const { store, context } = createTextModeContext([object]);
  const session = new TextEditingSession(context, object, 3);
  const run = store.beginRun();
  session.type('a');
  run.enter(() => {
    store.transact(context.origin, (tx) => {
      tx.patchObject(object.id, { text: 'run', runs: [{ length: 3, style: TEN }] });
    });
  });
  expect(session.editor.text).toBe('olda');
  expect(store.get(object.id)).toMatchObject({ text: 'run' });
  const writes = vi.fn();
  store.subscribe((change) => {
    if (change.isLocal) writes();
  });
  run.close();
  await vi.waitFor(() => {
    expect(store.get(object.id)).toMatchObject({ text: 'olda' });
  });
  expect(writes).toHaveBeenCalledOnce();
  store.destroy();
});

it('deletes a box emptied during a run after its held write lands', async () => {
  const object = tenPointText('text', 'a');
  const { store, context, record } = createTextModeContext([object]);
  const session = new TextEditingSession(context, object, 1);
  const run = store.beginRun();
  session.deleteBackward();
  session.end();
  expect(store.get(object.id)).toMatchObject({ text: 'a' });
  expect(record.capture).toEqual([]);
  run.close();
  await vi.waitFor(() => {
    expect(store.get(object.id)).toBeUndefined();
  });
  expect(record.capture.at(-1)).toBe('endStep');
  store.destroy();
});

it('keeps an emptied box reopened in the idle gap when the new session types', async () => {
  const object = tenPointText('text', 'a');
  const { store, context, record } = createTextModeContext([object]);
  const run = store.beginRun();
  const sessionA = new TextEditingSession(context, object, 1);
  sessionA.deleteBackward();
  sessionA.end();
  run.close();

  const sessionB = new TextEditingSession(context, object, 0);
  expect(sessionB.editor.text).toBe('');
  expect(store.get(object.id)).toMatchObject({ text: '' });
  sessionB.type('x');
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(store.get(object.id)).toMatchObject({ text: 'x' });
  expect(record.capture).toEqual([
    `typing:${String(sessionA.sessionId)}:false`,
    'endStep',
    `typing:${String(sessionB.sessionId)}:false`,
  ]);
  sessionB.end();
  expect(store.get(object.id)).toMatchObject({ text: 'x' });
  store.destroy();
});

it('deletes an emptied box when its idle-gap replacement also ends empty', async () => {
  const object = tenPointText('text', 'a');
  const { store, context, record } = createTextModeContext([object]);
  const run = store.beginRun();
  const sessionA = new TextEditingSession(context, object, 1);
  sessionA.deleteBackward();
  sessionA.end();
  run.close();

  const sessionB = new TextEditingSession(context, object, 0);
  expect(sessionB.editor.text).toBe('');
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(store.get(object.id)).toMatchObject({ text: '' });
  expect(record.capture).toEqual([`typing:${String(sessionA.sessionId)}:false`, 'endStep']);
  sessionB.end();
  expect(store.get(object.id)).toBeUndefined();
  store.destroy();
});

it('drops held typing when the session ends without writing', async () => {
  const object = tenPointText('text', 'old');
  const { store, context } = createTextModeContext([object]);
  const session = new TextEditingSession(context, object, 3);
  const writes = vi.fn();
  store.subscribe((change) => {
    if (change.isLocal) writes();
  });
  const run = store.beginRun();
  session.type('a');
  session.end(false);
  run.close();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(store.get(object.id)).toMatchObject({ text: 'old' });
  expect(writes).not.toHaveBeenCalled();
  store.destroy();
});

it('ends a held session after store destruction without writing', async () => {
  const object = tenPointText('text', 'old');
  const { store, context } = createTextModeContext([object]);
  const session = new TextEditingSession(context, object, 3);
  const writes = vi.fn();
  store.subscribe((change) => {
    if (change.isLocal) writes();
  });
  store.beginRun();
  session.type('a');
  store.destroy();
  expect(() => {
    session.end();
  }).not.toThrow();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(writes).not.toHaveBeenCalled();
});
